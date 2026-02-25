/**
 * RLM (Recursive Language Model) 阅读器
 * 
 * 核心能力：
 * 1. 段落边界切分，保证语义完整
 * 2. LLM 自主决定阅读策略
 * 3. 可配置的任务类型
 * 4. 并行子 Agent 处理大文档
 * 5. Checkpointer 断点续读支持
 */

import { createHash } from 'crypto';
import path from 'path';
import { splitIntoParagraphs } from './text-splitter';
import { createDeepAgent, type DeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import {
  buildRLMPrompt,
  buildInitMessage,
  buildSubReaderPrompt,
  formatChunkContent,
  RLM_MESSAGES,
  TASK_STUDY_NOTES,
  TASK_SUMMARY,
  TASK_TEACHING_POINTS,
  TASK_PAPER_ANALYSIS,
} from './prompts/rlm';
import {
  createGetDocumentStatsTool,
  createGetChunkListTool,
  createSearchDocumentTool,
  createReadChunkTool,
  createSpawnReaderTool,
  createUpdateOutputTool,
  createGetOutputTool,
  createDoneTool,
} from './tools/rlm';
import type {
  DocumentInput,
  DocumentChunk,
  DocumentStats,
  RLMOutput,
  RLMReaderConfig,
  RLMTaskConfig,
  RLMState,
} from './types';

// ==================== SQLite Checkpointer ====================

// SQLite 数据库路径
const CHECKPOINT_DB_PATH = path.join(process.cwd(), '.rlm-checkpoints.db');

// 使用单例模式，确保跨调用保持状态
let globalCheckpointer: SqliteSaver | null = null;
let checkpointerInitPromise: Promise<SqliteSaver> | null = null;

async function getCheckpointer(): Promise<SqliteSaver> {
  if (globalCheckpointer) {
    return globalCheckpointer;
  }
  
  if (!checkpointerInitPromise) {
    checkpointerInitPromise = (async () => {
      const saver = SqliteSaver.fromConnString(CHECKPOINT_DB_PATH);
      // 如果 fromConnString 返回 Promise，需要 await
      const instance = saver instanceof Promise ? await saver : saver;
      // 初始化数据库 schema（必须调用 setup）
      await instance.setup();
      globalCheckpointer = instance;
      console.log(`[RLM] Checkpointer 已初始化: ${CHECKPOINT_DB_PATH}`);
      return globalCheckpointer!;
    })();
  }
  
  return checkpointerInitPromise;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<RLMReaderConfig> = {
  task: TASK_STUDY_NOTES,
  chunkSize: 2000,
  model: process.env.OPENAI_MODEL || 'qwen-plus',
  modelProvider: process.env.OPENAI_MODEL_PROVIDER || 'openai',
  subAgentModel: process.env.OPENAI_MODEL || 'qwen-plus',
  subAgentModelProvider: process.env.OPENAI_MODEL_PROVIDER || 'openai',
  baseURL: process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  recursionLimit: 500,
  enableCheckpoint: true,  // SQLite 断点续读
};

// ==================== RLMReader 类 ====================

export class RLMReader {
  private chunks: DocumentChunk[] = [];
  private output: string = '';
  private config: Required<RLMReaderConfig>;
  private toolCallCount: number = 0;
  private readChunksSet: Set<number> = new Set();
  private documentId: string = '';

  constructor(config: RLMReaderConfig = {}) {
    this.config = {
      task: config.task || DEFAULT_CONFIG.task,
      chunkSize: config.chunkSize || DEFAULT_CONFIG.chunkSize,
      model: config.model || DEFAULT_CONFIG.model,
      modelProvider: config.modelProvider || DEFAULT_CONFIG.modelProvider,
      subAgentModel: config.subAgentModel || DEFAULT_CONFIG.subAgentModel,
      subAgentModelProvider: config.subAgentModelProvider || DEFAULT_CONFIG.subAgentModelProvider,
      baseURL: config.baseURL || DEFAULT_CONFIG.baseURL,
      recursionLimit: config.recursionLimit || DEFAULT_CONFIG.recursionLimit,
      enableCheckpoint: config.enableCheckpoint ?? DEFAULT_CONFIG.enableCheckpoint,
    };
  }

  // ==================== Thread ID 生成 ====================

  /**
   * 生成文档唯一标识（用于 thread_id）
   * 基于内容哈希 + 任务类型
   */
  private generateDocumentId(content: string): string {
    const hash = createHash('md5')
      .update(content.substring(0, 10000))
      .update(this.config.task.purpose)
      .digest('hex')
      .substring(0, 12);
    return hash;
  }

  /**
   * 生成 thread_id（用于 checkpointer）
   */
  private getThreadId(): string {
    return `rlm-${this.documentId}`;
  }

  /**
   * 检查是否有历史 checkpoint
   * 注意：checkpoint 用于让 AI 知道自己做过什么，不是用于断电续传
   */
  private async tryRestoreFromCheckpoint(threadId: string): Promise<boolean> {
    if (!this.config.enableCheckpoint) return false;
    
    try {
      const checkpointer = await getCheckpointer();
      
      // 检查是否有此 thread 的 checkpoint
      let hasCheckpoint = false;
      for await (const _cp of checkpointer.list({ configurable: { thread_id: threadId } })) {
        hasCheckpoint = true;
        break;
      }
      
      if (hasCheckpoint) {
        console.log(`  📦 发现历史消息记录`);
      }
      
      return hasCheckpoint;
    } catch (e) {
      console.log(`  ⚠️ 检查历史失败: ${e instanceof Error ? e.message : 'Unknown'}`);
      return false;
    }
  }

  /**
   * 创建配置好 baseURL 的 LLM 实例
   */
  private createLLM(model: string): ChatOpenAI {
    return new ChatOpenAI({
      model,
      openAIApiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: this.config.baseURL,
      },
      temperature: 0.7,
    });
  }

  // ==================== 预处理 ====================

  /**
   * 段落边界切分
   */
  private prepareChunks(content: string): DocumentChunk[] {
    const paragraphs = splitIntoParagraphs(content, this.config.chunkSize);
    let charPos = 0;
    return paragraphs.map((p, i) => {
      const chunk: DocumentChunk = {
        index: i + 1,
        content: p,
        charStart: charPos,
        charEnd: charPos + p.length,
      };
      charPos += p.length;
      return chunk;
    });
  }

  // ==================== 日志辅助 ====================

  private log(message: string, data?: Record<string, unknown>) {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const prefix = `[RLM ${timestamp}]`;
    if (data) {
      console.log(`${prefix} ${message}`);
      Object.entries(data).forEach(([key, value]) => {
        console.log(`    └─ ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      });
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  private logToolCall(toolName: string, description: string, params?: Record<string, unknown>) {
    this.toolCallCount++;
    console.log('');
    console.log(`[工具 #${this.toolCallCount}] ${toolName}`);
    console.log(`  说明: ${description}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        const displayValue = typeof value === 'string' && value.length > 100 
          ? value.substring(0, 100) + '...' 
          : value;
        console.log(`  ${key}: ${displayValue}`);
      });
    }
  }

  private logToolResult(result: string | Record<string, unknown>) {
    if (typeof result === 'string') {
      console.log(`  -> 返回: ${result.length > 200 ? result.substring(0, 200) + '...' : result}`);
    } else {
      console.log(`  -> 返回:`, result);
    }
  }

  // ==================== 工具实现 ====================

  /**
   * 获取文档统计
   */
  private getDocumentStats(): DocumentStats {
    this.logToolCall('get_document_stats', 'AI 正在了解文档的基本信息（总字数、分块数量、平均每块大小）');
    
    const totalChars = this.chunks.reduce((sum, c) => sum + c.content.length, 0);
    const stats = {
      totalChars,
      totalChunks: this.chunks.length,
      avgChunkSize: this.chunks.length > 0 ? Math.round(totalChars / this.chunks.length) : 0,
    };
    
    console.log(`  -> 总字数: ${stats.totalChars.toLocaleString()} 字, 分块数: ${stats.totalChunks} 块, 平均每块: ${stats.avgChunkSize.toLocaleString()} 字`);
    
    return stats;
  }

  /**
   * 获取块列表预览
   * 注意：为避免返回值过大导致 API 格式问题，只返回前 20 个块的预览
   */
  private getChunkList(): string {
    this.logToolCall('get_chunk_list', 'AI 正在浏览文档结构，查看每块的开头内容');
    
    const total = this.chunks.length;
    const previewCount = Math.min(20, total);
    
    // 只取前 20 个块的预览
    const previews = this.chunks.slice(0, previewCount).map(c => 
      `块${c.index}: "${c.content.substring(0, 50)}..." (${c.content.length}字)`
    );
    
    console.log(`  -> 获取到 ${total} 个块的预览`);
    previews.slice(0, 2).forEach(p => console.log(`     ${p}`));
    if (previewCount > 2) {
      console.log(`     ... 共 ${total} 块`);
    }
    
    // 返回字符串而不是数组，避免 API 格式问题
    return `文档共 ${total} 块。前 ${previewCount} 块预览：\n${previews.join('\n')}\n\n提示：使用 spawn_reader(块范围, 问题) 分批阅读全部内容。`;
  }

  /**
   * 搜索关键词
   */
  private searchDocument(keyword: string): number[] {
    this.logToolCall('search_document', `AI 正在搜索包含关键词的内容块`, { 关键词: keyword });
    
    const results = this.chunks
      .filter(c => c.content.includes(keyword))
      .map(c => c.index);
    
    console.log(`  -> 找到 ${results.length} 个匹配块${results.length > 0 ? ': [' + results.join(', ') + ']' : ''}`);
    
    return results;
  }

  /**
   * 读取块内容
   */
  private readChunk(index: number): string {
    this.logToolCall('read_chunk', `AI 正在阅读第 ${index} 块的完整内容`);
    
    const chunk = this.chunks.find(c => c.index === index);
    const result = chunk?.content || RLM_MESSAGES.CHUNK_NOT_FOUND(index);
    
    // 记录已读块
    if (chunk) {
      this.readChunksSet.add(index);
    }
    
    console.log(`  -> ${chunk ? result.length.toLocaleString() + ' 字' : '块不存在'}`);
    
    return result;
  }

  /**
   * 派出阅读助手
   */
  private async spawnReader(indexes: number[], question: string): Promise<string> {
    this.logToolCall('spawn_reader', `AI 派出助手阅读多个内容块并回答问题`, {
      阅读范围: `块 ${indexes[0]} 到 块 ${indexes[indexes.length-1]} (共 ${indexes.length} 块)`,
      问题: question.length > 80 ? question.substring(0, 80) + '...' : question,
    });
    
    console.log(`  (子Agent开始工作...)`);
    
    const content = indexes.map(i => {
      const chunk = this.readChunk(i);
      return formatChunkContent(i, chunk);
    }).join('\n\n---\n\n');

    try {
      const llm = this.createLLM(this.config.subAgentModel);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subAgent: any = createDeepAgent({
        model: llm,
      });

      const result = await subAgent.invoke({
        messages: [{
          role: 'user',
          content: buildSubReaderPrompt(question, content),
        }],
      });

      const messages = result?.messages || [];
      const lastMessage = messages[messages.length - 1];
      const answer = lastMessage?.content || '无法获取回答';
      
      console.log(`  -> 子Agent返回 ${answer.length.toLocaleString()} 字`);
      
      // 解析增量人物/关系数据
      this.parseAndLogGraphUpdate(answer);
      
      return answer;
    } catch (error) {
      console.error(`  -> 子Agent出错: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return RLM_MESSAGES.READER_ERROR(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * 解析子 Agent 返回中的人物/关系数据，并通过特殊日志格式输出
   */
  private parseAndLogGraphUpdate(answer: string): void {
    try {
      // 提取 ```characters [...] ```
      const charsMatch = answer.match(/```characters\s*([\s\S]*?)```/);
      // 提取 ```relationships [...] ```
      const relsMatch = answer.match(/```relationships\s*([\s\S]*?)```/);

      let characters: unknown[] = [];
      let relationships: unknown[] = [];

      if (charsMatch) {
        try {
          characters = JSON.parse(charsMatch[1].trim());
        } catch {
          // 解析失败，忽略
        }
      }

      if (relsMatch) {
        try {
          relationships = JSON.parse(relsMatch[1].trim());
        } catch {
          // 解析失败，忽略
        }
      }

      // 只有有数据时才输出特殊日志（会被 init API 捕获）
      if ((Array.isArray(characters) && characters.length > 0) || 
          (Array.isArray(relationships) && relationships.length > 0)) {
        // 使用特殊前缀，便于 init API 识别
        console.log(`[GRAPH_UPDATE] ${JSON.stringify({ characters, relationships })}`);
      }
    } catch {
      // 解析失败，静默忽略
    }
  }

  /**
   * 更新输出
   */
  private updateOutput(content: string): string {
    this.logToolCall('update_output', `AI 正在保存生成的笔记/输出`);
    
    this.output = content;
    
    console.log(`  -> 已保存 ${content.length.toLocaleString()} 字`);
    
    return RLM_MESSAGES.OUTPUT_UPDATED;
  }

  /**
   * 获取输出
   */
  private getOutput(): string {
    this.logToolCall('get_output', `AI 正在查看当前已生成的输出内容`);
    
    const result = this.output || RLM_MESSAGES.OUTPUT_EMPTY;
    
    console.log(`  -> 当前输出: ${this.output ? result.length.toLocaleString() + ' 字' : '空'}`);
    
    return result;
  }

  // ==================== 主入口 ====================

  /**
   * 阅读文档
   */
  async read(input: DocumentInput): Promise<RLMOutput> {
    const startTime = Date.now();
    this.toolCallCount = 0;
    this.readChunksSet.clear();
    
    // 生成文档唯一标识和 thread_id
    this.documentId = this.generateDocumentId(input.content);
    const threadId = this.getThreadId();
    
    console.log('');
    console.log('========== RLM 文档阅读开始 ==========');
    console.log(`文档: ${input.title || '未命名'} (${input.content.length.toLocaleString()} 字)`);
    console.log(`任务: ${this.config.task.purpose}`);
    console.log(`模型: ${this.config.model}`);
    if (this.config.enableCheckpoint) {
      console.log(`断点续读: 已启用 (thread: ${threadId})`);
    }
    
    // 1. 预处理：切分文档
    this.chunks = this.prepareChunks(input.content);
    this.output = '';

    if (this.chunks.length === 0) {
      console.log('错误: 文档内容为空');
      return {
        content: RLM_MESSAGES.EMPTY_DOCUMENT,
      };
    }
    
    console.log(`分块: ${this.chunks.length} 块`);
    
    // 2. 尝试从 checkpoint 恢复状态
    const hasHistory = await this.tryRestoreFromCheckpoint(threadId);
    if (hasHistory) {
      console.log(`  继续上次阅读进度...`);
    }
    console.log('');

    // 3. 构建提示词
    const systemPrompt = buildRLMPrompt(this.config.task);

    // 4. 创建工具（绑定当前实例的处理函数）
    const tools = [
      createGetDocumentStatsTool(() => this.getDocumentStats()),
      createGetChunkListTool(() => this.getChunkList()),
      createSearchDocumentTool((keyword) => this.searchDocument(keyword)),
      createReadChunkTool((index) => this.readChunk(index)),
      createSpawnReaderTool((indexes, question) => this.spawnReader(indexes, question)),
      createUpdateOutputTool((content) => this.updateOutput(content)),
      createGetOutputTool(() => this.getOutput()),
      createDoneTool(() => {
        this.toolCallCount++;
        console.log('');
        console.log(`[工具 #${this.toolCallCount}] done`);
        
        // 检查覆盖率
        const totalChunks = this.chunks.length;
        const readCount = this.readChunksSet.size;
        const coverage = totalChunks > 0 ? (readCount / totalChunks * 100).toFixed(1) : 0;
        const minCoverage = this.config.task.minCoverage ?? 0.8; // 默认 80%
        const minCoveragePercent = (minCoverage * 100).toFixed(0);
        
        console.log(`  已读: ${readCount}/${totalChunks} 块 (覆盖率 ${coverage}%，要求 ${minCoveragePercent}%)`);
        
        // 检查覆盖率是否满足要求
        if (totalChunks > 10 && readCount < totalChunks * minCoverage) {
          const remaining = Math.ceil(totalChunks * minCoverage) - readCount;
          
          // 找出未读的块，合并成范围便于 AI 理解
          const allChunks = new Set(Array.from({ length: totalChunks }, (_, i) => i + 1));
          const unreadChunks = Array.from(allChunks).filter(i => !this.readChunksSet.has(i)).sort((a, b) => a - b);
          
          // 合并连续范围
          const ranges: string[] = [];
          let start = unreadChunks[0];
          let end = unreadChunks[0];
          for (let i = 1; i < unreadChunks.length; i++) {
            if (unreadChunks[i] === end + 1) {
              end = unreadChunks[i];
            } else {
              ranges.push(start === end ? `${start}` : `${start}-${end}`);
              start = unreadChunks[i];
              end = unreadChunks[i];
            }
          }
          ranges.push(start === end ? `${start}` : `${start}-${end}`);
          
          // 只显示前几个范围，避免消息过长
          const displayRanges = ranges.slice(0, 5);
          const rangeHint = displayRanges.join(', ') + (ranges.length > 5 ? ` 等共 ${ranges.length} 个区间` : '');
          
          console.log(`  ❌ 拒绝：覆盖率不足 ${minCoveragePercent}%，还需阅读约 ${remaining} 块`);
          console.log(`  📍 未读范围: ${rangeHint}`);
          
          return `错误：覆盖率不足 ${minCoveragePercent}%（当前 ${coverage}%）。未读块: ${rangeHint}。请使用 spawn_reader 阅读这些未读块，然后再调用 done。`;
        }
        
        console.log(`  ✓ 任务完成`);
        return '任务已完成。请不要再调用任何工具。';
      }),
    ];

    try {
      // 使用配置好 baseURL 的 LLM 实例
      const llm = this.createLLM(this.config.model);
      
      // 创建 agent，启用 checkpointer 时传入
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentConfig: any = {
        model: llm,
        systemPrompt,
        tools,
      };
      
      if (this.config.enableCheckpoint) {
        agentConfig.checkpointer = await getCheckpointer();
      }
      
      const agent: any = createDeepAgent(agentConfig);

      // 5. 启动阅读（deepagents 会自动处理工具调用）
      const initMessage = buildInitMessage(input.title);
      
      // 启用 checkpointer 时传入 thread_id
      const invokeConfig: Record<string, unknown> = { 
        recursionLimit: this.config.recursionLimit 
      };
      
      if (this.config.enableCheckpoint) {
        invokeConfig.configurable = { thread_id: threadId };
      }
      
      await agent.invoke(
        { messages: [{ role: 'user', content: initMessage }] },
        invokeConfig
      );

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('');
      console.log('========== RLM 阅读完成 ==========');
      console.log(`统计: ${this.toolCallCount} 次工具调用, 耗时 ${duration} 秒, 输出 ${(this.output || '').length.toLocaleString()} 字`);
      console.log('');
      
      return {
        content: this.output || RLM_MESSAGES.NO_OUTPUT,
        metadata: {
          totalChunks: this.chunks.length,
          task: this.config.task.purpose,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // 打印完整堆栈以便调试
      if (error instanceof Error && error.stack) {
        console.error('完整错误堆栈:', error.stack);
      }
      
      // 如果是递归限制错误，返回当前已有的输出
      if (errorMessage.includes('GRAPH_RECURSION_LIMIT') || errorMessage.includes('Recursion limit')) {
        console.log('');
        console.log('========== RLM 达到递归限制 ==========');
        console.log(`统计: ${this.toolCallCount} 次工具调用, 耗时 ${duration} 秒, 当前输出 ${(this.output || '').length.toLocaleString()} 字`);
        console.log('提示: 已达到最大循环次数，返回当前结果');
        console.log('');
        
        return {
          content: this.output || RLM_MESSAGES.NO_OUTPUT,
          metadata: {
            totalChunks: this.chunks.length,
            task: this.config.task.purpose,
            warning: '达到递归限制，结果可能不完整',
          },
        };
      }
      
      console.log('');
      console.log('========== RLM 阅读出错 ==========');
      console.log(`错误: ${errorMessage}`);
      console.log(`耗时: ${duration} 秒`);
      console.log('');
      
      return {
        content: RLM_MESSAGES.PROCESS_ERROR(errorMessage),
      };
    }
  }

  // ==================== 便捷静态方法 ====================

  /**
   * 生成学习笔记
   */
  static async studyNotes(input: DocumentInput, config?: Partial<RLMReaderConfig>): Promise<RLMOutput> {
    const reader = new RLMReader({ ...config, task: TASK_STUDY_NOTES });
    return reader.read(input);
  }

  /**
   * 生成摘要
   */
  static async summary(input: DocumentInput, config?: Partial<RLMReaderConfig>): Promise<RLMOutput> {
    const reader = new RLMReader({ ...config, task: TASK_SUMMARY });
    return reader.read(input);
  }

  /**
   * 提取教学知识点
   */
  static async teachingPoints(input: DocumentInput, config?: Partial<RLMReaderConfig>): Promise<RLMOutput> {
    const reader = new RLMReader({ ...config, task: TASK_TEACHING_POINTS });
    return reader.read(input);
  }

  /**
   * 论文分析
   */
  static async paperAnalysis(input: DocumentInput, config?: Partial<RLMReaderConfig>): Promise<RLMOutput> {
    const reader = new RLMReader({ ...config, task: TASK_PAPER_ANALYSIS });
    return reader.read(input);
  }

  /**
   * 自定义任务
   */
  static async withTask(
    input: DocumentInput,
    task: RLMTaskConfig,
    config?: Partial<RLMReaderConfig>
  ): Promise<RLMOutput> {
    const reader = new RLMReader({ ...config, task });
    return reader.read(input);
  }
}

// ==================== 导出 ====================

export {
  TASK_STUDY_NOTES,
  TASK_SUMMARY,
  TASK_TEACHING_POINTS,
  TASK_PAPER_ANALYSIS,
} from './prompts/rlm';

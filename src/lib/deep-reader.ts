/**
 * DeepReader 精读处理器 (Agent 模式)
 * 
 * 采用 RLM 的 Agent 工具调用模式：
 * - Commander Agent 规划场景切分
 * - Writer SubAgent 逐片段生成评书
 * - 每次只处理 2000-3000 字，避免长文本退化
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { RLMReader } from './rlm-reader';
import { TASK_SUMMARY } from './prompts/rlm';
import { splitIntoParagraphs } from './text-splitter';
import {
  createGetChapterInfoTool,
  createReadSegmentTool,
  createSpawnWriterTool,
  createAppendOutputTool,
  createDeepReaderDoneTool,
  type ChapterInfo,
  type SpawnWriterInput,
  type SpawnWriterResult,
  type DoneCheckResult,
} from './tools/deep-reader';
import type {
  Chapter,
  DeepReaderConfig,
  DeepReadTaskConfig,
  DeepReaderOutput,
  DocumentInput,
  KnowledgeGraph,
} from './types';

// ==================== TTS 文本清洗 ====================

/**
 * 清洗评书文本，去除舞台指示和 Markdown 格式，使其适合 TTS 朗读
 */
export function cleanForTTS(text: string): string {
  return text
    // 去掉（...）括号里的舞台指示、表演提示、动作描写
    .replace(/（[^）]*）/g, '')
    // 去掉 markdown 加粗 **...**
    .replace(/\*\*/g, '')
    // 去掉 markdown 标题行 ## ... / ### ...
    .replace(/^#{1,6}\s+.*$/gm, '')
    // 去掉 markdown 分割线 ---
    .replace(/^-{3,}$/gm, '')
    // 去掉 markdown 引用 > ...
    .replace(/^>\s+.*$/gm, '')
    // 去掉 markdown 代码块标记
    .replace(/^```.*$/gm, '')
    // 去掉文件头部的元信息（生成时间、原文字数等）
    .replace(/^#\s+.*\n/m, '')
    // 去掉空的破折号行
    .replace(/^——$/gm, '')
    // 合并连续空行为单个空行
    .replace(/\n{3,}/g, '\n\n')
    // 去掉行首尾多余空白
    .replace(/^\s+|\s+$/gm, (match) => match.includes('\n') ? '\n' : '')
    .trim();
}

// ==================== 片段类型 ====================

interface Segment {
  id: number;
  charStart: number;
  charEnd: number;
  content: string;
  preview: string;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: Required<DeepReaderConfig> = {
  task: {
    role: '你是一个专业的文本改写专家',
    purpose: '逐章改写文本内容',
    chapterPrompt: '请改写本章内容',
    outputMode: 'preserve',
    contextChapters: 2,
    maxOutputPerChapter: 5000,
  },
  chapterSize: 5000,
  model: process.env.OPENAI_MODEL || 'qwen-plus',
  baseURL: process.env.OPENAI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  enablePreview: true,
  previewMaxWords: 2000,
};

// 片段大小配置
const SEGMENT_SIZE = 2500; // 每片段约 2500 字

// ==================== 提示词加载 ====================

const PROMPTS_DIR = path.join(process.cwd(), 'src/lib/prompts/deep-reader');

function readPromptFile(relativePath: string): string {
  const fullPath = path.join(PROMPTS_DIR, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    console.warn(`[DeepReader] 无法读取提示词文件: ${relativePath}`);
    return '';
  }
}

function parseTaskFile(content: string): Partial<DeepReadTaskConfig> {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const result: Partial<DeepReadTaskConfig> = {};

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const roleMatch = frontmatter.match(/role:\s*(.+)/);
    const purposeMatch = frontmatter.match(/purpose:\s*(.+)/);
    const outputModeMatch = frontmatter.match(/outputMode:\s*(.+)/);
    const contextChaptersMatch = frontmatter.match(/contextChapters:\s*(\d+)/);

    if (roleMatch) result.role = roleMatch[1].trim();
    if (purposeMatch) result.purpose = purposeMatch[1].trim();
    if (outputModeMatch) {
      result.outputMode = outputModeMatch[1].trim() as 'expand' | 'preserve' | 'compress';
    }
    if (contextChaptersMatch) {
      result.contextChapters = parseInt(contextChaptersMatch[1], 10);
    }
  }

  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  if (body.trim()) {
    result.chapterPrompt = body.trim();
  }

  return result;
}

/** 加载预设任务配置 */
export function loadDeepReadTask(taskName: string): DeepReadTaskConfig {
  const content = readPromptFile(`tasks/${taskName}.txt`);
  const parsed = parseTaskFile(content);
  return {
    role: parsed.role || DEFAULT_CONFIG.task.role,
    purpose: parsed.purpose || DEFAULT_CONFIG.task.purpose,
    chapterPrompt: parsed.chapterPrompt || DEFAULT_CONFIG.task.chapterPrompt,
    outputMode: parsed.outputMode || DEFAULT_CONFIG.task.outputMode,
    contextChapters: parsed.contextChapters || DEFAULT_CONFIG.task.contextChapters,
  };
}

/** 预设任务：评书改编 */
export const DEEP_TASK_PINGSHU = loadDeepReadTask('pingshu');

// ==================== 会话类型 ====================

/** DeepReader 会话数据（用于 init/chapter 分步 API） */
export interface DeepReaderSession {
  id: string;
  title: string;
  content: string;
  chapters: Chapter[];
  globalContext: string;
  chapterSummaries: string[];
  outputPath: string;
  ttsOutputPath: string;
  outputDir: string;
  baseName: string;
  timestamp: string;
  completedChapters: number[];
  createdAt: number;
  /** 每回 TTS 生成结果：key = "chapterIdx:episodeTitle", value = audioPath */
  ttsResults?: Record<string, string>;
  /** 知识图谱（人物/关系/事件） */
  knowledgeGraph?: KnowledgeGraph;
}

/** 章节处理进度回调 */
export type ChapterProgressCallback = (event: {
  type: 'segment_start' | 'segment_done' | 'chapter_done';
  segmentId?: number;
  totalSegments?: number;
  charCount?: number;
  outputChars?: number;
  /** segment_done 时携带生成的内容 */
  segmentContent?: string;
  /** segment_done 时携带场景标题 */
  segmentTitle?: string;
}) => void;

/** 初始化进度回调 */
export type InitProgressCallback = (event: {
  type: 'parsed' | 'chapters' | 'context_progress' | 'ready';
  message?: string;
  title?: string;
  totalChars?: number;
  chapterCount?: number;
  chunksRead?: number;
  totalChunks?: number;
}) => void;

// ==================== DeepReader 类 ====================

export class DeepReader {
  private config: Required<DeepReaderConfig>;
  private chapters: Chapter[] = [];
  private globalContext: string = '';
  private chapterSummaries: string[] = [];
  
  // 当前章节处理状态
  private currentChapter: Chapter | null = null;
  private segments: Segment[] = [];
  private processedSegments: Set<number> = new Set();
  private output: string = '';
  private previousSummary: string = '';
  private outputStream: fs.WriteStream | null = null;
  private toolCallCount: number = 0;

  constructor(config: DeepReaderConfig) {
    this.config = {
      task: { ...DEFAULT_CONFIG.task, ...config.task },
      chapterSize: config.chapterSize || DEFAULT_CONFIG.chapterSize,
      model: config.model || DEFAULT_CONFIG.model,
      baseURL: config.baseURL || DEFAULT_CONFIG.baseURL,
      enablePreview: config.enablePreview ?? DEFAULT_CONFIG.enablePreview,
      previewMaxWords: config.previewMaxWords || DEFAULT_CONFIG.previewMaxWords,
    };
  }

  // ==================== LLM 创建 ====================

  private createLLM(model: string, options?: { temperature?: number }): ChatOpenAI {
    return new ChatOpenAI({
      model,
      openAIApiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: this.config.baseURL,
      },
      temperature: options?.temperature ?? 0.7,
      frequencyPenalty: 0.3,
      presencePenalty: 0.3,
    });
  }

  // ==================== 片段切分 ====================

  private splitChapterIntoSegments(chapter: Chapter): Segment[] {
    const content = chapter.content;
    const segments: Segment[] = [];
    let pos = 0;
    let id = 1;

    while (pos < content.length) {
      let endPos = Math.min(pos + SEGMENT_SIZE, content.length);
      
      // 在段落边界或句号处切分
      if (endPos < content.length) {
        // 优先找段落边界
        const paragraphBreak = content.lastIndexOf('\n\n', endPos);
        if (paragraphBreak > pos + SEGMENT_SIZE * 0.6) {
          endPos = paragraphBreak;
        } else {
          // 否则找句号
          const sentenceEnd = Math.max(
            content.lastIndexOf('。', endPos),
            content.lastIndexOf('！', endPos),
            content.lastIndexOf('？', endPos),
            content.lastIndexOf('"', endPos),
          );
          if (sentenceEnd > pos + SEGMENT_SIZE * 0.6) {
            endPos = sentenceEnd + 1;
          }
        }
      }

      const segmentContent = content.slice(pos, endPos).trim();
      const preview = segmentContent.slice(0, 100) + (segmentContent.length > 100 ? '...' : '');

      segments.push({
        id,
        charStart: pos,
        charEnd: endPos,
        content: segmentContent,
        preview,
      });

      pos = endPos;
      id++;
    }

    return segments;
  }

  // ==================== 全局上下文 + 智能章节划分 ====================

  private async generateContextAndChapters(
    content: string,
    title: string
  ): Promise<{ context: string; chapters: Chapter[]; knowledgeGraph?: KnowledgeGraph }> {
    if (!this.config.enablePreview) {
      return { context: '', chapters: [], knowledgeGraph: undefined };
    }

    console.log('[DeepReader] 生成全局上下文 + 智能章节划分...');

    const reader = new RLMReader({
      task: {
        ...TASK_SUMMARY,
        purpose: '全面阅读文档后，完成三项任务：1）提取核心背景信息；2）构建人物关系图谱；3）根据内容语义智能划分章节。',
        outputFormat: `
## 时代背景
（简述故事发生的时代、地点）

## 主要人物
（列出 5-10 个主要人物，简述身份和关系，用于后续改编参考）

## 情节主线
（简述故事主线，3-5 句话）

## 人物关系图谱
用 JSON 格式输出人物、关系、关键事件（必须是合法 JSON）：
\`\`\`json
{
  "characters": [
    {"id": "zhu_yuanzhang", "name": "朱元璋", "aliases": ["重八", "朱重八"], "role": "protagonist", "description": "布衣出身，后成明朝开国皇帝"},
    {"id": "ma_xiuying", "name": "马皇后", "aliases": ["马秀英"], "role": "supporting", "description": "朱元璋发妻，贤德善良"}
  ],
  "relationships": [
    {"from": "zhu_yuanzhang", "to": "ma_xiuying", "type": "夫妻", "description": "患难与共的发妻"}
  ],
  "events": [
    {"id": "join_hongyin", "name": "投奔红巾军", "characters": ["zhu_yuanzhang"], "description": "朱元璋投军郭子兴麾下"}
  ]
}
\`\`\`
要求：
- id 用英文小写+下划线，便于程序处理
- role 只能是 protagonist（主角）、antagonist（反派）、supporting（配角）三种
- 人物控制在 10-15 个，关系控制在 10-20 条，事件控制在 5-10 个
- 只提取主要人物和关键事件，不要过于琐碎

## 章节划分
请根据内容语义将全文划分为若干章节。要求：
- 每章 10000-20000 字为宜（不要太短也不要太长）
- 跳过目录、版权页、序言、附录等非正文内容
- 按故事情节的自然段落来划分，不必完全遵循原书章节
- 给每章起一个有吸引力的标题

用以下 JSON 格式输出（必须是合法 JSON 数组）：
\`\`\`json
[
  {"title": "章节标题", "startChunk": 1, "endChunk": 10, "summary": "一句话概要"},
  {"title": "章节标题", "startChunk": 11, "endChunk": 25, "summary": "一句话概要"}
]
\`\`\`

注意：startChunk 和 endChunk 是你阅读过的块编号（从 1 开始）。确保所有正文块都被覆盖，不要遗漏。
`,
      },
      model: this.config.model,
      baseURL: this.config.baseURL,
      enableCheckpoint: false,
    });

    const result = await reader.read({ content, title });
    const output = result.content || '';

    // 分离各个部分：全局上下文 | 人物关系图谱 | 章节划分
    const graphSectionIdx = output.indexOf('## 人物关系图谱');
    const chapterSectionIdx = output.indexOf('## 章节划分');

    let contextText = output;
    let graphJson = '';
    let chaptersJson = '';

    if (graphSectionIdx > -1 && chapterSectionIdx > -1) {
      // 全局上下文：从开头到人物关系图谱之前
      contextText = output.slice(0, graphSectionIdx).trim();
      // 图谱 JSON：从人物关系图谱到章节划分之前
      graphJson = output.slice(graphSectionIdx, chapterSectionIdx);
      // 章节 JSON：从章节划分到结尾
      chaptersJson = output.slice(chapterSectionIdx);
    } else if (chapterSectionIdx > -1) {
      // 没有图谱，只有章节划分
      contextText = output.slice(0, chapterSectionIdx).trim();
      chaptersJson = output.slice(chapterSectionIdx);
    }

    console.log(`[DeepReader] 全局上下文: ${contextText.length} 字`);

    // 解析知识图谱 JSON
    const knowledgeGraph = this.parseKnowledgeGraph(graphJson);
    if (knowledgeGraph) {
      console.log(`[DeepReader] 知识图谱: ${knowledgeGraph.characters.length} 人物, ${knowledgeGraph.relationships.length} 关系, ${knowledgeGraph.events.length} 事件`);
    }

    // 解析章节 JSON
    const chapters = this.parseChapterPlan(chaptersJson, content);
    console.log(`[DeepReader] 智能章节划分: ${chapters.length} 章`);

    return { context: contextText, chapters, knowledgeGraph };
  }

  /**
   * 从 RLM 输出中解析知识图谱 JSON
   */
  private parseKnowledgeGraph(rawOutput: string): KnowledgeGraph | undefined {
    if (!rawOutput || rawOutput.trim().length === 0) {
      return undefined;
    }

    try {
      // 提取 JSON（可能被 ```json ``` 包裹）
      let jsonStr = rawOutput;
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        // 尝试找 { ... } 对象
        const objMatch = rawOutput.match(/\{[\s\S]*\}/);
        if (objMatch) {
          jsonStr = objMatch[0];
        } else {
          console.warn('[DeepReader] 未找到知识图谱 JSON');
          return undefined;
        }
      }

      const graph = JSON.parse(jsonStr) as KnowledgeGraph;

      // 验证基本结构
      if (!graph.characters || !Array.isArray(graph.characters)) {
        console.warn('[DeepReader] 知识图谱缺少 characters 数组');
        return undefined;
      }

      // 确保每个 character 有 id
      graph.characters = graph.characters.map((c, i) => ({
        ...c,
        id: c.id || `char_${i}`,
        role: c.role || 'supporting',
      }));

      // 确保 relationships 和 events 存在
      graph.relationships = graph.relationships || [];
      graph.events = (graph.events || []).map((e, i) => ({
        ...e,
        id: e.id || `event_${i}`,
      }));

      return graph;
    } catch (err) {
      console.error('[DeepReader] 解析知识图谱失败:', err);
      return undefined;
    }
  }

  /**
   * 从 RLM 输出中解析章节划分 JSON，映射回原文内容
   */
  private parseChapterPlan(
    rawOutput: string,
    fullContent: string,
  ): Chapter[] {
    try {
      // 提取 JSON（可能被 ```json ``` 包裹）
      let jsonStr = rawOutput;
      const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        // 尝试找 [ ... ] 数组
        const arrayMatch = rawOutput.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          jsonStr = arrayMatch[0];
        } else {
          console.warn('[DeepReader] 未找到章节 JSON');
          return [];
        }
      }

      const plan = JSON.parse(jsonStr) as {
        title: string;
        startChunk: number;
        endChunk: number;
        summary?: string;
      }[];

      if (!Array.isArray(plan) || plan.length === 0) {
        console.warn('[DeepReader] 章节划分为空数组');
        return [];
      }

      // 用和 RLMReader 相同的切分方式重建 chunks
      const chunks: string[] = splitIntoParagraphs(fullContent, 2000);

      const chapters: Chapter[] = [];
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        const start = Math.max(1, p.startChunk);
        const end = Math.min(chunks.length, p.endChunk);

        // 拼接块内容
        const chapterContent = chunks.slice(start - 1, end).join('\n\n');

        if (chapterContent.length < 50) {
          console.warn(`[DeepReader] 章节 "${p.title}" 内容过短(${chapterContent.length}字)，跳过`);
          continue;
        }

        // 计算 charStart/charEnd
        let charStart = 0;
        for (let j = 0; j < start - 1; j++) {
          charStart += chunks[j].length + 2; // +2 for \n\n
        }
        const charEnd = charStart + chapterContent.length;

        chapters.push({
          index: chapters.length + 1,
          title: p.title || `第${chapters.length + 1}章`,
          content: chapterContent,
          charStart,
          charEnd,
        });
      }

      return chapters;
    } catch (err) {
      console.error('[DeepReader] 解析章节划分失败:', err);
      return [];
    }
  }

  // ==================== 工具处理函数 ====================

  private getChapterInfo(): ChapterInfo {
    return {
      totalChars: this.currentChapter?.content.length || 0,
      segmentCount: this.segments.length,
      segments: this.segments.map(s => ({
        id: s.id,
        charStart: s.charStart,
        charEnd: s.charEnd,
        charCount: s.content.length,
        preview: s.preview,
      })),
    };
  }

  private readSegment(segmentId: number): string {
    const segment = this.segments.find(s => s.id === segmentId);
    if (!segment) {
      return `错误：片段 ${segmentId} 不存在。有效范围是 1-${this.segments.length}`;
    }
    return segment.content;
  }

  /**
   * 单次生成评书内容（让模型自然写完）
   * 不强制字数，不分多轮，一次调用自然完成
   */
  private async handleSpawnWriter(input: SpawnWriterInput): Promise<SpawnWriterResult> {
    const segment = this.segments.find(s => s.id === input.segmentId);
    if (!segment) {
      return {
        segmentId: input.segmentId,
        content: `错误：片段 ${input.segmentId} 不存在`,
        charCount: 0,
      };
    }

    const originalText = segment.content;
    console.log(`    [Writer] 处理片段 ${input.segmentId}/${this.segments.length}（${originalText.length} 字）`);

    const writerLLM = this.createLLM(this.config.model, { temperature: 0.7 });

    // 一次性改写提示词（使用任务配置中的 role）
    const prompt = `${this.config.task.role}

## 原文
${originalText}

## 改写任务
场景标题：${input.sceneTitle}
${input.writingHints}

## 要求
- 忠于原文：对话原样保留，情节按原文顺序完整呈现
- 口语化：把书面语转成说书人讲故事的口吻，自然朴实
- 适度过渡：场景切换时加简短过渡语
- 不要加夸张比喻、大段点评、醒木音效
- 不要编造原文没有的内容
- 按原文顺序改写，不要遗漏
- 写完就结束，不用凑字数

请一次性完成改写：`;

    // 单次调用，自然写完
    const response = await writerLLM.invoke([
      { role: 'user', content: prompt }
    ]);

    const generatedContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 更新前情摘要
    this.previousSummary = generatedContent.slice(-200);
    
    // 标记已处理
    this.processedSegments.add(input.segmentId);

    // 写入输出（带小节标题）
    const sectionTitle = `### ${input.sceneTitle}\n\n`;
    if (this.outputStream) {
      this.outputStream.write(sectionTitle);
      this.outputStream.write(generatedContent);
      this.outputStream.write('\n\n');
    }
    this.output += sectionTitle + generatedContent + '\n\n';

    console.log(`    [Writer] 完成，输出 ${generatedContent.length} 字`);

    return {
      segmentId: input.segmentId,
      content: `已生成 ${generatedContent.length} 字评书内容`,
      charCount: generatedContent.length,
      generatedText: generatedContent,
    };
  }

  private appendOutput(content: string): number {
    if (this.outputStream) {
      this.outputStream.write(content);
      this.outputStream.write('\n\n');
    }
    this.output += content + '\n\n';
    return this.output.length;
  }

  private checkDone(): DoneCheckResult {
    const processedCount = this.processedSegments.size;
    const totalCount = this.segments.length;
    const canFinish = processedCount >= totalCount;

    return {
      canFinish,
      message: canFinish ? '所有片段已处理完成' : `还有 ${totalCount - processedCount} 个片段未处理`,
      processedSegments: processedCount,
      totalSegments: totalCount,
      outputChars: this.output.length,
    };
  }

  // ==================== 章节处理（Agent 模式） ====================

  private async processChapterWithAgent(chapter: Chapter, onProgress?: ChapterProgressCallback): Promise<string> {
    // 初始化状态
    this.currentChapter = chapter;
    this.segments = this.splitChapterIntoSegments(chapter);
    this.processedSegments = new Set();
    this.output = '';
    this.toolCallCount = 0;

    console.log(`  切分为 ${this.segments.length} 个片段`);

    // 构建 Commander 提示词
    const commanderPrompt = readPromptFile('commander.txt')
      .replace('{{role}}', this.config.task.role)
      .replace('{{purpose}}', this.config.task.purpose)
      .replace('{{globalContext}}', this.globalContext.slice(0, 500) || '（无全局上下文）');

    // 创建工具
    const tools = [
      createGetChapterInfoTool(() => {
        this.toolCallCount++;
        console.log(`  [工具 #${this.toolCallCount}] get_chapter_info`);
        const info = this.getChapterInfo();
        console.log(`    -> ${info.segmentCount} 个片段，共 ${info.totalChars} 字`);
        return info;
      }),
      createReadSegmentTool((segmentId) => {
        this.toolCallCount++;
        console.log(`  [工具 #${this.toolCallCount}] read_segment(${segmentId})`);
        return this.readSegment(segmentId);
      }),
      createSpawnWriterTool(async (input) => {
        this.toolCallCount++;
        console.log(`  [工具 #${this.toolCallCount}] spawn_writer(${input.segmentId}, "${input.sceneTitle}")`);
        onProgress?.({ type: 'segment_start', segmentId: input.segmentId, totalSegments: this.segments.length });
        const result = await this.handleSpawnWriter(input);
        // 通过 SSE 把生成的内容实时推送到前端
        const sectionOutput = `### ${input.sceneTitle}\n\n${result.generatedText}`;
        onProgress?.({
          type: 'segment_done',
          segmentId: input.segmentId,
          totalSegments: this.segments.length,
          charCount: result.charCount,
          segmentContent: sectionOutput,
          segmentTitle: input.sceneTitle,
        });
        return result;
      }),
      // append_output 已移除，spawn_writer 直接写入输出
      createDeepReaderDoneTool(() => {
        this.toolCallCount++;
        const result = this.checkDone();
        console.log(`  [工具 #${this.toolCallCount}] done -> ${result.canFinish ? '✓ 完成' : '✗ 未完成'}`);
        return result;
      }),
    ];

    // 创建 Agent
    const llm = this.createLLM(this.config.model);
    const agent: any = createDeepAgent({
      model: llm, // 注意：参数名是 model，不是 llm
      tools,
      systemPrompt: commanderPrompt,
    });

    // 运行 Agent
    const initMessage = `开始处理章节：${chapter.title}（共 ${chapter.content.length} 字）`;
    
    try {
      await agent.invoke(
        { messages: [{ role: 'user', content: initMessage }] },
        { recursionLimit: 300 }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('Recursion limit')) {
        throw error;
      }
      // 递归限制到达，检查是否已完成足够内容
      console.log(`  [警告] 递归限制到达，已处理 ${this.processedSegments.size}/${this.segments.length} 个片段`);
    }

    // 提取本章摘要
    const summary = this.output.slice(0, 200);
    this.chapterSummaries.push(summary);

    return this.output;
  }

  // ==================== 分步 API 支持 ====================

  /**
   * 初始化会话：解析文档、切分章节、生成全局上下文
   * 供 /api/read/init 使用
   */
  async initSession(input: DocumentInput): Promise<DeepReaderSession> {
    const content = input.content;
    const title = input.title || '未命名';

    console.log(`[DeepReader] initSession: ${title} (${content.length.toLocaleString()} 字)`);

    // RLM 速读：一次性生成全局上下文 + 智能章节划分 + 知识图谱
    const { context, chapters, knowledgeGraph } = await this.generateContextAndChapters(content, title);
    this.globalContext = context;
    this.chapters = chapters;

    if (this.chapters.length === 0) {
      throw new Error('RLM 章节划分失败：未能识别出任何章节，请检查文档内容');
    }
    console.log(`[DeepReader] RLM 智能章节划分: ${this.chapters.length} 章`);

    // 准备输出路径
    const outputDir = path.join(process.cwd(), 'out', 'deep');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = title.replace(/\.[^.]+$/, '');
    const outputFileName = `${baseName}_deep_${timestamp}.md`;
    const ttsFileName = `${baseName}_deep_${timestamp}_tts.txt`;

    // 写入文件头
    const outputPath = path.join(outputDir, outputFileName);
    const header = `# ${title}\n\n> 生成时间: ${new Date().toLocaleString('zh-CN')}\n> 原文字数: ${content.length.toLocaleString()}\n> 章节数: ${this.chapters.length}\n> 模式: Agent (分片段处理)\n\n---\n\n`;
    fs.writeFileSync(outputPath, header, 'utf-8');

    const sessionId = crypto.randomUUID();

    return {
      id: sessionId,
      title,
      content,
      chapters: this.chapters,
      globalContext: this.globalContext,
      chapterSummaries: [],
      outputPath: `out/deep/${outputFileName}`,
      ttsOutputPath: `out/deep/${ttsFileName}`,
      outputDir,
      baseName,
      timestamp,
      completedChapters: [],
      createdAt: Date.now(),
      knowledgeGraph,
    };
  }

  /**
   * 处理单章：供 /api/read/chapter 使用
   * 接收会话数据和章节索引，返回章节输出文本
   */
  async processOneChapter(
    session: DeepReaderSession,
    chapterIndex: number,
    onProgress?: ChapterProgressCallback,
  ): Promise<{ output: string; charCount: number }> {
    const chapter = session.chapters[chapterIndex];
    if (!chapter) {
      throw new Error(`章节索引 ${chapterIndex} 不存在`);
    }

    // 恢复状态
    this.globalContext = session.globalContext;
    this.chapterSummaries = session.chapterSummaries;

    console.log(`[章节 ${chapterIndex + 1}/${session.chapters.length}] ${chapter.title}（${chapter.content.length} 字）`);

    // 处理章节
    const chapterOutput = await this.processChapterWithAgent(chapter, onProgress);

    // 追加到输出文件
    const fullOutputPath = path.join(process.cwd(), session.outputPath);
    fs.appendFileSync(fullOutputPath, `## ${chapter.title}\n\n${chapterOutput}\n\n---\n\n`, 'utf-8');

    // 记录完成
    session.completedChapters.push(chapterIndex);
    session.chapterSummaries.push(chapterOutput.slice(0, 200));

    // 如果是最后一章，生成 TTS 版本
    if (session.completedChapters.length === session.chapters.length) {
      const fullOutput = fs.readFileSync(fullOutputPath, 'utf-8');
      const ttsContent = cleanForTTS(fullOutput);
      const ttsFullPath = path.join(process.cwd(), session.ttsOutputPath);
      fs.writeFileSync(ttsFullPath, ttsContent, 'utf-8');
      console.log(`[DeepReader] TTS 清洗版已生成: ${session.ttsOutputPath}`);
    }

    onProgress?.({ type: 'chapter_done', outputChars: chapterOutput.length });

    return { output: chapterOutput, charCount: chapterOutput.length };
  }

  // ==================== 主入口 ====================

  async read(input: DocumentInput): Promise<DeepReaderOutput> {
    const startTime = Date.now();

    console.log('');
    console.log('========== DeepReader Agent 模式开始 ==========');
    console.log(`文档: ${input.title || '未命名'} (${input.content.length.toLocaleString()} 字)`);
    console.log(`任务: ${this.config.task.purpose}`);
    console.log(`模型: ${this.config.model}`);

    // 1. RLM 速读 + 智能章节划分 + 知识图谱
    const { context, chapters, knowledgeGraph } = await this.generateContextAndChapters(input.content, input.title || '');
    this.globalContext = context;
    this.chapters = chapters;

    if (this.chapters.length === 0) {
      throw new Error('RLM 章节划分失败');
    }
    console.log(`章节数: ${this.chapters.length}`);
    if (knowledgeGraph) {
      console.log(`知识图谱: ${knowledgeGraph.characters.length} 人物`);
    }

    // 3. 准备输出文件
    const outputDir = path.join(process.cwd(), 'out', 'deep');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = (input.title || 'document').replace(/\.[^.]+$/, '');
    const outputFileName = `${baseName}_deep_${timestamp}.md`;
    const outputPath = path.join(outputDir, outputFileName);

    // 4. 创建输出流
    this.outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
    this.outputStream.write(`# ${input.title || '精读输出'}\n\n`);
    this.outputStream.write(`> 生成时间: ${new Date().toLocaleString('zh-CN')}\n`);
    this.outputStream.write(`> 原文字数: ${input.content.length.toLocaleString()}\n`);
    this.outputStream.write(`> 章节数: ${this.chapters.length}\n`);
    this.outputStream.write(`> 模式: Agent (分片段处理)\n\n`);
    this.outputStream.write(`---\n\n`);

    // 5. 逐章处理
    let totalWords = 0;

    console.log('');
    console.log('开始逐章处理（Agent 模式）...');

    for (let i = 0; i < this.chapters.length; i++) {
      const chapter = this.chapters[i];
      console.log('');
      console.log(`[章节 ${i + 1}/${this.chapters.length}] ${chapter.title}（${chapter.content.length} 字）`);

      try {
        // 写入章节标题
        this.outputStream.write(`## ${chapter.title}\n\n`);
        
        const chapterOutput = await this.processChapterWithAgent(chapter);
        totalWords += chapterOutput.length;

        this.outputStream.write('\n---\n\n');
        console.log(`  ✓ 章节完成，输出 ${chapterOutput.length.toLocaleString()} 字`);

        // 短暂延迟
        if (i < this.chapters.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`  ✗ 失败: ${errorMsg}`);
        this.outputStream.write(`[处理失败: ${errorMsg}]\n\n---\n\n`);
      }
    }

    this.outputStream.end();

    // 6. 生成 TTS 清洗版本（去掉舞台指示、Markdown 格式）
    const ttsFileName = `${baseName}_deep_${timestamp}_tts.txt`;
    const ttsPath = path.join(outputDir, ttsFileName);
    const ttsContent = cleanForTTS(this.output);
    fs.writeFileSync(ttsPath, ttsContent, 'utf-8');
    console.log(`TTS 清洗版: ${ttsPath} (${ttsContent.length.toLocaleString()} 字)`);

    const duration = (Date.now() - startTime) / 1000;

    console.log('');
    console.log('========== DeepReader Agent 模式完成 ==========');
    console.log(`章节数: ${this.chapters.length}`);
    console.log(`输出字数: ${totalWords.toLocaleString()}`);
    console.log(`TTS 版字数: ${ttsContent.length.toLocaleString()}`);
    console.log(`耗时: ${duration.toFixed(1)} 秒`);
    console.log(`输出文件: ${outputPath}`);
    console.log(`TTS 文件: ${ttsPath}`);
    console.log('');

    return {
      outputPath: `out/deep/${outputFileName}`,
      ttsOutputPath: `out/deep/${ttsFileName}`,
      chapterCount: this.chapters.length,
      totalWords,
      globalContext: this.globalContext,
      duration,
    };
  }
}

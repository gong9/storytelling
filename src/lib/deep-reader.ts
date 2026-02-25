/**
 * DeepReader 精读处理器 (Agent 模式)
 * 
 * 采用 RLM 的 Agent 工具调用模式：
 * - Commander Agent 规划场景切分
 * - Writer SubAgent 逐片段生成评书
 * - 每次只处理 2000-3000 字，避免长文本退化
 */

import fs from 'fs';
import path from 'path';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { RLMReader } from './rlm-reader';
import { TASK_SUMMARY } from './prompts/rlm';
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

  // ==================== 章节切分 ====================

  private splitIntoChapters(content: string): Chapter[] {
    const chapterPattern = /第[一二三四五六七八九十百千\d]+[章回节篇]/g;
    const matches = [...content.matchAll(chapterPattern)];

    if (matches.length >= 3) {
      console.log(`[DeepReader] 识别到 ${matches.length} 个章节标记`);
      return this.splitByMarkers(content, matches);
    }

    console.log(`[DeepReader] 未识别到章节标记，按 ${this.config.chapterSize} 字切分`);
    return this.splitByLength(content, this.config.chapterSize);
  }

  private splitByMarkers(content: string, matches: RegExpMatchArray[]): Chapter[] {
    const chapters: Chapter[] = [];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const startPos = match.index!;
      const endPos = i < matches.length - 1 ? matches[i + 1].index! : content.length;
      chapters.push({
        index: i + 1,
        title: match[0],
        content: content.slice(startPos, endPos).trim(),
        charStart: startPos,
        charEnd: endPos,
      });
    }
    return chapters;
  }

  private splitByLength(content: string, chunkSize: number): Chapter[] {
    const chapters: Chapter[] = [];
    let pos = 0;
    let index = 1;
    while (pos < content.length) {
      let endPos = Math.min(pos + chunkSize, content.length);
      if (endPos < content.length) {
        const nextParagraph = content.indexOf('\n\n', endPos - 500);
        if (nextParagraph > 0 && nextParagraph < endPos + 500) {
          endPos = nextParagraph;
        }
      }
      chapters.push({
        index,
        title: `第${index}节`,
        content: content.slice(pos, endPos).trim(),
        charStart: pos,
        charEnd: endPos,
      });
      pos = endPos;
      index++;
    }
    return chapters;
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

  // ==================== 全局上下文 ====================

  private async generateGlobalContext(content: string, title: string): Promise<string> {
    if (!this.config.enablePreview) {
      return '';
    }

    console.log('[DeepReader] 生成全局上下文（速读预览）...');

    const reader = new RLMReader({
      task: {
        ...TASK_SUMMARY,
        purpose: '快速提取文档的核心背景信息，包括：主要人物及其关系、时代背景、情节主线。',
        outputFormat: `
## 时代背景
（简述故事发生的时代、地点）

## 主要人物
（列出 5-10 个主要人物，简述身份和关系）

## 情节主线
（简述故事主线，3-5 句话）
`,
      },
      model: this.config.model,
      baseURL: this.config.baseURL,
      enableCheckpoint: false, // 速读预览每次完整执行，不需要记录历史
    });

    const result = await reader.read({ content, title });
    console.log(`[DeepReader] 全局上下文生成完成（${result.content.length} 字）`);
    return result.content;
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

  private async processChapterWithAgent(chapter: Chapter): Promise<string> {
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
        return this.handleSpawnWriter(input);
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

  // ==================== 主入口 ====================

  async read(input: DocumentInput): Promise<DeepReaderOutput> {
    const startTime = Date.now();

    console.log('');
    console.log('========== DeepReader Agent 模式开始 ==========');
    console.log(`文档: ${input.title || '未命名'} (${input.content.length.toLocaleString()} 字)`);
    console.log(`任务: ${this.config.task.purpose}`);
    console.log(`模型: ${this.config.model}`);

    // 1. 章节切分
    this.chapters = this.splitIntoChapters(input.content);
    console.log(`章节数: ${this.chapters.length}`);

    // 2. 生成全局上下文
    if (this.config.enablePreview) {
      this.globalContext = await this.generateGlobalContext(input.content, input.title || '');
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

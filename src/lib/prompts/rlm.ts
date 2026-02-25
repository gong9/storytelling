/**
 * RLM (Recursive Language Model) 阅读器提示词
 */

import fs from 'fs';
import path from 'path';
import type { RLMTaskConfig } from '../types';

// ==================== 文件路径 ====================

// Next.js 编译后 __dirname 不可靠，使用 process.cwd() 定位项目根目录
const PROMPTS_DIR = path.join(process.cwd(), 'src/lib/prompts/rlm');

function readPromptFile(relativePath: string): string {
  const fullPath = path.join(PROMPTS_DIR, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    console.warn(`[RLM] 无法读取提示词文件: ${relativePath}`);
    return '';
  }
}

function readJsonFile<T>(relativePath: string): T {
  const content = readPromptFile(relativePath);
  try {
    return JSON.parse(content) as T;
  } catch {
    console.warn(`[RLM] 无法解析 JSON 文件: ${relativePath}`);
    return {} as T;
  }
}

// ==================== 基础提示词（从文件加载） ====================

/** 工具说明 */
export const RLM_TOOLS_SECTION = readPromptFile('tools.txt');

/** 方法论 */
export const RLM_METHODOLOGY_SECTION = readPromptFile('methodology.txt');

// ==================== 任务配置解析 ====================

interface TaskFile {
  role: string;
  purpose: string;
  outputFormat: string;
  principles?: string[];
}

function parseTaskFile(content: string): TaskFile {
  // 解析 YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let role = '';
  let purpose = '';

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    const roleMatch = frontmatter.match(/role:\s*(.+)/);
    const purposeMatch = frontmatter.match(/purpose:\s*(.+)/);
    if (roleMatch) role = roleMatch[1].trim();
    if (purposeMatch) purpose = purposeMatch[1].trim();
  }

  // 解析正文
  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '');

  // 提取输出格式
  const outputFormatMatch = body.match(/## 输出格式\n\n([\s\S]*?)(?=\n## |$)/);
  const outputFormat = outputFormatMatch ? outputFormatMatch[1].trim() : '';

  // 提取原则
  const principlesMatch = body.match(/## 原则\n\n([\s\S]*?)(?=\n## |$)/);
  let principles: string[] = [];
  if (principlesMatch) {
    principles = principlesMatch[1]
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim());
  }

  return { role, purpose, outputFormat, principles };
}

function loadTaskConfig(filename: string): RLMTaskConfig {
  const content = readPromptFile(`tasks/${filename}`);
  const parsed = parseTaskFile(content);
  return {
    role: parsed.role,
    purpose: parsed.purpose,
    outputFormat: parsed.outputFormat,
    principles: parsed.principles,
  };
}

// ==================== 预设任务（从文件加载） ====================

/** 预设任务：学习笔记 */
export const TASK_STUDY_NOTES: RLMTaskConfig = loadTaskConfig('study-notes.txt');

/** 预设任务：内容摘要 */
export const TASK_SUMMARY: RLMTaskConfig = loadTaskConfig('summary.txt');

/** 预设任务：教学知识点提取 */
export const TASK_TEACHING_POINTS: RLMTaskConfig = loadTaskConfig('teaching.txt');

/** 预设任务：论文分析 */
export const TASK_PAPER_ANALYSIS: RLMTaskConfig = loadTaskConfig('paper.txt');

/** 预设任务：评书改编（单田芳风格） */
export const TASK_PINGSHU: RLMTaskConfig = {
  ...loadTaskConfig('pingshu.txt'),
  minCoverage: 0.1, // 评书任务允许采样阅读，只需 10% 覆盖率
};

// ==================== 组装函数 ====================

/**
 * 构建 RLM 提示词
 * @param task 任务配置
 * @returns 完整的系统提示词
 */
export function buildRLMPrompt(task: RLMTaskConfig): string {
  const principlesSection = task.principles?.length
    ? `## 原则\n${task.principles.map((p) => `- ${p}`).join('\n')}`
    : '';

  return `${task.role}

## 你的任务
${task.purpose}

${RLM_TOOLS_SECTION}

${RLM_METHODOLOGY_SECTION}

## 输出要求
${task.outputFormat}

${principlesSection}`;
}

// ==================== 运行时提示词模板 ====================

const INIT_MESSAGE_TEMPLATE = readPromptFile('runtime/init-message.txt');
const SUB_READER_TEMPLATE = readPromptFile('runtime/sub-reader.txt');
const CHAPTER_MERGER_TEMPLATE = readPromptFile('runtime/chapter-merger.txt');

/**
 * 构建初始化消息
 * @param title 文档标题
 */
export function buildInitMessage(title?: string): string {
  return INIT_MESSAGE_TEMPLATE.replace('{{title}}', title || '未知');
}

/**
 * 构建子 Agent 阅读提示词
 * @param question 要回答的问题
 * @param content 相关内容
 */
export function buildSubReaderPrompt(question: string, content: string): string {
  return SUB_READER_TEMPLATE.replace('{{question}}', question).replace('{{content}}', content);
}

/**
 * 格式化块内容（用于子 Agent）
 * @param index 块编号
 * @param content 块内容
 */
export function formatChunkContent(index: number, content: string): string {
  return `【块 ${index}】\n${content}`;
}


/**
 * 构建章节整合提示词
 * @param rawChapters 原始章节片段 JSON
 * @param totalChunks 总块数
 * @param title 文档标题
 */
export function buildChapterMergerPrompt(rawChapters: string, totalChunks: number, title: string): string {
  return CHAPTER_MERGER_TEMPLATE
    .replace('{{rawChapters}}', rawChapters)
    .replace(/\{\{totalChunks\}\}/g, String(totalChunks))
    .replace('{{title}}', title || '未知');
}

// ==================== 错误/状态消息 ====================

interface MessageTemplates {
  EMPTY_DOCUMENT: string;
  NO_OUTPUT: string;
  OUTPUT_UPDATED: string;
  OUTPUT_EMPTY: string;
  CHUNK_NOT_FOUND: string;
  UNKNOWN_TOOL: string;
  READER_ERROR: string;
  PROCESS_ERROR: string;
  TOO_MANY_MESSAGES: string;
}

const MESSAGE_TEMPLATES = readJsonFile<MessageTemplates>('messages.json');

export const RLM_MESSAGES = {
  EMPTY_DOCUMENT: MESSAGE_TEMPLATES.EMPTY_DOCUMENT || '文档内容为空或太短，无法处理',
  NO_OUTPUT: MESSAGE_TEMPLATES.NO_OUTPUT || '阅读完成但未生成输出',
  OUTPUT_UPDATED: MESSAGE_TEMPLATES.OUTPUT_UPDATED || '输出已更新',
  OUTPUT_EMPTY: MESSAGE_TEMPLATES.OUTPUT_EMPTY || '（输出为空）',
  CHUNK_NOT_FOUND: (index: number) =>
    (MESSAGE_TEMPLATES.CHUNK_NOT_FOUND || '块 {{index}} 不存在').replace('{{index}}', String(index)),
  UNKNOWN_TOOL: (name: string) =>
    (MESSAGE_TEMPLATES.UNKNOWN_TOOL || '未知工具: {{name}}').replace('{{name}}', name),
  READER_ERROR: (msg: string) =>
    (MESSAGE_TEMPLATES.READER_ERROR || '阅读助手出错: {{message}}').replace('{{message}}', msg),
  PROCESS_ERROR: (msg: string) =>
    (MESSAGE_TEMPLATES.PROCESS_ERROR || '阅读过程出错: {{message}}').replace('{{message}}', msg),
  TOO_MANY_MESSAGES: MESSAGE_TEMPLATES.TOO_MANY_MESSAGES || '[RLMReader] 消息过多，强制结束',
};

// ==================== 默认导出 ====================

/** 默认系统提示词（学习笔记任务） */
export const RLM_READER_SYSTEM = buildRLMPrompt(TASK_STUDY_NOTES);

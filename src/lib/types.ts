/**
 * DeepAgents 类型定义
 * 
 * 基于 deepagents-react-design.md 设计文档
 */

// ==================== 任务状态 ====================

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt?: Date;
  completedAt?: Date;
}

// ==================== 执行计划 ====================

export interface ExecutionPlan {
  goal: string;
  strategy: string;
  steps: PlanStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanStep {
  id: number;
  tool: string;
  reason: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  duration?: number;
}

// ==================== 执行日志 ====================

export interface ExecutionLog {
  taskId: string;
  taskType: string;
  contentFeatures: ContentFeatures;
  steps: ExecutionStep[];
  finalOutput?: Record<string, unknown>;
  humanScore?: number;
  humanFeedback?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface ContentFeatures {
  hasCode?: boolean;
  complexity?: 'low' | 'medium' | 'high';
  topic?: string;
  type?: string;
  wordCount?: number;
}

export interface ExecutionStep {
  step: number;
  tool: string;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  evaluation: 'success' | 'warning' | 'needs_fix' | 'failed';
  decision?: string;
  recovery?: RecoveryAction;
  duration?: number;
  timestamp: Date;
}

export interface RecoveryAction {
  tool: string;
  reason: string;
  focus?: string;
}

// ==================== 经验库 ====================

export interface Experience {
  id: string;
  taskType: string;
  contentFeatures: ContentFeatures;
  executionPath: string[];
  finalQuality: number;
  lessons: string[];
  humanFeedback?: string;
  createdAt: Date;
}

export interface Strategy {
  id: string;
  applicableWhen: string[];
  recommendedSteps: string[];
  successRate: number;
  sampleSize: number;
}

export interface Pattern {
  id: string;
  problem: string;
  solution: string;
  tool: string;
  focus?: string;
  effectiveness: number;
  usageCount: number;
}

// ==================== 子 Agent 配置 ====================

export interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
}

export interface SubAgentResult {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
  duration?: number;
}

// ==================== 教学相关类型 ====================

export interface TeachingPlan {
  chapter: string;
  summary: string;
  teachingGoals: string[];
  keyConcepts: string[];
  sections: TeachingSection[];
  totalDurationMinutes: number;
  sceneType: string;
  notes?: string;
}

export interface TeachingSection {
  title: string;
  keyPoints: string[];
  durationMinutes: number;
  notes?: string;
  type?: string;
}

export interface ReviewResult {
  overallScore: number;
  passed: boolean;
  strengths: string[];
  suggestions: ReviewSuggestion[];
  missingTopics: string[];
}

export interface ReviewSuggestion {
  type: 'content' | 'structure' | 'expression';
  severity: 'high' | 'medium' | 'low';
  location: string;
  issue: string;
  suggestion: string;
}

// ==================== HITL 配置 ====================

export interface HITLConfig {
  enabled: boolean;
  checkpoints: ('plan_review' | 'draft_review' | 'final_approval')[];
  timeoutSeconds: number;
  autoApproveScore?: number;
}

export interface HITLCheckpoint {
  id: string;
  type: 'plan_review' | 'draft_review' | 'final_approval';
  data: Record<string, unknown>;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  decision?: 'approve' | 'reject' | 'edit';
  feedback?: string;
  editedData?: Record<string, unknown>;
  createdAt: Date;
  resolvedAt?: Date;
}

// ==================== Agent 输入/输出 ====================

export interface TeachingAgentInput {
  knowledgeBaseId: string;
  chapterTitle: string;
  chapterContent: string;
  sceneType?: string;
  hitlConfig?: HITLConfig;
}

export interface TeachingAgentOutput {
  success: boolean;
  plan?: TeachingPlan;
  draft?: string;
  review?: ReviewResult;
  enrichedContent?: string;
  outputPath?: string;
  todos: Todo[];
  traceId?: string;
  error?: string;
}

// ==================== 工作区文件结构 ====================

export interface WorkspaceFiles {
  plan: string;              // /workspace/{task_id}/plan.json
  executionLog: string;      // /workspace/{task_id}/execution_log.json
  outputs: string;           // /workspace/{task_id}/outputs/
  reflection: string;        // /workspace/{task_id}/reflection.json
}

// ==================== Agent 配置 ====================

export interface DeepAgentConfig {
  model: string;
  temperature?: number;
  maxRetries?: number;
  workspaceRoot?: string;
  experienceStoreEnabled?: boolean;
  hitlConfig?: HITLConfig;
}

// ==================== RLM 阅读器类型 ====================

/** 文档输入 */
export interface DocumentInput {
  content: string;
  title?: string;
}

/** 文档块 */
export interface DocumentChunk {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
}

/** 文档统计 */
export interface DocumentStats {
  totalChars: number;
  totalChunks: number;
  avgChunkSize: number;
}

/** 块预览 */
export interface ChunkPreview {
  index: number;
  preview: string;
  charCount: number;
}

/** RLM 阅读器输出 */
export interface RLMOutput {
  content: string;
  metadata?: Record<string, unknown>;
}

// ==================== RLM 任务配置 ====================

/** RLM 任务配置接口 */
export interface RLMTaskConfig {
  /** 角色定义 */
  role: string;
  /** 阅读目的 */
  purpose: string;
  /** 输出格式要求 */
  outputFormat: string;
  /** 额外原则 */
  principles?: string[];
  /** 最低覆盖率要求 (0-1)，默认 0.8 (80%) */
  minCoverage?: number;
}

/** RLM 阅读器配置 */
export interface RLMReaderConfig {
  /** 任务配置 */
  task?: RLMTaskConfig;
  /** 块大小（默认 2000） */
  chunkSize?: number;
  /** 主模型 */
  model?: string;
  /** 模型提供商 (openai, anthropic, google, 等) */
  modelProvider?: string;
  /** 子 Agent 模型 */
  subAgentModel?: string;
  /** 子 Agent 模型提供商 */
  subAgentModelProvider?: string;
  /** API Base URL (用于 DashScope 等兼容 OpenAI 的 API) */
  baseURL?: string;
  /** 最大递归次数（默认 100） */
  recursionLimit?: number;
  /** 是否启用 checkpointer 断点续读（默认 false） */
  enableCheckpoint?: boolean;
}

// ==================== RLM 状态 (Checkpointer) ====================

/** RLM 阅读状态（用于 LangGraph state 管理） */
export interface RLMState {
  /** 已读块的索引列表 */
  readChunks: number[];
  /** 当前生成的输出内容 */
  output: string;
  /** 文档总块数 */
  totalChunks: number;
  /** 文档唯一标识（用于 thread_id） */
  documentId: string;
  /** 任务类型 */
  taskType: string;
}

// ==================== DeepReader 精读模式类型 ====================

/** 章节信息 */
export interface Chapter {
  /** 章节索引（从 1 开始） */
  index: number;
  /** 章节标题（如"第一章"） */
  title: string;
  /** 章节内容 */
  content: string;
  /** 起始字符位置 */
  charStart: number;
  /** 结束字符位置 */
  charEnd: number;
}

/** 精读任务配置 */
export interface DeepReadTaskConfig {
  /** 角色定义 */
  role: string;
  /** 任务目的 */
  purpose: string;
  /** 每章处理的提示词模板（支持 {{chapter}}, {{context}}, {{previous}} 占位符） */
  chapterPrompt: string;
  /** 输出模式：expand（展开）、preserve（保持）、compress（压缩） */
  outputMode: 'expand' | 'preserve' | 'compress';
  /** 传递多少前文上下文（章数，默认 2） */
  contextChapters?: number;
  /** 每章最大输出字数（可选） */
  maxOutputPerChapter?: number;
}

/** DeepReader 配置 */
export interface DeepReaderConfig {
  /** 精读任务配置 */
  task: DeepReadTaskConfig;
  /** 章节切分大小（如果无法识别章节标记时使用，默认 5000） */
  chapterSize?: number;
  /** 模型 */
  model?: string;
  /** API Base URL */
  baseURL?: string;
  /** 是否启用速读预览（生成全局上下文，默认 true） */
  enablePreview?: boolean;
  /** 速读预览的最大输出字数（默认 2000） */
  previewMaxWords?: number;
}

/** DeepReader 输出 */
export interface DeepReaderOutput {
  /** 输出文件路径（原始 Markdown，含舞台指示） */
  outputPath: string;
  /** TTS 清洗版文件路径（纯文本，可直接喂 TTS） */
  ttsOutputPath?: string;
  /** 处理的章节数 */
  chapterCount: number;
  /** 总输出字数 */
  totalWords: number;
  /** 全局上下文（速读生成） */
  globalContext?: string;
  /** 处理耗时（秒） */
  duration: number;
}

// ==================== 知识图谱类型 ====================

/** 人物角色类型 */
export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting';

/** 人物信息 */
export interface Character {
  /** 唯一标识（用于前端渲染和关系引用） */
  id: string;
  /** 人物名称 */
  name: string;
  /** 别名/外号 */
  aliases?: string[];
  /** 角色类型 */
  role: CharacterRole;
  /** 一句话描述 */
  description: string;
}

/** 人物关系 */
export interface Relationship {
  /** 关系起点人物 id */
  from: string;
  /** 关系终点人物 id */
  to: string;
  /** 关系类型（夫妻/父子/主仆/敌对/同盟等） */
  type: string;
  /** 关系描述 */
  description?: string;
}

/** 故事事件 */
export interface StoryEvent {
  /** 唯一标识 */
  id: string;
  /** 事件名称 */
  name: string;
  /** 涉及的人物 id 列表 */
  characters: string[];
  /** 出现的章节索引 */
  chapter?: number;
  /** 事件描述 */
  description: string;
}

/** 知识图谱 */
export interface KnowledgeGraph {
  /** 人物列表 */
  characters: Character[];
  /** 关系列表 */
  relationships: Relationship[];
  /** 事件列表 */
  events: StoryEvent[];
}

# 评书工坊

AI 评书改编 + TTS 语音合成。

上传小说，AI 先递归扫描全文，识别章节结构并提取人物、背景等全局上下文；再逐章改编为评书风格文本，最后合成语音。支持任意长度文档

## 快速开始

```bash
pnpm install
pnpm dev  # http://localhost:3100
```

需要配置 `.env`：

```
OPENAI_API_KEY=...       # 兼容 OpenAI 的 LLM（默认用 qwen-plus）
OPENAI_BASE_URL=...
MINIMAX_API_KEY=...      # TTS 语音合成
```

## 使用流程

1. 打开 `http://localhost:3100`，拖拽上传 PDF / TXT / MD 文件
2. 等待 AI 解析文档、生成全局上下文（实时日志可视）
3. 点击「开始生成」，逐章改编为评书文本，支持随时暂停/继续
4. 左侧章节列表点击已完成章节，右侧面板按回查看内容
5. 每回可独立点击合成语音并在线播放（MiniMax audiobook_male_1 有声书音色）
6. 关闭页面后，历史记录自动保留，下次可断点续生成

## 技术

- **[deepagents](https://github.com/morpheus-101/deepagents)**：底层 Agent 框架，提供工具调用、子 Agent 派生、Checkpointer 等能力，DeepReader 和 RLMReader 均基于此构建
- **RLM 递归阅读**：主 Agent + 子 Agent 分治并行，突破上下文窗口限制，可处理任意长度文档
- **DeepReader 分片段精读**：将章节切分为 2500 字片段，Commander Agent 规划场景 → Writer SubAgent 逐段改写，避免长上下文退化导致内容丢失或质量下降

## 架构

```
前端         ── 左右双栏，章节时间线 + 阅读面板，暂停/继续/断点续生成
DeepReader   ── Commander Agent 规划 → Writer SubAgent 逐段生成
RLMReader    ── 递归 Agent 自主决策阅读策略，支持并行子 Agent
TTS          ── MiniMax speech-2.8-hd，audiobook_male_1 有声书音色，单回合成+播放
```

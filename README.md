# 评书工坊

AI 评书改编 + TTS 语音合成。上传小说 PDF，自动逐章改编为评书风格文本，再合成为语音。

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

## API

### 评书改编 `POST /api/read`

上传 PDF/TXT/MD 文件，AI 逐章精读改编为评书文本。

```bash
# 精读改编（默认）
curl -X POST -F "file=@book.pdf" http://localhost:3100/api/read

# 速读摘要
curl -X POST -F "file=@book.pdf" -F "mode=skim" -F "task=summary" http://localhost:3100/api/read
```

| 参数 | 说明 |
|------|------|
| `file` | PDF / TXT / MD 文件 |
| `mode` | `deep`（精读改编，默认） \| `skim`（速读摘要） |
| `task` | `pingshu`（默认） \| `summary` \| `study-notes` |

输出：`out/deep/` 目录下的 Markdown + TTS 清洗文本。

### TTS 语音合成 `POST /api/tts`

将改编后的评书文本按回目拆分，逐回生成 MP3 音频（MiniMax speech-2.8-hd）。

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"filePath":"out/deep/xxx_tts.txt","speed":1.3}' \
  http://localhost:3100/api/tts
```

| 参数 | 说明 |
|------|------|
| `filePath` | 评书文本路径（md 文件会自动清洗） |
| `voiceId` | 音色 ID（默认用复刻音色） |
| `speed` | 语速，默认 1 |

输出：`out/audio/` 目录下每回一个 MP3，SSE 流式返回进度。

## 技术

- **[deepagents](https://github.com/morpheus-101/deepagents)**：底层 Agent 框架，提供工具调用、子 Agent 派生、Checkpointer 等能力，DeepReader 和 RLMReader 均基于此构建
- **RLM 递归阅读**：主 Agent + 子 Agent 分治并行，突破上下文窗口限制，可处理任意长度文档
- **DeepReader 分片段精读**：将章节切分为 2500 字片段，Commander Agent 规划场景 → Writer SubAgent 逐段改写，避免长上下文退化导致内容丢失或质量下降

## 架构

```
DeepReader（精读）── Commander Agent 规划 → Writer SubAgent 逐段生成
RLMReader （速读）── 递归 Agent 自主决策阅读策略，支持并行子 Agent
TTS        ── MiniMax speech-2.8-hd，自动按回目拆分 + 长文本分段合成
```

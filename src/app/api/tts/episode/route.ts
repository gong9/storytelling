/**
 * 单回 TTS 合成 API（同步快速 + ASR 字幕）
 *
 * POST /api/tts/episode
 * Body: { text, title?, speed?, sessionId?, episodeKey? }
 *
 * 1. MiniMax 同步 TTS 合成音频（快，几秒）
 * 2. DashScope Paraformer 语音识别获取逐句时间戳（快，几秒）
 * 3. 返回 audioPath + subtitles
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanForTTS } from '@/lib/deep-reader';
import { getSession, updateSession } from '@/lib/session-store';

const MINIMAX_API_BASE = 'https://api.minimaxi.com';
const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';

function getMinimaxKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置');
  return apiKey;
}

function getDashscopeKey(): string {
  // 复用 OPENAI_API_KEY（DashScope 兼容）
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 未配置');
  return apiKey;
}

// ==================== TTS 合成 ====================

async function synthesizeAudio(
  text: string,
  options: { voiceId: string; model: string; speed: number; apiKey: string }
): Promise<Buffer> {
  const MAX_CHARS = 4500;
  const segments: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + MAX_CHARS, text.length);
    if (end < text.length) {
      const lastBreak = Math.max(
        text.lastIndexOf('。', end),
        text.lastIndexOf('！', end),
        text.lastIndexOf('？', end),
      );
      if (lastBreak > pos + MAX_CHARS * 0.5) end = lastBreak + 1;
    }
    segments.push(text.slice(pos, end));
    pos = end;
  }

  const buffers: Buffer[] = [];
  for (let i = 0; i < segments.length; i++) {
    const response = await fetch(`${MINIMAX_API_BASE}/v1/t2a_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        text: segments[i],
        stream: false,
        language_boost: 'auto',
        voice_setting: {
          voice_id: options.voiceId,
          speed: options.speed,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        output_format: 'hex',
      }),
    });

    if (!response.ok) {
      throw new Error(`MiniMax API 错误 (${response.status})`);
    }

    const result = await response.json();
    if (result.base_resp?.status_code !== 0) {
      throw new Error(result.base_resp?.status_msg || 'MiniMax 未知错误');
    }

    const audioHex = result.data?.audio;
    if (!audioHex) throw new Error('MiniMax 未返回音频数据');

    buffers.push(Buffer.from(audioHex, 'hex'));

    if (i < segments.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  return Buffer.concat(buffers);
}

// ==================== ASR 语音识别（DashScope Paraformer） ====================

interface Subtitle {
  text: string;
  start: number;
  end: number;
}

async function transcribeAudio(audioFilePath: string, audioUrl?: string): Promise<Subtitle[]> {
  const apiKey = getDashscopeKey();

  try {
    let fileUrl: string;
    
    // 优先使用 HTTP URL（无大小限制），否则用 Base64（有 10MB 限制）
    if (audioUrl) {
      fileUrl = audioUrl;
      console.log(`[ASR] 使用 HTTP URL: ${audioUrl}`);
    } else {
      // 回退到 Base64（本地开发时）
      const audioBuffer = fs.readFileSync(audioFilePath);
      
      // Base64 编码后约增大 33%，DashScope 限制 10MB
      const MAX_FILE_SIZE = 7 * 1024 * 1024; // 7MB 安全阈值
      if (audioBuffer.length > MAX_FILE_SIZE) {
        console.log(`[ASR] 文件过大 (${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB > 7MB)，无公网 URL，跳过 ASR`);
        return [];
      }
      
      const base64Audio = audioBuffer.toString('base64');
      fileUrl = `data:audio/mp3;base64,${base64Audio}`;
      console.log(`[ASR] 使用 Base64 (${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    // 调用 Paraformer 识别（必须异步模式）
    const response = await fetch(`${DASHSCOPE_API_BASE}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: {
          file_urls: [fileUrl],
        },
        parameters: {
          language_hints: ['zh'],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ASR] 提交失败:', response.status, errText);
      return [];
    }

    const submitResult = await response.json();
    console.log('[ASR] 提交结果:', JSON.stringify(submitResult, null, 2));

    // 可能是异步的，需要轮询
    const taskId = submitResult.output?.task_id;
    if (!taskId) {
      // 同步返回了结果
      return parseTranscriptionResult(submitResult);
    }

    // Step 3: 轮询等待结果
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const queryRes = await fetch(
        `${DASHSCOPE_API_BASE}/tasks/${taskId}`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }
      );

      if (!queryRes.ok) continue;

      const queryResult = await queryRes.json();
      const status = queryResult.output?.task_status;
      console.log(`[ASR] 轮询 #${i + 1}: ${status}`);

      if (status === 'SUCCEEDED') {
        // 从 transcription_url 下载完整结果
        const results = queryResult.output?.results as Record<string, unknown>[] | undefined;
        if (results?.[0]) {
          const transcriptionUrl = results[0].transcription_url as string | undefined;
          if (transcriptionUrl) {
            console.log('[ASR] 下载字幕数据...');
            const trRes = await fetch(transcriptionUrl);
            if (trRes.ok) {
              const trData = await trRes.json();
              return parseParaformerResult(trData);
            }
          }
        }
        return parseTranscriptionResult(queryResult);
      }

      if (status === 'FAILED') {
        console.error('[ASR] 识别失败:', queryResult.output?.message);
        return [];
      }
    }

    console.error('[ASR] 识别超时');
    return [];
  } catch (err) {
    console.error('[ASR] 错误:', err);
    return [];
  }
}

/** 解析 Paraformer transcription_url 下载的结果 */
function parseParaformerResult(data: Record<string, unknown>): Subtitle[] {
  const subtitles: Subtitle[] = [];
  try {
    const transcripts = data.transcripts as Record<string, unknown>[] | undefined;
    if (!transcripts) return [];

    for (const transcript of transcripts) {
      const sentences = transcript.sentences as {
        text: string;
        begin_time: number;
        end_time: number;
      }[] | undefined;

      if (sentences) {
        for (const s of sentences) {
          subtitles.push({
            text: s.text || '',
            start: (s.begin_time || 0) / 1000, // ms -> s
            end: (s.end_time || 0) / 1000,
          });
        }
      }
    }

    console.log(`[ASR] 解析到 ${subtitles.length} 条逐句字幕`);
  } catch (err) {
    console.error('[ASR] 解析 Paraformer 结果失败:', err);
  }
  return subtitles;
}

function parseTranscriptionResult(result: Record<string, unknown>): Subtitle[] {
  const subtitles: Subtitle[] = [];

  try {
    const output = result.output as Record<string, unknown> | undefined;
    if (!output) return [];

    // 尝试从 results 中提取
    const results = output.results as Record<string, unknown>[] | undefined;
    if (results && results.length > 0) {
      for (const r of results) {
        const transcription = r.transcription as Record<string, unknown> | undefined;
        if (!transcription) continue;

        // Paraformer 返回的 sentences
        const sentences = (transcription.sentences || transcription.paragraphs) as
          { text: string; begin_time?: number; end_time?: number; start?: number; end?: number }[] | undefined;

        if (sentences) {
          for (const s of sentences) {
            subtitles.push({
              text: s.text || '',
              start: ((s.begin_time || s.start || 0) as number) / 1000, // ms -> s
              end: ((s.end_time || s.end || 0) as number) / 1000,
            });
          }
        }
      }
    }

    // 尝试从 transcription_url 下载完整结果
    if (subtitles.length === 0 && results) {
      for (const r of results) {
        const url = r.transcription_url as string | undefined;
        if (url) {
          console.log('[ASR] 需要下载完整结果:', url);
          // 这里可以异步下载，暂时跳过
        }
      }
    }

    console.log(`[ASR] 解析到 ${subtitles.length} 条字幕`);
  } catch (err) {
    console.error('[ASR] 解析结果失败:', err);
  }

  return subtitles;
}

// ==================== API 路由 ====================

export async function POST(request: NextRequest) {
  try {
    const { text, title, speed = 1.1, sessionId, episodeKey } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: '缺少文本内容' }, { status: 400 });
    }

    const minimaxKey = getMinimaxKey();

    // 清洗文本
    const cleaned = cleanForTTS(text);
    console.log(`[TTS Episode] "${title || '未命名'}" ${cleaned.length} 字`);

    // 1. 合成音频（同步，快速）
    const audioBuffer = await synthesizeAudio(cleaned, {
      voiceId: 'audiobook_male_1',
      model: 'speech-2.8-hd',
      speed,
      apiKey: minimaxKey,
    });

    // 保存文件
    const outputDir = path.join(process.cwd(), 'out', 'audio');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeName = (title || '未命名').replace(/[^\w\u4e00-\u9fff]/g, '_').slice(0, 30);
    const timestamp = Date.now();
    const fileName = `${safeName}_${timestamp}.mp3`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, audioBuffer);
    const audioPath = `out/audio/${fileName}`;
    console.log(`[TTS Episode] 音频完成: ${audioPath} (${audioBuffer.length} bytes)`);

    // 2. ASR 识别获取字幕时间戳
    let subtitles: Subtitle[] = [];
    try {
      // 构建公网可访问的 URL（用于 DashScope 下载音频）
      // 优先使用环境变量中的 PUBLIC_URL，否则使用请求的 host
      const host = request.headers.get('host') || 'localhost:3000';
      const protocol = host.includes('localhost') ? 'http' : 'http'; // 服务器也是 http
      const publicBaseUrl = process.env.PUBLIC_URL || `${protocol}://${host}`;
      const audioPublicUrl = `${publicBaseUrl}/api/read/output?path=${encodeURIComponent(audioPath)}&raw=1`;
      
      subtitles = await transcribeAudio(filePath, audioPublicUrl);
      console.log(`[TTS Episode] 字幕: ${subtitles.length} 条`);
    } catch (err) {
      console.error('[TTS Episode] ASR 失败，跳过字幕:', err);
    }

    // 3. 保存到 session
    if (sessionId && episodeKey) {
      const session = getSession(sessionId);
      if (session) {
        if (!session.ttsResults) session.ttsResults = {};
        session.ttsResults[episodeKey] = JSON.stringify({ audioPath, subtitles });
        updateSession(session);
      }
    }

    return NextResponse.json({
      success: true,
      audioPath,
      subtitles,
      audioSize: audioBuffer.length,
      charCount: cleaned.length,
    });
  } catch (error) {
    console.error('[TTS Episode] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '合成失败' },
      { status: 500 }
    );
  }
}

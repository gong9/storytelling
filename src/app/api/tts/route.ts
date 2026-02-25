/**
 * 评书 TTS 语音生成接口
 * 
 * POST /api/v1/storytelling/tts
 * 
 * 读取 DeepReader 生成的评书文本，按回目拆分，逐回调用 MiniMax speech-2.8-hd 生成语音。
 * 使用 SSE 流式返回进度和每回的音频文件路径。
 * 
 * Body (JSON):
 *   - filePath: string  — TTS 清洗版文件路径（如 out/deep/xxx_tts.txt）
 *                         或原始 md 文件路径（会自动清洗）
 *   - voiceId?: string  — 音色 ID（默认使用复刻音色或 male-qn-qingse）
 *   - model?: string    — 模型（默认 speech-2.8-hd）
 *   - speed?: number    — 语速（默认 1）
 */

import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanForTTS } from '@/lib/deep-reader';

const MINIMAX_API_BASE = 'https://api.minimaxi.com';

// ==================== 辅助函数 ====================

function getApiKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置');
  return apiKey;
}

function getActiveVoiceId(): string {
  return 'audiobook_male_1';
}

/**
 * 将评书文本按回目拆分
 * 匹配模式："第X回" 或 "第X回："
 */
function splitByEpisodes(text: string): { title: string; content: string }[] {
  // 匹配回目标题行
  const episodePattern = /^(第[一二三四五六七八九十百千\d]+回[：:\s].*?)$/gm;
  const matches = [...text.matchAll(episodePattern)];

  if (matches.length === 0) {
    // 没有回目标记，按 5000 字拆分
    const chunks: { title: string; content: string }[] = [];
    const chunkSize = 5000;
    for (let i = 0; i < text.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, text.length);
      // 在句号处断开
      let actualEnd = end;
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('。', end);
        if (lastPeriod > i + chunkSize * 0.6) {
          actualEnd = lastPeriod + 1;
        }
      }
      chunks.push({
        title: `第${chunks.length + 1}段`,
        content: text.slice(i, actualEnd).trim(),
      });
      if (actualEnd !== end) i = actualEnd - chunkSize; // 调整偏移
    }
    return chunks;
  }

  // 按回目拆分
  const episodes: { title: string; content: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const startPos = matches[i].index!;
    const endPos = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const content = text.slice(startPos, endPos).trim();
    if (content.length > 50) { // 过滤太短的
      episodes.push({ title, content });
    }
  }

  return episodes;
}

/**
 * 调用 MiniMax 同步 TTS 合成单段音频
 */
async function synthesizeAudio(
  text: string,
  options: { voiceId: string; model: string; speed: number; apiKey: string }
): Promise<{ audioBuffer: Buffer; audioLength?: number; usageCharacters?: number }> {
  const response = await fetch(`${MINIMAX_API_BASE}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      text,
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
    const errorText = await response.text();
    throw new Error(`MiniMax API 错误 (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  if (result.base_resp?.status_code !== 0) {
    throw new Error(result.base_resp?.status_msg || 'MiniMax 返回未知错误');
  }

  const audioHex = result.data?.audio;
  if (!audioHex) {
    throw new Error('MiniMax 未返回音频数据');
  }

  return {
    audioBuffer: Buffer.from(audioHex, 'hex'),
    audioLength: result.extra_info?.audio_length,
    usageCharacters: result.extra_info?.usage_characters,
  };
}

/**
 * 如果文本超过同步 API 限制（10000字符 ≈ 5000汉字），拆成多段合成后拼接
 */
async function synthesizeLongText(
  text: string,
  options: { voiceId: string; model: string; speed: number; apiKey: string },
  onProgress?: (msg: string) => void
): Promise<Buffer> {
  const MAX_CHARS = 4500; // 留点余量（MiniMax 1汉字=2字符，4500汉字=9000字符 < 10000）
  
  if (text.length <= MAX_CHARS) {
    const result = await synthesizeAudio(text, options);
    return result.audioBuffer;
  }

  // 拆分长文本
  const segments: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + MAX_CHARS, text.length);
    if (end < text.length) {
      // 在句号处断开
      const lastBreak = Math.max(
        text.lastIndexOf('。', end),
        text.lastIndexOf('！', end),
        text.lastIndexOf('？', end),
      );
      if (lastBreak > pos + MAX_CHARS * 0.5) {
        end = lastBreak + 1;
      }
    }
    segments.push(text.slice(pos, end));
    pos = end;
  }

  onProgress?.(`文本过长(${text.length}字)，拆为 ${segments.length} 段合成`);

  const buffers: Buffer[] = [];
  for (let i = 0; i < segments.length; i++) {
    onProgress?.(`合成分段 ${i + 1}/${segments.length} (${segments[i].length}字)`);
    // 限速重试：最多重试 3 次，每次等待递增
    let retries = 0;
    while (retries < 3) {
      try {
        const result = await synthesizeAudio(segments[i], options);
        buffers.push(result.audioBuffer);
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('rate') && retries < 2) {
          retries++;
          const waitSec = retries * 15;
          onProgress?.(`限速，等待 ${waitSec} 秒后重试 (${retries}/3)`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
        } else {
          throw err;
        }
      }
    }
    // 分段间延迟，避免限速
    if (i < segments.length - 1) {
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  return Buffer.concat(buffers);
}

// ==================== API 路由 ====================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      filePath,
      voiceId,
      model = 'speech-2.8-hd',
      speed = 1.1,
    } = body;

    if (!filePath) {
      return new Response(JSON.stringify({ error: '缺少 filePath 参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = getApiKey();
    const activeVoiceId = voiceId || getActiveVoiceId();

    // 读取文件
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      return new Response(JSON.stringify({ error: `文件不存在: ${filePath}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let text = fs.readFileSync(fullPath, 'utf-8');

    // 如果是 md 文件，自动清洗
    if (filePath.endsWith('.md')) {
      text = cleanForTTS(text);
    }

    // 按回目拆分
    const episodes = splitByEpisodes(text);

    // 准备输出目录
    const outputDir = path.join(process.cwd(), 'out', 'audio');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = path.basename(filePath, path.extname(filePath)).replace(/_tts$/, '');

    // SSE 流式返回
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        send({
          type: 'start',
          totalEpisodes: episodes.length,
          model,
          voiceId: activeVoiceId,
          episodes: episodes.map((ep, i) => ({
            index: i + 1,
            title: ep.title,
            charCount: ep.content.length,
          })),
        });

        let totalAudioLength = 0;
        const audioFiles: string[] = [];

        for (let i = 0; i < episodes.length; i++) {
          const ep = episodes[i];
          const audioFileName = `${baseName}_${timestamp}_ep${String(i + 1).padStart(2, '0')}.mp3`;
          const audioPath = path.join(outputDir, audioFileName);

          send({
            type: 'episode_start',
            episode: i + 1,
            total: episodes.length,
            title: ep.title,
            charCount: ep.content.length,
          });

          try {
            const audioBuffer = await synthesizeLongText(
              ep.content,
              { voiceId: activeVoiceId, model, speed, apiKey },
              (msg) => send({ type: 'progress', episode: i + 1, message: msg })
            );

            // 保存音频文件
            fs.writeFileSync(audioPath, audioBuffer);
            const audioLengthSec = audioBuffer.length / (128000 / 8); // 粗略估算
            totalAudioLength += audioLengthSec;

            audioFiles.push(`out/audio/${audioFileName}`);

            send({
              type: 'episode_done',
              episode: i + 1,
              total: episodes.length,
              title: ep.title,
              audioFile: `out/audio/${audioFileName}`,
              audioSize: audioBuffer.length,
              audioLengthEstimate: Math.round(audioLengthSec),
            });

            // 回目间延迟，避免限速（10秒）
            if (i < episodes.length - 1) {
              await new Promise(r => setTimeout(r, 10000));
            }
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            send({
              type: 'episode_error',
              episode: i + 1,
              title: ep.title,
              error: errMsg,
            });
            console.error(`[TTS] 第${i + 1}回生成失败:`, errMsg);
          }
        }

        send({
          type: 'complete',
          totalEpisodes: episodes.length,
          audioFiles,
          totalAudioLengthEstimate: Math.round(totalAudioLength),
          outputDir: 'out/audio/',
        });

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[TTS] 评书语音生成失败:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '语音生成失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET: 使用说明
export async function GET() {
  return new Response(JSON.stringify({
    usage: {
      endpoint: '/api/v1/storytelling/tts',
      method: 'POST',
      contentType: 'application/json',
      body: {
        filePath: '(必需) 评书文本文件路径，如 out/deep/xxx_tts.txt 或 xxx.md',
        voiceId: '(可选) MiniMax 音色 ID，默认使用复刻音色或 male-qn-qingse',
        model: '(可选) 模型，默认 speech-2.8-hd',
        speed: '(可选) 语速，默认 1',
      },
      response: 'SSE 流式返回，逐回生成进度和音频文件路径',
      output: '音频文件保存在 out/audio/ 目录，每回一个 mp3',
    },
    example: {
      curl: `curl -X POST -H "Content-Type: application/json" -d '{"filePath":"out/deep/大明王朝1566_tts_test.txt"}' http://localhost:3000/api/v1/storytelling/tts`,
    },
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 单回 TTS 合成 API
 *
 * POST /api/tts/episode
 * Body: { text: string, title?: string, speed?: number }
 *
 * 接收单回文本，清洗后合成音频，返回音频文件路径
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanForTTS } from '@/lib/deep-reader';

const MINIMAX_API_BASE = 'https://api.minimaxi.com';
const CLONED_VOICE_CONFIG_PATH = path.join(process.cwd(), 'cloned-voice-config.json');

function getApiKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置');
  return apiKey;
}

function getActiveVoiceId(): string {
  try {
    if (fs.existsSync(CLONED_VOICE_CONFIG_PATH)) {
      const content = fs.readFileSync(CLONED_VOICE_CONFIG_PATH, 'utf-8');
      const config = JSON.parse(content);
      if (config.voiceId) return config.voiceId;
    }
  } catch {}
  return 'male-qn-qingse';
}

async function synthesizeAudio(
  text: string,
  options: { voiceId: string; model: string; speed: number; apiKey: string }
): Promise<Buffer> {
  const MAX_CHARS = 4500;
  const segments: string[] = [];
  let pos = 0;

  // 拆分长文本
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

    // 分段间延迟
    if (i < segments.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  return Buffer.concat(buffers);
}

export async function POST(request: NextRequest) {
  try {
    const { text, title, speed = 1 } = await request.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ error: '缺少文本内容' }, { status: 400 });
    }

    const apiKey = getApiKey();
    const voiceId = getActiveVoiceId();

    // 清洗文本
    const cleaned = cleanForTTS(text);
    console.log(`[TTS Episode] "${title || '未命名'}" ${cleaned.length} 字`);

    // 合成
    const audioBuffer = await synthesizeAudio(cleaned, {
      voiceId,
      model: 'speech-2.8-hd',
      speed,
      apiKey,
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
    console.log(`[TTS Episode] 完成: ${audioPath} (${audioBuffer.length} bytes)`);

    return NextResponse.json({
      success: true,
      audioPath,
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

/**
 * 重新生成字幕 API
 * 
 * POST /api/tts/regenerate-subtitles
 * Body: { audioPath, sessionId?, episodeKey? }
 * 
 * 对已有的音频文件重新调用 ASR 生成字幕
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSession, updateSession } from '@/lib/session-store';

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';

function getDashscopeKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 未配置');
  return apiKey;
}

interface Subtitle {
  text: string;
  start: number;
  end: number;
}

async function transcribeAudio(audioFilePath: string, audioUrl?: string): Promise<Subtitle[]> {
  const apiKey = getDashscopeKey();

  try {
    let fileUrl: string;
    
    if (audioUrl) {
      fileUrl = audioUrl;
      console.log(`[ASR Regen] 使用 HTTP URL: ${audioUrl}`);
    } else {
      const audioBuffer = fs.readFileSync(audioFilePath);
      const MAX_FILE_SIZE = 7 * 1024 * 1024;
      if (audioBuffer.length > MAX_FILE_SIZE) {
        console.log(`[ASR Regen] 文件过大，无公网 URL，跳过`);
        return [];
      }
      const base64Audio = audioBuffer.toString('base64');
      fileUrl = `data:audio/mp3;base64,${base64Audio}`;
    }

    const response = await fetch(`${DASHSCOPE_API_BASE}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: { file_urls: [fileUrl] },
        parameters: { language_hints: ['zh'] },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ASR Regen] 提交失败:', response.status, errText);
      return [];
    }

    const submitResult = await response.json();
    const taskId = submitResult.output?.task_id;
    if (!taskId) return [];

    // 轮询等待结果
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const queryRes = await fetch(`${DASHSCOPE_API_BASE}/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!queryRes.ok) continue;

      const queryResult = await queryRes.json();
      const status = queryResult.output?.task_status;
      console.log(`[ASR Regen] 轮询 #${i + 1}: ${status}`);

      if (status === 'SUCCEEDED') {
        const results = queryResult.output?.results as Record<string, unknown>[] | undefined;
        if (results?.[0]) {
          const transcriptionUrl = results[0].transcription_url as string | undefined;
          if (transcriptionUrl) {
            const trRes = await fetch(transcriptionUrl);
            if (trRes.ok) {
              const trData = await trRes.json();
              return parseParaformerResult(trData);
            }
          }
        }
        return [];
      }

      if (status === 'FAILED') {
        console.error('[ASR Regen] 识别失败:', queryResult.output?.message);
        return [];
      }
    }

    return [];
  } catch (err) {
    console.error('[ASR Regen] 错误:', err);
    return [];
  }
}

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
            start: (s.begin_time || 0) / 1000,
            end: (s.end_time || 0) / 1000,
          });
        }
      }
    }
    console.log(`[ASR Regen] 解析到 ${subtitles.length} 条字幕`);
  } catch (err) {
    console.error('[ASR Regen] 解析失败:', err);
  }
  return subtitles;
}

export async function POST(request: NextRequest) {
  try {
    const { audioPath, sessionId, episodeKey } = await request.json();

    if (!audioPath) {
      return NextResponse.json({ error: '缺少 audioPath' }, { status: 400 });
    }

    // 检查文件是否存在
    const filePath = path.join(process.cwd(), audioPath);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: '音频文件不存在' }, { status: 404 });
    }

    console.log(`[ASR Regen] 开始重新生成字幕: ${audioPath}`);

    // 构建公网 URL
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'http';
    const publicBaseUrl = process.env.PUBLIC_URL || `${protocol}://${host}`;
    const audioPublicUrl = `${publicBaseUrl}/api/read/output?path=${encodeURIComponent(audioPath)}&raw=1`;

    // 调用 ASR
    const subtitles = await transcribeAudio(filePath, audioPublicUrl);
    console.log(`[ASR Regen] 字幕: ${subtitles.length} 条`);

    // 更新 session
    if (sessionId && episodeKey && subtitles.length > 0) {
      const session = getSession(sessionId);
      if (session) {
        if (!session.ttsResults) session.ttsResults = {};
        session.ttsResults[episodeKey] = JSON.stringify({ audioPath, subtitles });
        updateSession(session);
        console.log(`[ASR Regen] 已更新 session ${sessionId} 的 ${episodeKey}`);
      }
    }

    return NextResponse.json({
      success: true,
      subtitles,
      count: subtitles.length,
    });
  } catch (error) {
    console.error('[ASR Regen] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    );
  }
}

/**
 * 单回 TTS 合成 API（异步模式 + 字幕时间戳）
 *
 * POST /api/tts/episode
 * Body: { text, title?, speed?, sessionId?, episodeKey? }
 *
 * 使用 MiniMax t2a_async_v2 异步合成，返回 SSE 进度流
 * 最终返回音频路径 + 精确到句的字幕时间戳
 */

import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanForTTS } from '@/lib/deep-reader';
import { getSession, updateSession } from '@/lib/session-store';

const MINIMAX_API_BASE = 'https://api.minimaxi.com';

function getApiKey(): string {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY 未配置');
  return apiKey;
}

/** 提交异步合成任务 */
async function submitAsyncTask(
  text: string,
  options: { voiceId: string; model: string; speed: number; apiKey: string }
): Promise<string> {
  const response = await fetch(`${MINIMAX_API_BASE}/v1/t2a_async_v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      text,
      language_boost: 'auto',
      voice_setting: {
        voice_id: options.voiceId,
        speed: options.speed,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        audio_sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax 提交任务失败 (${response.status}): ${errText}`);
  }

  const result = await response.json();
  if (result.base_resp?.status_code !== 0) {
    throw new Error(result.base_resp?.status_msg || 'MiniMax 提交任务失败');
  }

  const taskId = result.task_id;
  if (!taskId) throw new Error('MiniMax 未返回 task_id');
  return taskId;
}

/** 查询任务状态 */
async function queryTask(taskId: string, apiKey: string): Promise<{
  status: string;
  fileId?: string;
  subtitleFileId?: string;
  extra?: Record<string, unknown>;
}> {
  const response = await fetch(
    `${MINIMAX_API_BASE}/v1/query/t2a_async_query_v2?task_id=${taskId}`,
    {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }
  );

  if (!response.ok) {
    throw new Error(`查询任务状态失败 (${response.status})`);
  }

  const result = await response.json();
  const status = result.status || 'unknown';

  return {
    status,
    fileId: result.file_id,
    subtitleFileId: result.subtitle_file_id,
    extra: result.extra_info,
  };
}

/** 通过 file_id 获取文件下载 URL */
async function getFileUrl(fileId: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `${MINIMAX_API_BASE}/v1/files/retrieve?file_id=${fileId}`,
    {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }
  );

  if (!response.ok) {
    throw new Error(`获取文件信息失败 (${response.status})`);
  }

  const result = await response.json();
  const url = result.file?.download_url;
  if (!url) throw new Error('未获取到下载地址');
  return url;
}

/** 下载文件到本地 */
async function downloadFile(url: string, savePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载文件失败 (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer);
}

/** 下载字幕文件并解析 */
async function downloadSubtitles(
  fileId: string,
  apiKey: string
): Promise<{ text: string; start: number; end: number }[]> {
  try {
    const url = await getFileUrl(fileId, apiKey);
    const response = await fetch(url);
    if (!response.ok) return [];

    const content = await response.text();

    // MiniMax 字幕可能是 JSON 或 SRT 格式，尝试解析
    try {
      const data = JSON.parse(content);
      // JSON 格式: [{ text, start_time, end_time }] 或类似
      if (Array.isArray(data)) {
        return data.map((item: Record<string, unknown>) => ({
          text: (item.text || item.content || '') as string,
          start: (item.start_time || item.start || 0) as number,
          end: (item.end_time || item.end || 0) as number,
        }));
      }
      if (data.subtitles && Array.isArray(data.subtitles)) {
        return data.subtitles.map((item: Record<string, unknown>) => ({
          text: (item.text || '') as string,
          start: (item.start_time || item.start || 0) as number,
          end: (item.end_time || item.end || 0) as number,
        }));
      }
    } catch {
      // 非 JSON，尝试 SRT 解析
    }

    // SRT 格式解析
    const srtPattern = /(\d+)\n(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\n([\s\S]*?)(?=\n\n|\n*$)/g;
    const subtitles: { text: string; start: number; end: number }[] = [];
    let match;
    while ((match = srtPattern.exec(content)) !== null) {
      subtitles.push({
        text: match[4].trim(),
        start: parseSrtTime(match[2]),
        end: parseSrtTime(match[3]),
      });
    }
    if (subtitles.length > 0) return subtitles;

    // 尝试 VTT 格式
    const vttPattern = /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\n([\s\S]*?)(?=\n\n|\n*$)/g;
    while ((match = vttPattern.exec(content)) !== null) {
      subtitles.push({
        text: match[3].trim(),
        start: parseSrtTime(match[1]),
        end: parseSrtTime(match[2]),
      });
    }

    // 保存原始字幕文件用于调试
    const debugPath = path.join(process.cwd(), 'out', 'audio', `subtitle_debug_${Date.now()}.txt`);
    fs.writeFileSync(debugPath, content, 'utf-8');
    console.log(`[TTS] 字幕原始文件已保存: ${debugPath}`);

    return subtitles;
  } catch (err) {
    console.error('[TTS] 字幕解析失败:', err);
    return [];
  }
}

function parseSrtTime(timeStr: string): number {
  const parts = timeStr.replace(',', '.').split(':');
  const h = parseFloat(parts[0]) * 3600;
  const m = parseFloat(parts[1]) * 60;
  const s = parseFloat(parts[2]);
  return h + m + s;
}

// ==================== SSE API ====================

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      try {
        const { text, title, speed = 1.3, sessionId, episodeKey } = await request.json();

        if (!text || !text.trim()) {
          send({ type: 'error', error: '缺少文本内容' });
          controller.close();
          return;
        }

        const apiKey = getApiKey();
        const voiceId = 'audiobook_male_1';

        // 清洗文本
        const cleaned = cleanForTTS(text);
        console.log(`[TTS Episode] "${title || '未命名'}" ${cleaned.length} 字`);

        // 1. 提交异步任务
        send({ type: 'progress', message: '正在提交合成任务...' });
        const taskId = await submitAsyncTask(cleaned, {
          voiceId,
          model: 'speech-2.8-hd',
          speed,
          apiKey,
        });
        send({ type: 'progress', message: '任务已提交，等待合成...' });

        // 2. 轮询等待完成
        let fileId: string | undefined;
        let subtitleFileId: string | undefined;
        const maxAttempts = 120; // 最多等 10 分钟（每 5 秒一次）
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(r => setTimeout(r, 5000));

          const result = await queryTask(taskId, apiKey);
          send({ type: 'progress', message: `合成中... (${i * 5}s)`, status: result.status });

          if (result.status === 'Success' || result.status === 'success') {
            fileId = result.fileId;
            subtitleFileId = result.subtitleFileId;
            break;
          }

          if (result.status === 'Failed' || result.status === 'failed') {
            throw new Error('MiniMax 合成任务失败');
          }
        }

        if (!fileId) {
          throw new Error('合成超时，请重试');
        }

        // 3. 下载音频
        send({ type: 'progress', message: '正在下载音频...' });
        const audioUrl = await getFileUrl(fileId, apiKey);

        const outputDir = path.join(process.cwd(), 'out', 'audio');
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const safeName = (title || '未命名').replace(/[^\w\u4e00-\u9fff]/g, '_').slice(0, 30);
        const timestamp = Date.now();
        const fileName = `${safeName}_${timestamp}.mp3`;
        const filePath = path.join(outputDir, fileName);

        await downloadFile(audioUrl, filePath);
        const audioPath = `out/audio/${fileName}`;

        // 4. 下载字幕
        let subtitles: { text: string; start: number; end: number }[] = [];
        if (subtitleFileId) {
          send({ type: 'progress', message: '正在获取字幕...' });
          subtitles = await downloadSubtitles(subtitleFileId, apiKey);
          console.log(`[TTS Episode] 获取到 ${subtitles.length} 条字幕`);
        }

        // 5. 保存到 session
        if (sessionId && episodeKey) {
          const session = getSession(sessionId);
          if (session) {
            if (!session.ttsResults) session.ttsResults = {};
            session.ttsResults[episodeKey] = JSON.stringify({ audioPath, subtitles });
            updateSession(session);
          }
        }

        console.log(`[TTS Episode] 完成: ${audioPath}, 字幕 ${subtitles.length} 条`);

        send({
          type: 'done',
          audioPath,
          subtitles,
          charCount: cleaned.length,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '合成失败';
        console.error('[TTS Episode] Error:', errMsg);
        send({ type: 'error', error: errMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * 单章处理 API
 *
 * POST /api/read/chapter
 * Content-Type: application/json
 * Body: { sessionId: string, chapterIndex: number }
 *
 * SSE 流式返回章节处理进度
 */

import { NextRequest } from 'next/server';
import { DeepReader, DEEP_TASK_PINGSHU } from '@/lib/deep-reader';
import { getSession, updateSession } from '@/lib/session-store';

export async function POST(request: NextRequest) {
  try {
    const { sessionId, chapterIndex } = await request.json();

    if (!sessionId || chapterIndex === undefined) {
      return new Response(
        JSON.stringify({ error: '缺少 sessionId 或 chapterIndex' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: '会话不存在或已过期' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (chapterIndex < 0 || chapterIndex >= session.chapters.length) {
      return new Response(
        JSON.stringify({ error: `章节索引越界: ${chapterIndex}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        const chapter = session.chapters[chapterIndex];
        send({
          type: 'chapter_start',
          chapterIndex,
          title: chapter.title,
          charCount: chapter.content.length,
        });

        try {
          const reader = new DeepReader({ task: DEEP_TASK_PINGSHU, model: 'qwen-plus' });
          const result = await reader.processOneChapter(session, chapterIndex, (event) => {
            send({ ...event });
          });

          // 持久化更新后的 session
          updateSession(session);

          send({
            type: 'chapter_done',
            chapterIndex,
            title: chapter.title,
            charCount: result.charCount,
            completedCount: session.completedChapters.length,
            totalChapters: session.chapters.length,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          send({
            type: 'chapter_error',
            chapterIndex,
            title: chapter.title,
            error: errMsg,
          });
          console.error(`[Chapter] 章节 ${chapterIndex} 处理失败:`, errMsg);
        }

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
    console.error('[Chapter] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * 评书改编初始化 API（SSE 流式返回进度）
 *
 * POST /api/read/init
 * Content-Type: multipart/form-data
 *
 * 上传文件 → 解析 → 切分章节 → 生成全局上下文 → 返回 sessionId + 章节列表
 * 全程 SSE 推送进度事件
 */

import { NextRequest } from 'next/server';
import pdfParse from 'pdf-parse';
import { DeepReader, DEEP_TASK_PINGSHU } from '@/lib/deep-reader';
import { setSession } from '@/lib/session-store';

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream may be closed
        }
      };

      // 拦截 console.log，捕获 RLM 进度日志推给前端
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        originalLog.apply(console, args);
        const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

        // 匹配 [工具 #N] xxx 格式
        const toolMatch = msg.match(/\[工具 #(\d+)\]\s*(.+)/);
        if (toolMatch) {
          send({ type: 'log', tool: parseInt(toolMatch[1]), action: toolMatch[2].trim() });
          return;
        }

        // 匹配说明行
        if (msg.includes('说明:')) {
          const desc = msg.replace(/^\s*说明:\s*/, '').trim();
          send({ type: 'log_detail', message: desc });
          return;
        }

        // 匹配 -> 结果行
        if (msg.trim().startsWith('->')) {
          const result = msg.replace(/^\s*->\s*/, '').trim();
          send({ type: 'log_result', message: result });
          return;
        }

        // 匹配关键阶段
        if (msg.includes('RLM 文档阅读开始')) {
          send({ type: 'stage', stage: 'context', message: '正在生成全局上下文...' });
        } else if (msg.includes('分块:')) {
          const chunkMatch = msg.match(/分块:\s*(\d+)/);
          if (chunkMatch) {
            send({ type: 'stage', stage: 'context_chunks', totalChunks: parseInt(chunkMatch[1]) });
          }
        } else if (msg.includes('RLM 阅读完成') || msg.includes('RLM 达到递归限制')) {
          send({ type: 'stage', stage: 'context_done', message: '全局上下文生成完成' });
        }
      };

      try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
          send({ type: 'error', error: '请上传文件' });
          controller.close();
          console.log = originalLog;
          return;
        }

        send({ type: 'stage', stage: 'parsing', message: '正在解析文件...' });

        // 解析文件内容
        let content = '';
        const fileName = file.name;
        const ext = fileName.split('.').pop()?.toLowerCase();

        if (ext === 'pdf') {
          const buffer = Buffer.from(await file.arrayBuffer());
          const pdfData = await pdfParse(buffer);
          content = pdfData.text || '';
        } else if (ext === 'txt' || ext === 'md') {
          content = await file.text();
        } else {
          send({ type: 'error', error: '不支持的文件格式，请上传 PDF、TXT 或 MD 文件' });
          controller.close();
          console.log = originalLog;
          return;
        }

        if (!content.trim()) {
          send({ type: 'error', error: '文件内容为空' });
          controller.close();
          console.log = originalLog;
          return;
        }

        send({
          type: 'stage',
          stage: 'parsed',
          message: `文件解析完成：${(content.length / 10000).toFixed(1)} 万字`,
          title: fileName,
          totalChars: content.length,
        });

        // 初始化 DeepReader 会话（包含章节切分 + 全局上下文生成）
        const reader = new DeepReader({ 
          task: DEEP_TASK_PINGSHU, 
          model: 'qwen-plus',
        });
        const session = await reader.initSession({ content, title: fileName });

        // 存储会话
        setSession(session);

        // 最终结果
        send({
          type: 'done',
          sessionId: session.id,
          title: session.title,
          totalChars: content.length,
          chapters: session.chapters.map((ch, i) => ({
            index: i,
            title: ch.title,
            charCount: ch.content.length,
          })),
          outputPath: session.outputPath,
        });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        // 恢复 console.log
        console.log = originalLog;
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

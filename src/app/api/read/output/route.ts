/**
 * 读取输出文件 API
 *
 * GET /api/read/output?path=out/deep/xxx.md        — 返回 JSON { content }
 * GET /api/read/output?path=out/audio/xxx.mp3&raw=1 — 返回原始文件（音频等）
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  const raw = request.nextUrl.searchParams.get('raw');

  if (!filePath) {
    return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 });
  }

  // 安全检查：只允许读 out/ 目录
  if (!filePath.startsWith('out/')) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  // raw 模式：直接返回文件内容（用于音频播放等）
  if (raw) {
    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length.toString(),
      },
    });
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  return NextResponse.json({ content });
}

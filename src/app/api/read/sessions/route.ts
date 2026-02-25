/**
 * 历史会话列表 API
 *
 * GET /api/read/sessions — 列出所有历史会话
 * DELETE /api/read/sessions?id=xxx — 删除指定会话
 */

import { NextRequest, NextResponse } from 'next/server';
import { listSessions, deleteSession, getSession } from '@/lib/session-store';

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');

  if (id) {
    // 返回单个完整会话
    const session = getSession(id);
    if (!session) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    return NextResponse.json({ session });
  }

  // 返回所有会话摘要
  const sessions = listSessions();
  return NextResponse.json({ sessions });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: '缺少 id 参数' }, { status: 400 });
  }

  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: '会话不存在' }, { status: 404 });
  }

  deleteSession(id);
  return NextResponse.json({ success: true });
}

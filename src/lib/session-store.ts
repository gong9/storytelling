/**
 * 文件系统会话存储
 * 使用 JSON 文件持久化，解决 Next.js dev mode 模块隔离问题
 */

import fs from 'fs';
import path from 'path';
import type { DeepReaderSession } from './deep-reader';

const SESSION_DIR = path.join(process.cwd(), '.sessions');

// 会话过期时间：7 天
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  return path.join(SESSION_DIR, `${id}.json`);
}

export function setSession(session: DeepReaderSession): void {
  ensureDir();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session), 'utf-8');

  // 清理过期会话
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(SESSION_DIR)) {
      const filePath = path.join(SESSION_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > SESSION_TTL) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

export function getSession(id: string): DeepReaderSession | undefined {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return undefined;
  try {
    const data = fs.readFileSync(p, 'utf-8');
    return JSON.parse(data) as DeepReaderSession;
  } catch {
    return undefined;
  }
}

/** 会话摘要（列表展示用，不含完整 content） */
export interface SessionSummary {
  id: string;
  title: string;
  totalChars: number;
  chapterCount: number;
  completedCount: number;
  outputPath: string;
  createdAt: number;
}

/** 列出所有未过期的会话摘要 */
export function listSessions(): SessionSummary[] {
  ensureDir();
  const results: SessionSummary[] = [];
  const now = Date.now();

  try {
    for (const file of fs.readdirSync(SESSION_DIR)) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(SESSION_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > SESSION_TTL) continue;

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeepReaderSession;
        results.push({
          id: data.id,
          title: data.title,
          totalChars: data.content?.length || 0,
          chapterCount: data.chapters?.length || 0,
          completedCount: data.completedChapters?.length || 0,
          outputPath: data.outputPath,
          createdAt: data.createdAt,
        });
      } catch {
        // skip corrupted files
      }
    }
  } catch {
    // ignore
  }

  // 按创建时间倒序
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateSession(session: DeepReaderSession): void {
  setSession(session);
}

export function deleteSession(id: string): void {
  const p = sessionPath(id);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

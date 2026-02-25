/**
 * 评书改编 API
 * 
 * POST /api/read
 * Content-Type: multipart/form-data
 * 
 * Body:
 *   - file: PDF/TXT/MD 文件
 *   - task: 'pingshu'（默认）| 'summary' | 'study-notes'
 *   - mode: 'deep'（默认，精读改编）| 'skim'（速读摘要）
 */

import { NextRequest, NextResponse } from 'next/server';
import pdfParse from 'pdf-parse';
import { RLMReader } from '@/lib/rlm-reader';
import { DeepReader, DEEP_TASK_PINGSHU } from '@/lib/deep-reader';
import {
  TASK_STUDY_NOTES,
  TASK_SUMMARY,
  TASK_PINGSHU,
} from '@/lib/prompts/rlm';

const SKIM_TASK_MAP: Record<string, any> = {
  'study-notes': TASK_STUDY_NOTES,
  'summary': TASK_SUMMARY,
  'pingshu': TASK_PINGSHU,
};

const DEEP_TASK_MAP: Record<string, any> = {
  'pingshu': DEEP_TASK_PINGSHU,
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const taskType = (formData.get('task') as string) || 'pingshu';
    const mode = (formData.get('mode') as string) || 'deep';

    if (!file) {
      return NextResponse.json({ error: '请上传文件' }, { status: 400 });
    }

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
      return NextResponse.json(
        { error: '不支持的文件格式，请上传 PDF、TXT 或 MD 文件' },
        { status: 400 }
      );
    }

    if (!content.trim()) {
      return NextResponse.json({ error: '文件内容为空' }, { status: 400 });
    }

    console.log(`[Read] 文件: ${fileName}, 字数: ${content.length}, 任务: ${taskType}, 模式: ${mode}`);

    if (mode === 'deep') {
      const deepTask = DEEP_TASK_MAP[taskType];
      if (!deepTask) {
        return NextResponse.json(
          { error: `精读模式暂不支持: ${taskType}，目前仅支持: pingshu` },
          { status: 400 }
        );
      }

      const reader = new DeepReader({ task: deepTask, model: 'qwen-plus' });
      const result = await reader.read({ content, title: fileName });

      return NextResponse.json({
        success: true,
        fileName,
        contentLength: content.length,
        task: taskType,
        mode: 'deep',
        result: {
          outputPath: result.outputPath,
          ttsOutputPath: result.ttsOutputPath,
          chapterCount: result.chapterCount,
          totalWords: result.totalWords,
          duration: result.duration,
        },
      });
    } else {
      const skimTask = SKIM_TASK_MAP[taskType] || TASK_SUMMARY;
      const reader = new RLMReader({ task: skimTask, model: 'qwen-plus' });
      const result = await reader.read({ content, title: fileName });

      return NextResponse.json({
        success: true,
        fileName,
        contentLength: content.length,
        task: taskType,
        mode: 'skim',
        result,
      });
    }
  } catch (error) {
    console.error('[Read] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    usage: {
      endpoint: '/api/read',
      method: 'POST',
      contentType: 'multipart/form-data',
      params: {
        file: '(必需) PDF、TXT 或 MD 文件',
        task: '(可选) pingshu(默认) | summary | study-notes',
        mode: '(可选) deep(默认，精读改编) | skim(速读摘要)',
      },
    },
    examples: {
      deep: 'curl -X POST -F "file=@book.pdf" http://localhost:3100/api/read',
      skim: 'curl -X POST -F "file=@book.pdf" -F "mode=skim" -F "task=summary" http://localhost:3100/api/read',
    },
  });
}

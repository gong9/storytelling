/**
 * DeepReader 工具：获取章节信息
 */

import { tool } from 'langchain';
import { z } from 'zod';

export interface ChapterInfo {
  totalChars: number;
  segmentCount: number;
  segments: Array<{
    id: number;
    charStart: number;
    charEnd: number;
    charCount: number;
    preview: string;
  }>;
}

/**
 * 创建获取章节信息工具
 * @param handler 处理函数，返回章节统计信息
 */
export function createGetChapterInfoTool(handler: () => ChapterInfo) {
  return tool(
    async () => {
      const info = handler();
      return JSON.stringify(info, null, 2);
    },
    {
      name: 'get_chapter_info',
      description: '获取当前章节的统计信息，包括总字数、片段数量、每个片段的预览',
      schema: z.object({}),
    }
  );
}

/**
 * DeepReader 工具：完成标记
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export interface DoneCheckResult {
  canFinish: boolean;
  message: string;
  processedSegments: number;
  totalSegments: number;
  outputChars: number;
}

/**
 * 创建完成标记工具
 * @param handler 检查函数，验证是否可以完成
 */
export function createDeepReaderDoneTool(
  handler: () => DoneCheckResult
) {
  return tool(
    async () => {
      const result = handler();
      if (result.canFinish) {
        return `✓ 章节处理完成。已处理 ${result.processedSegments}/${result.totalSegments} 个片段，输出 ${result.outputChars} 字。`;
      } else {
        return `✗ 不能完成：${result.message}。已处理 ${result.processedSegments}/${result.totalSegments} 个片段。请继续使用 spawn_writer 处理剩余片段。`;
      }
    },
    {
      name: 'done',
      description: '标记当前章节处理完成。只有处理完所有片段后才能调用。',
      schema: z.object({}),
    }
  );
}

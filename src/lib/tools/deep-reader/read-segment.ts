/**
 * DeepReader 工具：读取原文片段
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建读取片段工具
 * @param handler 处理函数，接收片段 ID，返回原文内容
 */
export function createReadSegmentTool(
  handler: (segmentId: number) => string
) {
  return tool(
    async (input) => handler(input.segmentId),
    {
      name: 'read_segment',
      description: '读取指定片段的原文内容',
      schema: z.object({
        segmentId: z.number().describe('片段编号（从 1 开始）'),
      }),
    }
  );
}

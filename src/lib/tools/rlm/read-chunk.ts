/**
 * RLM 工具：读取块内容
 */

import { tool } from 'langchain';
import { z } from 'zod';

/**
 * 创建读取块内容工具
 * @param handler 处理函数，接收块编号返回内容
 */
export function createReadChunkTool(
  handler: (index: number) => string
) {
  return tool(
    (input) => handler(input.index),
    {
      name: 'read_chunk',
      description: '读取指定块的完整内容',
      schema: z.object({
        index: z.number().describe('块编号，从 1 开始'),
      }),
    }
  );
}

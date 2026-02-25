/**
 * RLM 工具：输出管理
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建更新输出工具
 * @param handler 处理函数，接收输出内容
 */
export function createUpdateOutputTool(
  handler: (content: string) => string
) {
  return tool(
    (input) => handler(input.content),
    {
      name: 'update_output',
      description: '更新输出内容（笔记/摘要/分析等）',
      schema: z.object({
        content: z.string().describe('输出内容'),
      }),
    }
  );
}

/**
 * 创建获取输出工具
 * @param handler 处理函数，返回当前输出
 */
export function createGetOutputTool(
  handler: () => string
) {
  return tool(handler, {
    name: 'get_output',
    description: '获取当前输出内容',
    schema: z.object({}),
  });
}

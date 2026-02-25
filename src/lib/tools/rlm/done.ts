/**
 * RLM 工具：标记任务完成
 */

import { tool } from 'langchain';
import { z } from 'zod';

/**
 * 创建完成任务工具
 * @param handler 处理函数（可以抛出错误来强制停止）
 */
export function createDoneTool(
  handler: () => string | never
) {
  return tool(handler, {
    name: 'done',
    description: '任务完成时调用此工具。调用后将结束阅读流程。',
    schema: z.object({}),
  });
}

/**
 * RLM 工具：获取块列表
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建获取块列表工具
 * @param handler 处理函数，返回块预览摘要（字符串格式）
 */
export function createGetChunkListTool(
  handler: () => string
) {
  return tool(handler, {
    name: 'get_chunk_list',
    description: '获取文档块的概览，显示前20块的预览和总块数。用于了解文档结构。',
    schema: z.object({}),
  });
}

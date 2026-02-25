/**
 * RLM 工具：获取文档统计
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建获取文档统计工具
 * @param handler 处理函数，返回文档统计信息
 */
export function createGetDocumentStatsTool(
  handler: () => { totalChars: number; totalChunks: number; avgChunkSize: number }
) {
  return tool(handler, {
    name: 'get_document_stats',
    description: '获取文档统计信息：总字数、总块数、平均块大小',
    schema: z.object({}),
  });
}

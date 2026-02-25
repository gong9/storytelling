/**
 * RLM 工具：搜索文档
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建搜索文档工具
 * @param handler 处理函数，接收关键词返回匹配的块编号
 */
export function createSearchDocumentTool(
  handler: (keyword: string) => number[]
) {
  return tool(
    (input) => handler(input.keyword),
    {
      name: 'search_document',
      description: '搜索包含指定关键词的块',
      schema: z.object({
        keyword: z.string().describe('要搜索的关键词'),
      }),
    }
  );
}

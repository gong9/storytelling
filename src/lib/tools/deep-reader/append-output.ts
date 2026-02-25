/**
 * DeepReader 工具：追加输出
 */

import { tool } from 'langchain';
import { z } from 'zod';

/**
 * 创建追加输出工具
 * @param handler 处理函数，追加内容到输出
 */
export function createAppendOutputTool(
  handler: (content: string) => number
) {
  return tool(
    async (input) => {
      const totalChars = handler(input.content);
      return `已追加 ${input.content.length} 字，当前总输出 ${totalChars} 字`;
    },
    {
      name: 'append_output',
      description: '将生成的评书内容追加到输出文件',
      schema: z.object({
        content: z.string().describe('要追加的评书内容'),
      }),
    }
  );
}

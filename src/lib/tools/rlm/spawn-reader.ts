/**
 * RLM 工具：派出阅读助手
 */

import { tool } from 'langchain';
import { z } from 'zod';

/**
 * 创建派出阅读助手工具
 * @param handler 处理函数，接收块编号列表和问题，返回回答
 */
export function createSpawnReaderTool(
  handler: (chunkIndexes: number[], question: string) => Promise<string>
) {
  return tool(
    async (input) => handler(input.chunkIndexes, input.question),
    {
      name: 'spawn_reader',
      description: '派一个助手阅读指定块并回答问题',
      schema: z.object({
        chunkIndexes: z.array(z.number()).describe('要读的块编号列表'),
        question: z.string().describe('让助手回答的问题'),
      }),
    }
  );
}

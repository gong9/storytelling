/**
 * DeepReader 工具：派出写作助手
 */

import { tool } from 'langchain';
import { z } from 'zod';

export interface SpawnWriterInput {
  segmentId: number;
  sceneTitle: string;
  writingHints: string;
}

export interface SpawnWriterResult {
  segmentId: number;
  content: string;
  charCount: number;
}

/**
 * 创建派出写作助手工具
 * @param handler 处理函数，生成指定片段的评书内容
 */
export function createSpawnWriterTool(
  handler: (input: SpawnWriterInput) => Promise<SpawnWriterResult>
) {
  return tool(
    async (input) => {
      const result = await handler({
        segmentId: input.segmentId,
        sceneTitle: input.sceneTitle,
        writingHints: input.writingHints,
      });
      return JSON.stringify(result);
    },
    {
      name: 'spawn_writer',
      description: '派一个写作助手，将指定片段的原文改写成评书。每次只处理一个片段。',
      schema: z.object({
        segmentId: z.number().describe('要处理的片段编号（从 1 开始）'),
        sceneTitle: z.string().describe('这个场景的标题，用于评书回目'),
        writingHints: z.string().describe('写作提示，说明这个场景的重点、氛围、要强调的内容'),
      }),
    }
  );
}

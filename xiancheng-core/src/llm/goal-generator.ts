// ============================================================
// 清河县 · LLM 版 Goal 生成
// Phase 5：LLM 决策管道
// ============================================================

import { Character, World, Goal } from '../types';
import { LLMClient } from './client';
import { GOAL_GENERATION_SCHEMA, ZodGoalGeneration } from './schemas';
import { renderDrives } from '../drive';

export class LlmGoalGenerator {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  get isConfigured(): boolean {
    return this.llm.isConfigured;
  }

  /** 基于 drives + 状态生成新 Goal */
  async generate(character: Character, world: World): Promise<Goal | null> {
    const prompt = `
你是一个中国古代县城里的角色：${character.name}（${character.role}）。

【你的驱动力】（0-1，越高越渴望）
${renderDrives(character.drives)}

【你的现状】
- 银两：${character.money}
- 通缉度：${character.wantedLevel}
- 是否被关押：${character.isDetained}
- 是否在组织：${character.factionId ?? '无'}

【当前世界】
- 治安：${world.state.security} 民心：${world.state.publicMorale} 粮价：${world.state.grainPrice}

请根据你的驱动力和现状，判断你是否需要一个新目标。如果需要一个明确、可执行的目标：
- description：目标描述（如"攒够100两银子"）
- conditionType/conditionValue：目标完成条件
- priority：优先级 0-1
- strategy：你打算怎么实现这个目标

如果你觉得当前不需要新目标，shouldGenerate 设为 false。
`;

    const raw = await this.llm.chat(
      [
        { role: 'system', content: '你是目标规划模块。严格输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { jsonSchema: GOAL_GENERATION_SCHEMA, temperature: 0.4 },
    );

    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = ZodGoalGeneration.parse(JSON.parse(cleaned));

      if (!parsed.shouldGenerate) return null;

      return {
        id: `goal_${character.id}_${Date.now()}`,
        characterId: character.id,
        description: parsed.description ?? '未命名目标',
        condition: {
          type: parsed.conditionType ?? 'custom',
          ...(parsed.conditionType === 'money_ge' ? { value: parsed.conditionValue ?? 0 } : {}),
          ...(parsed.conditionType === 'wanted_le' ? { value: parsed.conditionValue ?? 0 } : {}),
          ...(parsed.conditionType === 'custom' ? { description: parsed.description ?? '', check: 'custom_goal' } : {}),
        } as Goal['condition'],
        priority: parsed.priority ?? 0.5,
        status: 'active',
        progress: 0,
        createdAt: world.tick,
        source: 'llm',
        strategy: parsed.strategy,
      };
    } catch (e) {
      console.warn(`[Goal生成失败] ${character.name}: ${e}`);
      return null;
    }
  }
}
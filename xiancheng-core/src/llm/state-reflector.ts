// ============================================================
// 清河县 · 状态反思器（LLM 生成新状态）
// v2：NPC 完成行动后，LLM 反思并输出新目标+规划
// ============================================================

import { Character, World, NpcState, Perception, ActionType } from '../types';
import { LLMClient } from './client';
import { NPC_STATE_OUTPUT_SCHEMA } from '../types';
import { buildStateReflectionPrompt, buildInitialStatePrompt } from './prompt-builder-v2';
import { MemorySystem } from '../memory';
import { Perceiver } from '../perceiver';
import { renderDrives } from '../drive';

export class NpcStateReflector {
  private llm: LLMClient;
  private memorySystem: MemorySystem;
  private useLlm: boolean;
  private systemPrompts = new Map<string, string>();

  constructor(llm: LLMClient, memorySystem: MemorySystem, useLlm = true) {
    this.llm = llm;
    this.memorySystem = memorySystem;
    this.useLlm = useLlm;
  }

  get usesLlm(): boolean { return this.useLlm; }

  /** 生成初始状态（开局） */
  async generateInitialState(character: Character, world: World): Promise<NpcState> {
    let state: NpcState;
    if (!this.useLlm) {
      state = this.testState(character, world, 'initial');
    } else {
      try {
        const systemPrompt = this.getSystemPrompt(character);
        const perception = new Perceiver(world).perceive(character);
        const memories = this.memorySystem.retrieve(character.id, '', world, 5);
        const userContent = buildInitialStatePrompt(character, world, perception, memories);

        const raw = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          { jsonSchema: NPC_STATE_OUTPUT_SCHEMA, temperature: 0.7, maxTokens: 512 },
        );

        state = this.parseState(raw, character.id, world, 'initial');
      } catch (e) {
        console.warn(`  [初始状态生成失败] ${character.name}: ${e}`);
        state = this.testState(character, world, 'initial');
      }
    }
    character.npcState = state;
    return state;
  }

  /** 反思：基于当前状态+结果生成新状态 */
  async reflect(
    character: Character,
    world: World,
    oldState: NpcState | null,
    result?: 'success' | 'fail',
  ): Promise<NpcState> {
    let state: NpcState;
    if (!this.useLlm) {
      state = this.testState(character, world, 'reflection');
    } else {
      try {
        const systemPrompt = this.getSystemPrompt(character);
        const perception = new Perceiver(world).perceive(character);
        const memories = this.memorySystem.retrieve(character.id, '', world, 8);
        const userContent = buildStateReflectionPrompt(character, world, perception, memories, oldState, result);

        const raw = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          { jsonSchema: NPC_STATE_OUTPUT_SCHEMA, temperature: 0.7, maxTokens: 512 },
        );

        state = this.parseState(raw, character.id, world, 'reflection');
      } catch (e) {
        console.warn(`  [反思失败] ${character.name}: ${e}`);
        state = this.testState(character, world, 'reflection');
      }
    }
    character.npcState = state;
    return state;
  }

  /** 对话中的回应（由 conversation.ts 调用）——只输出一句话 */
  async reply(character: Character, world: World, heardFrom: string, heardContent: string): Promise<string> {
    if (!this.useLlm) {
      const templates = ['嗯，原来如此。', '这事我得想想。', '你说得有道理。', '不必再说了。'];
      return templates[Math.floor(Math.random() * templates.length)];
    }
    try {
      const systemPrompt = `你是${character.name}（${character.role}），古代县城里的角色。说话简短，符合身份。`;
      const userContent = `${heardFrom}对你说："${heardContent}"\n\n你现在在：${character.locationId}\n你回应他（不超过2句话）：`;
      const raw = await this.llm.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        { temperature: 0.7, maxTokens: 100 },
      );
      return raw.trim();
    } catch (e) {
      console.warn(`  [对话回应失败] ${character.name}: ${e}`);
      return '嗯。';
    }
  }

  /** 测试模式状态（无 LLM 时用简单规则） */
  private testState(character: Character, world: World, source: 'initial' | 'reflection'): NpcState {
    const d = character.drives;
    let goal = '四处转转，看看情况';
    let plan: NpcState['plan'] = [
      { action: 'move', targetId: 'market', duration: 10 },
      { action: 'wait', duration: 20 },
    ];

    // 缺钱 → 去想办法
    if (d.wealth < 0.4 && character.socialStatus === 'criminal') {
      goal = '搞点钱';
      plan = [
        { action: 'move', targetId: 'shop', duration: 10 },
        { action: 'steal', targetId: 'char_shangren', parameters: { amount: 20 }, duration: 5 },
        { action: 'move', targetId: 'hideout', duration: 10 },
        { action: 'wait', duration: 30 },
      ];
    } else if (d.wealth < 0.4) {
      goal = '想办法赚钱';
      plan = [
        { action: 'move', targetId: 'market', duration: 10 },
        { action: 'sell', parameters: { itemId: 'grain', quantity: 1 }, duration: 5 },
        { action: 'wait', duration: 30 },
      ];
    }

    return {
      id: `st_${character.id}_${Date.now()}`,
      characterId: character.id,
      goal,
      plan,
      successCondition: { type: 'money_ge', value: 100 },
      failureCondition: undefined,
      currentStepIndex: 0,
      source,
      createdAt: world.clock.now,
    };
  }

  private getSystemPrompt(character: Character): string {
    let cached = this.systemPrompts.get(character.id);
    if (!cached) {
      cached = `你是一个中国古代县城里的角色，正在参与一场持续的社会模拟。

【你的身份】
- 名字：${character.name}
- 身份：${character.role}
- 社会地位：${character.socialStatus}
- 组织：${character.factionId ?? '无'}

【你的性格】（0-1）
- 贪婪：${character.personality.greed.toFixed(1)}
- 风险偏好：${character.personality.riskTolerance.toFixed(1)}
- 攻击性：${character.personality.aggression.toFixed(1)}
- 忠诚：${character.personality.loyalty.toFixed(1)}
- 野心：${character.personality.ambition.toFixed(1)}

【行为准则】
1. 你是一个"人"，根据自己的性格、需求、处境决定目标和行动。
2. 目标用自然语言表达（你想达成什么）。
3. 行动规划必须由代码可执行的动作组成（move/talk/steal/buy/sell/give_money/bribe/threaten/demand_money/hire/report_crime/arrest/release/join_faction/leave_faction/wait）。
4. 每个行动要给出预计耗时（分钟）。
5. 必须给出"成功条件"——你怎样算达成目标，代码会验证它。
6. 可以做好事也可以做坏事，但要承担后果。
7. 用第一人称思考。`;
      this.systemPrompts.set(character.id, cached);
    }
    return cached;
  }

  /** 健壮 JSON 解析：处理尾逗号、JSON 后杂质、无 JSON 块的情况 */
  private robustParseJson(raw: string): unknown {
    // 1. 去掉 markdown 代码块标记
    let cleaned = raw
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    // 2. 提取第一个 `{` 到最后一个 `}` 之间
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('无 JSON 对象');
    let jsonText = cleaned.slice(start, end + 1);

    // 3. 尝试直接解析
    try {
      return JSON.parse(jsonText);
    } catch {
      // 4. 去掉尾逗号（",}" 或 ",]}"）后重试
      try {
        jsonText = jsonText.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(jsonText);
      } catch {
        // 5. 去掉注释行（// 和 /* */）
        try {
          jsonText = jsonText
            .replace(/\/\/[^\n"]*/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');
          return JSON.parse(jsonText);
        } catch {
          // 6. 最后兜底：对每个可能的截断点尝试（找合法的闭合）
          for (let i = jsonText.length; i > 0; i--) {
            const candidate = jsonText.slice(0, i);
            if (candidate.endsWith('}') || candidate.endsWith(']')) {
              try {
                return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
              } catch { /* 继续尝试更短的 */ }
            }
          }
          throw new Error('JSON 解析失败');
        }
      }
    }
  }

  private parseState(raw: string, characterId: string, world: World, source: 'initial' | 'reflection'): NpcState {
    const parsedRaw = this.robustParseJson(raw) as Record<string, any>;

    if (!parsedRaw.goal || !Array.isArray(parsedRaw.plan) || parsedRaw.plan.length === 0) {
      throw new Error('缺少 goal 或 plan');
    }

    const plan = parsedRaw.plan.map((p: any) => ({
      action: (p.action ?? 'wait') as ActionType,
      targetId: p.targetId,
      parameters: p.parameters,
      duration: Math.max(1, Number(p.duration) || 5),
    }));

    const successCondition = parsedRaw.successCondition?.type
      ? parsedRaw.successCondition
      : { type: 'custom', check: 'default' };

    return {
      id: `st_${characterId}_${Date.now()}`,
      characterId,
      goal: String(parsedRaw.goal),
      plan,
      successCondition,
      failureCondition: parsedRaw.failureCondition?.type ? parsedRaw.failureCondition : undefined,
      currentStepIndex: 0,
      source,
      createdAt: world.clock.now,
    };
  }
}

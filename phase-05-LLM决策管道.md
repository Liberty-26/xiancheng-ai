# Phase 5：LLM 决策管道

> 目标：真正的 LLM 替代 Phase 4 的硬编码模板，基于角色状态 + drives + goal + 记忆做决策
>
> 预计时间：4-5 小时
>
> 前置依赖：Phase 4（Drive + Goal 系统可用）

---

## 5.1 创建的所有文件

```
src/
├── llm/
│   ├── client.ts         # LLM 客户端（OpenAI 兼容协议）
│   ├── prompt-builder.ts # 三层上下文拼装（系统提示词 + 状态快照 + 记忆）
│   ├── decision-maker.ts # 决策主逻辑（结构化输出 + 校验 + 重试）
│   ├── goal-generator.ts # 基于 drives 的 Goal 生成（LLM 版）
│   └── schemas.ts        # JSON Schema + zod 校验
├── memory.ts             # 记忆系统（事件 → 记忆 → 检索）
└── engine.ts             # 修改：LLM 决策替换测试决策
```

---

## 5.2 核心概念（回顾）

### 三层上下文

```
L1 系统提示词（固定）：你是谁 + 世界规则 + 输出格式    —— 角色创建时生成，缓存
L2 状态快照（动态）：位置/附近/Drives/Goal/关系/动作菜单 —— 每次决策现拼
L3 记忆检索（按需）：相关历史记忆                    —— 决策时检索 Top 8
```

### 记忆反馈回路（让模型"知道"后果的关键）

```
动作 → 规则引擎算后果 → 后果写成记忆 → 下次决策时记忆进入上下文 → 模型调整行为
```

---

## 5.3 llm/client.ts —— LLM 客户端

```typescript
// 使用 OpenAI 兼容协议（DeepSeek / Qwen / OpenRouter 均可）
import dotenv from 'dotenv';
dotenv.config();

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;  // 结构化输出
}

export class LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
    this.apiKey = process.env.LLM_API_KEY ?? '';
    this.model = process.env.LLM_MODEL ?? 'deepseek-chat';
  }

  async chat(
    messages: LLMMessage[],
    options: LLMOptions = {}
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 512,
    };

    // 结构化输出：使用 response_format 强制 JSON
    if (options.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          schema: options.jsonSchema,
        },
      };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}
```

`.env` 配置：
```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=deepseek-chat
```

---

## 5.4 llm/schemas.ts —— 结构化输出

```typescript
import { z } from 'zod';
import { ActionType } from '../types';

// 当前可用动作（从 action-menu-builder 动态生成，这里给基础集）
export const AVAILABLE_ACTIONS = [
  'move', 'talk', 'give_money', 'steal', 'buy', 'sell',
  'arrest', 'release', 'bribe', 'threaten', 'hire',
  'report_crime', 'join_faction', 'leave_faction', 'demand_money',
  'idle',
] as const;

// 决策输出 Schema（给 LLM 的 JSON Schema）
export const ACTION_DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: AVAILABLE_ACTIONS,
      description: '你要执行的动作，只能从列表里选',
    },
    targetId: {
      type: 'string',
      description: '动作目标（角色ID或地点ID），不需要目标可不填',
    },
    parameters: {
      type: 'object',
      description: '动作参数（如 amount/quantity/itemId/locationId/message）',
    },
    reason: {
      type: 'string',
      description: '为什么这么做（2-3句话）',
    },
    innerMonologue: {
      type: 'string',
      description: '你的内心独白（给玩家看，体现你的性格）',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

// zod 校验
export const ZodActionDecision = z.object({
  action: z.enum(AVAILABLE_ACTIONS),
  targetId: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  reason: z.string().optional(),
  innerMonologue: z.string().optional(),
});

export type ParsedDecision = z.infer<typeof ZodActionDecision>;

// Goal 生成输出 Schema
export const GOAL_GENERATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    shouldGenerate: { type: 'boolean', description: '是否需要新的目标' },
    description: { type: 'string', description: '目标的自然语言描述' },
    conditionType: {
      type: 'string',
      enum: ['money_ge', 'item_has', 'relationship_le', 'location_at', 'faction_joined', 'wanted_le', 'custom'],
    },
    conditionValue: { type: 'number', description: '条件的数值' },
    priority: { type: 'number', description: '优先级 0-1' },
    strategy: { type: 'string', description: '你打算怎么实现这个目标' },
  },
  required: ['shouldGenerate'],
};

export const ZodGoalGeneration = z.object({
  shouldGenerate: z.boolean(),
  description: z.string().optional(),
  conditionType: z.enum(['money_ge', 'item_has', 'relationship_le', 'location_at', 'faction_joined', 'wanted_le', 'custom']).optional(),
  conditionValue: z.number().optional(),
  priority: z.number().optional(),
  strategy: z.string().optional(),
});
```

---

## 5.5 memory.ts —— 记忆系统

```typescript
import { Memory, GameEvent, Character, World } from './types';

export class MemorySystem {
  private memories: Map<string, Memory[]> = new Map();  // characterId → memories

  constructor() {}

  /** 事件 → 记忆 */
  recordEvent(event: GameEvent, world: World): void {
    // 给行为者和目标（如果存在）都记录记忆
    const recipients = new Set<string>([event.actorId]);
    if (event.targetId) recipients.add(event.targetId);

    for (const cid of recipients) {
      const importance = this.computeImportance(event);
      this.addMemory({
        id: `mem_${event.id}_${cid}`,
        characterId: cid,
        tick: event.tick,
        text: event.description,
        type: 'event',
        importance,
        credibility: 1,  // 亲身经历 = 100% 可信
        relatedCharacterIds: [event.actorId, ...(event.targetId ? [event.targetId] : [])],
        tags: [event.type, event.locationId],
      });
    }

    // 目击者也记录（可信度稍低）
    for (const witnessId of event.witnesses) {
      if (recipients.has(witnessId)) continue;
      this.addMemory({
        id: `mem_${event.id}_${witnessId}`,
        characterId: witnessId,
        tick: event.tick,
        text: `我亲眼看到：${event.description}`,
        type: 'event',
        importance: this.computeImportance(event) * 0.8,
        credibility: 0.9,
        relatedCharacterIds: [event.actorId, ...(event.targetId ? [event.targetId] : [])],
        tags: [event.type, event.locationId],
      });
    }
  }

  /** 关系变化 → 记忆 */
  recordRelationshipChange(
    characterId: string,
    otherId: string,
    change: { field: string; value: number },
    tick: number
  ): void {
    const fieldNames: Record<string, string> = {
      trust: '信任', affinity: '好感', fear: '恐惧', respect: '尊敬', loyalty: '忠诚', resentment: '怨恨',
    };
    const dir = change.value > 0 ? '上升了' : '下降了';
    const abs = Math.abs(change.value);
    this.addMemory({
      id: `mem_rel_${characterId}_${otherId}_${tick}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      tick,
      text: `我对${otherId}的${fieldNames[change.field] ?? change.field}${dir}（${abs}）`,
      type: 'relationship',
      importance: Math.min(0.9, abs / 100),
      credibility: 1,
      relatedCharacterIds: [otherId],
      tags: ['relationship'],
    });
  }

  /** 被传递的信息 → 记忆（可信度取决于来源） */
  recordRumor(characterId: string, rumor: { content: string; credibility: number; sourceId: string }, tick: number): void {
    this.addMemory({
      id: `mem_rumor_${characterId}_${tick}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      tick,
      text: `我听说：${rumor.content}`,
      type: 'info',
      importance: 0.4,
      credibility: rumor.credibility,
      relatedCharacterIds: rumor.sourceId ? [rumor.sourceId] : [],
      tags: ['rumor', 'info'],
    });
  }

  /** 检索：按相关性 + 重要性 + 新鲜度 */
  retrieve(characterId: string, query: string, world: World, limit = 8): Memory[] {
    const all = this.memories.get(characterId) ?? [];
    const now = world.tick;

    return all
      .filter(m => now - m.tick < 100)   // 100 tick 内的记忆
      .map(m => ({
        ...m,
        _score: this.relevanceScore(m, query) * 0.5 + m.importance * 0.3 + this.freshness(m, now) * 0.2,
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  /** 把记忆渲染成文本（给 LLM） */
  renderMemories(memories: Memory[], world: World): string {
    return memories.map(m => {
      const cred = m.credibility < 1 ? `（可信度${Math.round(m.credibility * 100)}%）` : '';
      const time = `[tick ${m.tick}]`;
      return `- ${time} ${m.text}${cred}`;
    }).join('\n');
  }

  private relevanceScore(m: Memory, query: string): number {
    if (!query) return 0.5;
    const qWords = query.toLowerCase().split(/\s+/);
    const mText = (m.text + ' ' + m.tags.join(' ')).toLowerCase();
    const hits = qWords.filter(w => mText.includes(w)).length;
    return hits / qWords.length;
  }

  private freshness(m: Memory, now: number): number {
    return Math.max(0, 1 - (now - m.tick) / 100);
  }

  private computeImportance(event: GameEvent): number {
    // 重大事件更重要
    const IMPORTANCE: Record<string, number> = {
      steal: 0.7, arrest: 0.8, release: 0.6, bribe: 0.7, threaten: 0.7,
      demand_money: 0.7, report_crime: 0.6, hire: 0.5, give_money: 0.5,
      buy: 0.3, sell: 0.3, move: 0.2, talk: 0.3, idle: 0.1, join_faction: 0.6, leave_faction: 0.5,
    };
    return IMPORTANCE[event.type] ?? 0.4;
  }

  private addMemory(m: Memory): void {
    const list = this.memories.get(m.characterId) ?? [];
    list.push(m);
    // 限制每个角色最多 100 条记忆
    if (list.length > 100) list.shift();
    this.memories.set(m.characterId, list);
  }
}
```

---

## 5.6 llm/prompt-builder.ts —— 三层上下文

```typescript
import { Character, World, Perception, Memory } from '../types';
import { renderActionMenu } from './action-menu';   // 见 5.7
import { renderGoal } from '../goal-manager';

export interface PromptContext {
  character: Character;
  world: World;
  perception: Perception;
  memories: Memory[];
}

/** L1：系统提示词（固定，可缓存） */
export function buildSystemPrompt(character: Character): string {
  return `你是一个中国古代县城里的角色，正在参与一场持续的社会模拟。

【你的身份】
- 名字：${character.name}
- 身份：${character.role}
- 社会地位：${character.socialStatus}
- 你在组织：${character.factionId ? '是组织成员' : '无组织'}

【你的性格】（0-1 越高越明显）
- 贪婪：${character.personality.greed.toFixed(1)}
- 风险偏好：${character.personality.riskTolerance.toFixed(1)}
- 攻击性：${character.personality.aggression.toFixed(1)}
- 同理心：${character.personality.empathy.toFixed(1)}
- 忠诚：${character.personality.loyalty.toFixed(1)}
- 诚实：${character.personality.honesty.toFixed(1)}
- 野心：${character.personality.ambition.toFixed(1)}
- 服从权威：${character.personality.obedience.toFixed(1)}

【行为准则】
1. 你是一个"人"，根据你的性格、需求、目标做合理的决定。
2. 你可以做好事也可以做坏事，但要承担后果。
3. 永远记住：你只能从"可选动作"里选，不能发明动作。
4. 你的决定会真实改变世界，并影响你和其他人的关系。
5. 用第一人称思考，像一个真实的古人。

【输出格式】
你必须输出严格的 JSON，格式如下：
{
  "action": "你选择的动作",
  "targetId": "目标ID（可选）",
  "parameters": { "参数名": 值 },
  "reason": "你为什么这么做（2-3句）",
  "innerMonologue": "你的内心独白（1-2句，体现性格）"
}`;
}

/** L2 + L3：状态快照 + 记忆（每次决策现拼） */
export function buildUserContent(ctx: PromptContext): string {
  const { character, world, perception, memories } = ctx;

  const lines: string[] = [];

  // ── 世界状态 ──
  lines.push(`## 当前世界`);
  lines.push(`- 时间：第 ${world.time.day} 天 ${world.time.timeOfDay}`);
  lines.push(`- 治安：${world.state.security}，民心：${world.state.publicMorale}，粮价：${world.state.grainPrice}，官府威望：${world.state.governmentPrestige}，犯罪程度：${world.state.crimeLevel}`);
  lines.push('');

  // ── 感知 ──
  lines.push(`## 你现在的处境`);
  lines.push(`- 你在：${perception.locationId}`);
  if (perception.nearbyCharacterIds.length > 0) {
    lines.push(`- 附近的人：${perception.nearbyCharacterIds.map(id => world.characters.get(id)?.name ?? id).join('、')}`);
  } else {
    lines.push('- 附近没有其他人');
  }
  lines.push('');

  // ── 内部状态 ──
  lines.push(`## 你的内部状态`);
  lines.push(`【驱动力】（0-1）`);
  lines.push(`- 安全：${character.drives.safety.toFixed(2)} ${describeDrive('safety', character.drives.safety)}`);
  lines.push(`- 财富：${character.drives.wealth.toFixed(2)} ${describeDrive('wealth', character.drives.wealth)}`);
  lines.push(`- 权力：${character.drives.power.toFixed(2)} ${describeDrive('power', character.drives.power)}`);
  lines.push(`- 归属：${character.drives.belonging.toFixed(2)} ${describeDrive('belonging', character.drives.belonging)}`);
  lines.push(`- 复仇：${character.drives.revenge.toFixed(2)} ${describeDrive('revenge', character.drives.revenge)}`);
  lines.push('');
  lines.push(`【当前目标】`);
  lines.push(renderGoal(character));
  lines.push('');
  lines.push(`【财产】`);
  lines.push(`- 银两：${character.money}`);
  if (character.inventory.length > 0) {
    lines.push(`- 物品：${character.inventory.map(i => `${i.itemId}×${i.quantity}`).join('、')}`);
  }
  if (character.wantedLevel > 0) {
    lines.push(`- 通缉度：${character.wantedLevel}（你被官府通缉了！）`);
  }
  lines.push('');

  // ── 关系（与附近的人）──
  const relevantIds = new Set([
    ...perception.nearbyCharacterIds,
    ...(character.currentGoal ? character.currentGoal.condition.type === 'relationship_le' ? [character.currentGoal.condition.targetId] : [] : []),
  ]);
  if (relevantIds.size > 0) {
    lines.push(`【人际关系】`);
    for (const rid of relevantIds) {
      const rel = character.relationships.get(rid);
      const name = world.characters.get(rid)?.name ?? rid;
      if (rel) {
        lines.push(`- 对${name}：信任${rel.trust} 好感${rel.affinity} 恐惧${rel.fear} 怨恨${rel.resentment}`);
      }
    }
    lines.push('');
  }

  // ── 记忆 ──
  if (memories.length > 0) {
    lines.push(`## 你最近的记忆`);
    for (const m of memories) {
      const cred = m.credibility < 1 ? `（可信度${Math.round(m.credibility * 100)}%）` : '';
      lines.push(`- [${m.tick}] ${m.text}${cred}`);
    }
    lines.push('');
  }

  // ── 动作菜单 ──
  lines.push(`## 你现在可以做的动作`);
  lines.push(renderActionMenu(character, world));
  lines.push('');
  lines.push(`请决定你接下来做什么，输出 JSON：`);

  return lines.join('\n');
}

function describeDrive(key: string, value: number): string {
  if (value > 0.7) {
    return { safety: '（你非常不安，急需安全）', wealth: '（你极度渴望财富）', power: '（你渴望权力）', belonging: '（你渴望被接纳）', revenge: '（你满心仇恨）' }[key] ?? '';
  }
  if (value < 0.3) {
    return { safety: '（你感到安全）', wealth: '（你暂时不缺钱）', power: '（你对权力没兴趣）', belonging: '（你习惯独来独往）', revenge: '（你没有仇恨）' }[key] ?? '';
  }
  return '';
}
```

---

## 5.7 llm/action-menu.ts —— 动作菜单

```typescript
import { Character, World } from '../types';

/**
 * 生成角色当前可用动作菜单（带条件 + 角色身份提示）
 * 只有"现实允许"的动作才出现在菜单里
 */
export function renderActionMenu(character: Character, world: World): string {
  const items: string[] = [];

  // 移动（到附近地点）
  const LOCATIONS = world.locations ?? {
    yamen: '县衙', market: '街市', shop: '商铺', warehouse: '仓库',
    houses: '民宅', hideout: '地下据点', gate: '城门',
  };
  items.push(`- move —— 移动到其他地点（可选：${Object.keys(LOCATIONS).join('/')}）`);

  // 交谈（附近有人）
  const nearby = Array.from(world.characters.values())
    .filter(c => c.id !== character.id && c.locationId === character.locationId && c.isAlive);
  if (nearby.length > 0) {
    items.push(`- talk —— 和附近的人交谈（目标：${nearby.map(c => `${c.name}(${c.id})`).join('、')}）`);
  }

  // 经济类
  items.push(`- give_money —— 给别人钱（参数 amount）`);
  items.push(`- buy —— 买东西（参数 itemId, quantity）`);
  items.push(`- sell —— 卖东西（参数 itemId, quantity）`);

  // 犯罪类（按身份提示 💡）
  if (character.socialStatus === 'criminal' || character.drives.wealth < 0.4) {
    items.push(`- steal —— 偷窃（参数 amount, targetId）💡 符合你的处境`);
    items.push(`- demand_money —— 勒索（参数 amount, targetId）`);
  } else {
    items.push(`- steal —— 偷窃（参数 amount, targetId）`);
  }
  items.push(`- bribe —— 行贿（参数 amount, targetId）`);

  // 执法类（有权限才显示）
  if (character.authorityLevel >= 5) {
    items.push(`- arrest —— 逮捕（目标：被通缉或可疑的人）💡 你有执法权`);
    items.push(`- release —— 释放（目标：在押的人）`);
    items.push(`- report_crime —— 举报犯罪（targetId）`);
  }

  // 组织类
  if (!character.factionId) {
    items.push(`- join_faction —— 加入组织（参数 factionId）`);
  } else {
    items.push(`- leave_faction —— 退出组织`);
  }

  items.push(`- hire —— 雇佣别人（参数 wage, targetId）`);
  items.push(`- idle —— 原地发呆（什么都不做）`);

  return items.map(s => `  ${s}`).join('\n');
}
```

---

## 5.8 llm/decision-maker.ts —— 决策主逻辑

```typescript
import { Character, World, Perception, ActionDecision, Memory } from '../types';
import { LLMClient } from './client';
import { buildSystemPrompt, buildUserContent } from './prompt-builder';
import { ACTION_DECISION_SCHEMA, ZodActionDecision, ParsedDecision } from './schemas';
import { MemorySystem } from '../memory';

export class DecisionMaker {
  private llm: LLMClient;
  private memorySystem: MemorySystem;
  private systemPrompts = new Map<string, string>();  // 缓存系统提示词

  constructor(llm: LLMClient, memorySystem: MemorySystem) {
    this.llm = llm;
    this.memorySystem = memorySystem;
  }

  /** 让角色做一次决策（含校验 + 重试） */
  async decide(character: Character, world: World, perception: Perception): Promise<ActionDecision> {
    // L1：系统提示词（缓存）
    let systemPrompt = this.systemPrompts.get(character.id);
    if (!systemPrompt) {
      systemPrompt = buildSystemPrompt(character);
      this.systemPrompts.set(character.id, systemPrompt);
    }

    // L3：检索记忆
    const memories = this.memorySystem.retrieve(character.id, '', world, 8);

    // L2：拼装状态快照
    const userContent = buildUserContent({ character, world, perception, memories });

    // 调用 LLM（最多重试 2 次）
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          { jsonSchema: ACTION_DECISION_SCHEMA, temperature: 0.7 }
        );

        // 解析 JSON
        const parsed = this.parseJson(raw);
        const decision = this.validateDecision(parsed, character);
        return decision;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`  [重试${attempt + 1}] ${character.name} 决策校验失败: ${lastError}`);
      }
    }

    // 全部失败 → 回退 idle
    return {
      action: 'idle',
      reason: '我一时不知该怎么办',
      innerMonologue: `（内心：${lastError.slice(0, 50)}）`,
    };
  }

  private parseJson(raw: string): unknown {
    // 兼容 LLM 输出可能带 ```json 代码块
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    // 提取第一个 { 到最后一个 }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('无 JSON 对象');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  private validateDecision(raw: unknown, character: Character): ActionDecision {
    const parsed: ParsedDecision = ZodActionDecision.parse(raw);

    // 额外校验：action 必须合法（此处由 rules 层再校验，这里只做基本校验）
    if (!parsed.action) throw new Error('缺少 action');

    return {
      action: parsed.action,
      targetId: parsed.targetId,
      parameters: parsed.parameters,
      reason: parsed.reason,
      innerMonologue: parsed.innerMonologue,
    };
  }
}
```

---

## 5.9 llm/goal-generator.ts —— Goal 生成（LLM 版）

```typescript
import { Character, World, Goal } from '../types';
import { LLMClient } from './client';
import { GOAL_GENERATION_SCHEMA, ZodGoalGeneration } from './schemas';

export class GoalGenerator {
  private llm: LLMClient;

  constructor(llm: LLMClient) {
    this.llm = llm;
  }

  /** 基于 drives + 状态生成新 Goal */
  async generate(character: Character, world: World): Promise<Goal | null> {
    const prompt = `
你是一个中国古代县城里的角色：${character.name}（${character.role}）。

【你的驱动力】（0-1，越高越渴望）
- 安全：${character.drives.safety.toFixed(2)}
- 财富：${character.drives.wealth.toFixed(2)}
- 权力：${character.drives.power.toFixed(2)}
- 归属：${character.drives.belonging.toFixed(2)}
- 复仇：${character.drives.revenge.toFixed(2)}

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
- strategy：实现策略

如果你觉得当前不需要新目标，shouldGenerate 设为 false。
`;

    const raw = await this.llm.chat(
      [
        { role: 'system', content: '你是目标规划模块。严格输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      { jsonSchema: GOAL_GENERATION_SCHEMA, temperature: 0.4 }
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
          value: parsed.conditionValue ?? 0,
          ...(parsed.conditionType === 'custom' ? { check: 'custom_goal' } : {}),
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
```

---

## 5.10 修改 engine.ts —— LLM 决策替换测试决策

```typescript
// engine.ts 关键改动：

import { LLMClient } from './llm/client';
import { DecisionMaker } from './llm/decision-maker';
import { GoalGenerator } from './llm/goal-generator';
import { MemorySystem } from './memory';

export class SimulationEngine {
  // ...
  private llm: LLMClient;
  private decisionMaker: DecisionMaker;
  private goalGenerator: GoalGenerator;
  private memorySystem: MemorySystem;
  private perceptions = new Map<string, Perception>();

  constructor() {
    this.world = createInitialWorld();
    this.llm = new LLMClient();
    this.memorySystem = new MemorySystem();
    this.decisionMaker = new DecisionMaker(this.llm, this.memorySystem);
    this.goalGenerator = new GoalGenerator(this.llm);
    this.goalManager = new GoalManager(this.world, this.goalGenerator);  // 传 LLM 版生成器
    this.perceiver = new Perceiver(this.world);
  }

  private async tick() {
    // ... 时间推进 ...

    // 衰减 Drives
    for (const c of this.world.characters.values()) decayDrives(c);

    // 收集感知
    for (const [id, c] of this.world.characters) {
      this.perceptions.set(id, this.perceiver.perceive(c));
    }

    // 每个角色决策（LLM）
    for (const [id, character] of this.world.characters) {
      if (character.isDetained || !character.isAlive) continue;

      const perception = this.perceptions.get(id)!;
      
      // ★ LLM 决策
      const decision = await this.decisionMaker.decide(character, this.world, perception);

      // 执行
      const event = executeAction(decision, character, this.world);
      this.world.events.push(event);
      this.applyEvent(event);

      // ★ 事件 → Drive 变化
      applyDriveChanges(character, event, this.world);

      // ★ 事件 → 记忆
      this.memorySystem.recordEvent(event, this.world);

      // ★ 关系变化 → 记忆
      for (const rc of event.result.relationshipChanges ?? []) {
        for (const [field, val] of Object.entries(rc.changes)) {
          if (Math.abs(val as number) >= 10) {  // 只记录明显变化
            this.memorySystem.recordRelationshipChange(rc.fromId, rc.toId, { field, value: val as number }, this.world.tick);
          }
        }
      }

      // 信息传播
      this.knowledge.recordEvent(event);

      // 打印
      const status = event.success ? '✅' : '❌';
      const why = decision.reason ? ` —— ${decision.reason.slice(0, 60)}` : '';
      console.log(`  ${status} ${event.description}${why}`);
    }

    // Goal 检查与重评估
    await this.goalManager.tick();

    // 随机八卦
    randomGossip(this.world, this.knowledge);

    this.printWorldState();
    console.log('');
  }
}
```

---

## 5.11 成本控制

| 项目 | 策略 | 每次成本 |
|---|---|---|
| 角色决策 | 只在角色"可决策"时调用（Phase 8 细化） | ~0.002 元 |
| Goal 生成 | 每 5 tick 或 drive 漂移 > 0.15 才调用 | ~0.001 元 |
| 单角色每 tick | 1 次决策调用 | ~0.002 元 |
| 7 角色 × 100 tick | 700 次决策 + 140 次 Goal | ~1.7 元 |

---

## 5.12 验收测试

### 验收标准 1：决策是结构化且有效的

```bash
npx tsx -e "
import { createInitialWorld } from './src/data/world';
import { LLMClient } from './src/llm/client';
import { DecisionMaker } from './src/llm/decision-maker';
import { MemorySystem } from './src/memory';
import { Perceiver } from './src/perceiver';

const world = createInitialWorld();
const llm = new LLMClient();
const memory = new MemorySystem();
const dm = new DecisionMaker(llm, memory);
const perceiver = new Perceiver(world);

const thief = world.characters.get('char_xiaotou')!;
thief.locationId = 'warehouse';
thief.drives.wealth = 0.2;   // 很缺钱
thief.drives.safety = 0.8;   // 很安全

const decision = await dm.decide(thief, world, perceiver.perceive(thief));
console.log('决策:', JSON.stringify(decision, null, 2));
// 预期：action 在合法列表里，reason 和 innerMonologue 都有内容
"
```

### 验收标准 2：不同状态 → 不同决策

```bash
# 场景 A：三指缺钱 + 安全 → 预期偏向 steal/demand_money
# 场景 B：三指被通缉 + 不安全 → 预期偏向 hide/move/bribe
# 场景 C：商人被威胁 → 预期偏向 report_crime/hire/bribe
```

### 验收标准 3：记忆影响决策

```typescript
// 三指第一次偷商人 → 记忆："我偷了商人的钱，商人很生气"
// 第二次决策时，上下文里有这条记忆
// 预期：三指会考虑"上次偷被发现的风险"
```

---

## 5.13 验收清单

- [ ] 系统提示词缓存（角色创建时生成一次）
- [ ] 状态快照包含：世界状态/感知/Drives/Goal/关系/记忆/动作菜单
- [ ] LLM 输出是严格 JSON（JSON Schema 强制）
- [ ] zod 校验通过后才能执行
- [ ] 校验失败重试最多 2 次，全失败回退 idle
- [ ] 事件 → 记忆自动记录（actor + target + witnesses）
- [ ] 关系变化明显时也记入记忆
- [ ] 记忆检索按 相关性×0.5 + 重要性×0.3 + 新鲜度×0.2 排序
- [ ] Goal 由 LLM 基于 drives 生成（替代模板）
- [ ] 决策有 reason（叙事）+ innerMonologue（玩家可看）
- [ ] 不同状态下 LLM 决策明显不同

---

## 5.14 完成标志

运行 `npm start`，看到：
1. 每个角色每 tick 输出：✅/❌ + 事件描述 + LLM 理由
2. 三指在缺钱时主动去偷，被通缉后开始躲藏或贿赂
3. 记忆反馈：被逮捕过之后，三指会更谨慎
4. 世界状态随行为变化（治安下降/犯罪上升/关系恶化）
5. 整个过程不需要人工干预

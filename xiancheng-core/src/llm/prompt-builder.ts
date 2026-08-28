// ============================================================
// 清河县 · LLM 决策 Prompt 构建（三层上下文）
// Phase 5：LLM 决策管道
// ============================================================

import { Character, World, Perception, Memory } from '../types';
import { renderDrives } from '../drive';
import { renderGoal } from '../goal';

export interface PromptContext {
  character: Character;
  world: World;
  perception: Perception;
  memories: Memory[];
  availableActions: string[];
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
    lines.push(`- 附近的人：${perception.nearbyCharacterIds.map((id) => world.characters.get(id)?.name ?? id).join('、')}`);
  } else {
    lines.push('- 附近没有其他人');
  }
  lines.push('');

  // ── 内部状态 ──
  lines.push(`## 你的内部状态`);
  lines.push(`【驱动力】（0-1）`);
  lines.push(renderDrives(character.drives));
  lines.push('');
  lines.push(`【当前目标】`);
  lines.push(renderGoal(character));
  lines.push('');
  lines.push(`【财产】`);
  lines.push(`- 银两：${character.money}`);
  if (character.inventory.length > 0) {
    lines.push(`- 物品：${character.inventory.map((i) => `${i.itemId}×${i.quantity}`).join('、')}`);
  }
  if (character.wantedLevel > 0) {
    lines.push(`- 通缉度：${character.wantedLevel}（你被官府通缉了！）`);
  }
  lines.push('');

  // ── 关系（与附近的人）──
  const relevantIds = new Set(perception.nearbyCharacterIds);
  if (character.currentGoal?.condition.type === 'relationship_le' && 'targetId' in character.currentGoal.condition) {
    relevantIds.add((character.currentGoal.condition as { targetId: string }).targetId);
  }
  if (relevantIds.size > 0) {
    lines.push(`【人际关系】`);
    for (const rid of relevantIds) {
      const rel = character.relationships.get(rid);
      const name = world.characters.get(rid)?.name ?? rid;
      if (rel) {
        const parts = [
          rel.trust !== 0 ? `信任${rel.trust}` : null,
          rel.affinity !== 0 ? `好感${rel.affinity}` : null,
          rel.fear > 0 ? `恐惧${rel.fear}` : null,
          rel.resentment > 0 ? `怨恨${rel.resentment}` : null,
        ].filter(Boolean).join('，');
        lines.push(`- 对${name}：${parts || '关系中性'}`);
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
  for (const action of ctx.availableActions) {
    lines.push(`- ${action}`);
  }
  lines.push('');
  lines.push(`请决定你接下来做什么，输出 JSON：`);

  return lines.join('\n');
}
// ============================================================
// 清河县 · v2 Prompt 构建（情境拼装）
// ============================================================

import { Character, World, Perception, Memory, NpcState, MAP_LOCATIONS } from '../types';
import { renderDrives } from '../drive';

/** 地图地点白名单（LLM 只能选这些地点移动） */
const LOCATION_LIST = '【可移动地点】（只能从这些里选）：' +
  MAP_LOCATIONS.map(l => `${l.id}(${l.name})`).join('、') +
  '\n【可用动作】（只能选）：move/talk/steal/buy/sell/give_money/bribe/threaten/demand_money/hire/report_crime/arrest/release/join_faction/leave_faction/wait';

function renderRelationshipsText(character: Character, world: World): string {
  const lines: string[] = [];
  for (const [tid, rel] of character.relationships) {
    const name = world.characters.get(tid)?.name ?? tid;
    const parts = [
      rel.trust !== 0 ? `信任${rel.trust}` : null,
      rel.affinity !== 0 ? `好感${rel.affinity}` : null,
      rel.fear > 0 ? `恐惧${rel.fear}` : null,
      rel.resentment > 0 ? `怨恨${rel.resentment}` : null,
      rel.loyalty > 0 ? `忠诚${rel.loyalty}` : null,
    ].filter(Boolean).join('，');
    if (parts) lines.push(`- 对${name}：${parts}`);
  }
  return lines.join('\n');
}

function renderWorldText(world: World): string {
  return [
    `- 时间：第${world.time.day}天 ${world.time.timeOfDay}`,
    `- 治安：${world.state.security}，民心：${world.state.publicMorale}，粮价：${world.state.grainPrice}，官府威望：${world.state.governmentPrestige}，犯罪程度：${world.state.crimeLevel}`,
  ].join('\n');
}

function renderPerceptionText(perception: Perception, world: World): string {
  const lines = [`- 你在：${perception.locationId}`];
  if (perception.nearbyCharacterIds.length > 0) {
    lines.push(`- 附近有：${perception.nearbyCharacterIds.map(id => world.characters.get(id)?.name ?? id).join('、')}`);
  } else {
    lines.push('- 附近没有其他人');
  }
  return lines.join('\n');
}

function renderMemoriesText(memories: Memory[]): string {
  if (memories.length === 0) return '（暂无近期记忆）';
  return memories.map(m => `- ${m.text}`).join('\n');
}

/** 初始状态 prompt（开局生成目标+规划） */
export function buildInitialStatePrompt(
  character: Character,
  world: World,
  perception: Perception,
  memories: Memory[],
): string {
  return `## 当前世界
${renderWorldText(world)}

${LOCATION_LIST}

## 你现在的处境
${renderPerceptionText(perception, world)}

## 你的内部状态
【驱动力】（0-1）
${renderDrives(character.drives)}

【财产】
- 银两：${character.money}
${character.inventory.length > 0 ? `- 物品：${character.inventory.map(i => `${i.itemId}×${i.quantity}`).join('、')}` : ''}
${character.wantedLevel > 0 ? `- 通缉度：${character.wantedLevel}（你被通缉了！）` : ''}

【人际关系】
${renderRelationshipsText(character, world) || '（无特别关系）'}

【你的记忆】
${renderMemoriesText(memories)}

请决定你今天/现在要做的事。输出状态 JSON：
- goal：你的目标（自然语言）
- plan：行动规划（多步，每步 action + duration 分钟）
- successCondition：怎样算达成（代码验证）
- failureCondition：怎样算失败（可选）`;
}

/** 反思 prompt（行动完成后，基于结果重新规划） */
export function buildStateReflectionPrompt(
  character: Character,
  world: World,
  perception: Perception,
  memories: Memory[],
  oldState: NpcState | null,
  result?: 'success' | 'fail',
): string {
  const resultLine = result === 'success'
    ? '你最近的目标已经达成。'
    : result === 'fail'
      ? '你最近的努力没有成功，需要调整策略。'
      : '你最近完成了一个阶段的行动。';

  const oldStateLine = oldState
    ? `【你之前的目标】\n"${oldState.goal}"\n${oldState.plan.map((p, i) => `${i + 1}. ${p.action}(${p.targetId ?? ''}) ${p.duration}分钟`).join('\n')}\n成功条件：${JSON.stringify(oldState.successCondition)}`
    : '（没有之前的目标）';

  return `## 当前世界
${renderWorldText(world)}

${LOCATION_LIST}

## 你现在的处境
${renderPerceptionText(perception, world)}

## 你的内部状态
【驱动力】（0-1）
${renderDrives(character.drives)}

【财产】
- 银两：${character.money}
${character.wantedLevel > 0 ? `- 通缉度：${character.wantedLevel}（你被通缉了！）` : ''}

【人际关系】
${renderRelationshipsText(character, world) || '（无特别关系）'}

${oldStateLine}

${resultLine}

【你的记忆】
${renderMemoriesText(memories)}

请反思并决定下一步。输出状态 JSON：
- goal：你的目标（自然语言，可以继续之前的，也可以改变）
- plan：新的行动规划（多步）
- successCondition：怎样算达成
- failureCondition：怎样算失败（可选）`;
}

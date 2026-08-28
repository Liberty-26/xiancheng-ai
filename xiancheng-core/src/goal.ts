// ============================================================
// 清河县 · Goal 系统（目标）
// Phase 4：Drive + Goal 系统
// ============================================================

import { Character, Goal, World, GoalCondition, Relationship } from './types';

/**
 * Goal 生成（Phase 4：模板版，基于 drives + 人格）
 * Phase 5 换成 LLM 生成
 */
export function generateGoalTemplate(character: Character, world: World): Goal | null {
  const d = character.drives;
  const p = character.personality;

  // 按优先级判断最需要的目标
  const candidates: Goal[] = [];

  // 1. 安全极低 → 想提高安全
  if (d.safety < 0.3) {
    candidates.push(makeGoal(character, {
      description: '想办法提高自己的安全',
      condition: { type: 'custom', description: '购买武器或加入有保护的组织', check: 'safety_restored' },
      priority: 0.9,
      source: 'drive',
    }));
  }

  // 2. 财富低且贪婪高 → 想赚钱
  if (d.wealth < 0.35 && p.greed > 0.5) {
    candidates.push(makeGoal(character, {
      description: '攒够一笔钱（100两）',
      condition: { type: 'money_ge', value: 100 },
      priority: 0.85,
      source: 'drive',
    }));
  }

  // 3. 复仇高 → 想报复
  if (d.revenge > 0.6) {
    const enemy = findEnemy(character);
    if (enemy) {
      const enemyName = world.characters.get(enemy.id)?.name ?? enemy.id;
      candidates.push(makeGoal(character, {
        description: `报复${enemyName}`,
        condition: { type: 'relationship_le', targetId: enemy.id, field: 'trust', value: -90 },
        priority: 0.8,
        source: 'drive',
      }));
    }
  }

  // 4. 权力低但野心高 → 想提升地位
  if (d.power < 0.3 && p.ambition > 0.6) {
    candidates.push(makeGoal(character, {
      description: '提升自己在县城的地位',
      condition: { type: 'faction_joined', factionId: 'faction_guanfu' },
      priority: 0.7,
      source: 'drive',
    }));
  }

  // 5. 归属低 → 想交朋友/加入组织
  if (d.belonging < 0.3) {
    candidates.push(makeGoal(character, {
      description: '在县城里找到归属',
      condition: { type: 'custom', description: '加入一个组织或建立深厚友谊', check: 'belonging_restored' },
      priority: 0.6,
      source: 'drive',
    }));
  }

  // 返回最高优先级的目标
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] ?? null;
}

function makeGoal(
  character: Character,
  params: {
    description: string;
    condition: GoalCondition;
    priority: number;
    source: Goal['source'];
    strategy?: string;
  },
): Goal {
  return {
    id: `goal_${character.id}_${Date.now()}`,
    characterId: character.id,
    description: params.description,
    condition: params.condition,
    priority: params.priority,
    status: 'active',
    progress: 0,
    createdAt: 0,  // 调用方设置 tick
    source: params.source,
    strategy: params.strategy,
  };
}

/** 找到复仇对象（怨恨最深的人） */
function findEnemy(character: Character): { id: string; name: string } | null {
  let worst: { id: string; resentment: number } | null = null;
  for (const [id, rel] of character.relationships) {
    if (!worst || rel.resentment > worst.resentment) {
      worst = { id, resentment: rel.resentment };
    }
  }
  if (!worst || worst.resentment <= 30) return null;
  // 从 world 中找名字（但这里没有 world 参数，用 name 属性的方式简化）
  return { id: worst.id, name: worst.id };  // 调用方需覆盖 name
}

/**
 * 检查 Goal 是否完成
 */
export function checkGoalCompletion(
  goal: Goal,
  character: Character,
  world: World,
): 'completed' | 'failed' | 'active' {
  const cond = goal.condition;

  switch (cond.type) {
    case 'money_ge':
      return character.money >= cond.value ? 'completed' : 'active';

    case 'item_has': {
      const owned = character.inventory.find((i) => i.itemId === cond.itemId)?.quantity ?? 0;
      return owned >= cond.quantity ? 'completed' : 'active';
    }

    case 'relationship_le': {
      const rel: Relationship | undefined = character.relationships.get(cond.targetId);
      const val = rel?.[cond.field] ?? 0;
      return val <= cond.value ? 'completed' : 'active';
    }

    case 'location_at':
      return character.locationId === cond.locationId ? 'completed' : 'active';

    case 'faction_joined':
      return character.factionId === cond.factionId ? 'completed' : 'active';

    case 'wanted_le':
      return character.wantedLevel <= cond.value ? 'completed' : 'active';

    case 'custom':
      return checkCustomCondition(cond.check, character, world);

    default:
      return 'active';
  }
}

function checkCustomCondition(
  checkName: string,
  character: Character,
  world: World,
): 'completed' | 'active' {
  switch (checkName) {
    case 'safety_restored':
      return character.drives.safety >= 0.5 ? 'completed' : 'active';
    case 'belonging_restored':
      return character.drives.belonging >= 0.5 ? 'completed' : 'active';
    case 'security_gt_60':
      return world.state.security > 60 ? 'completed' : 'active';
    case 'crime_lt_30':
      return world.state.crimeLevel < 30 ? 'completed' : 'active';
    default:
      return 'active';
  }
}

/**
 * 更新 Goal 进度（0-1）
 */
export function updateGoalProgress(
  goal: Goal,
  character: Character,
  world: World,
): void {
  const cond = goal.condition;
  switch (cond.type) {
    case 'money_ge':
      goal.progress = Math.min(1, character.money / cond.value);
      break;
    case 'item_has': {
      const owned = character.inventory.find((i) => i.itemId === cond.itemId)?.quantity ?? 0;
      goal.progress = Math.min(1, owned / cond.quantity);
      break;
    }
    case 'relationship_le': {
      const rel = character.relationships.get(cond.targetId);
      const val = rel?.[cond.field] ?? 0;
      goal.progress = Math.max(0, Math.min(1, 1 - val / 100));
      break;
    }
    case 'wanted_le':
      goal.progress = Math.max(0, Math.min(1, 1 - character.wantedLevel / 10));
      break;
    default:
      goal.progress = 0.5;
  }
}

/**
 * 渲染 Goal 文本（Phase 5 给 LLM 用）
 */
export function renderGoal(character: Character): string {
  if (!character.currentGoal) return '（暂无目标）';
  const g = character.currentGoal;
  return `"${g.description}"（进度 ${Math.round(g.progress * 100)}%，优先级 ${g.priority.toFixed(1)}）`;
}

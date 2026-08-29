// ============================================================
// 清河县 · 动作执行器（规则引擎唯一能改状态的地方）
// Phase 2：规则引擎
// ============================================================

import {
  Character, World, GameEvent, EventResult, ActionDecision,
  LocationId, FactionId,
} from '../types';
import { checkAction } from './checks';
import { computeSuccessRate, SuccessContext } from './success-rates';
import { getPrice } from './pricing';

/**
 * 执行一个动作：合法性检查 → 成功率 → 分发到具体执行器 → 生成事件
 * 这是规则引擎的入口，engine.ts 调用它
 */
export function execute(
  decision: ActionDecision,
  actor: Character,
  world: World,
): GameEvent {
  const target = decision.targetId
    ? world.characters.get(decision.targetId) ?? null
    : null;

  // 1. 合法性检查
  const check = checkAction(decision.action, actor, target, world);
  if (!check.allowed) {
    return makeEvent(decision, actor, target, world, false, {
      description: check.reason,
    });
  }

  // 2. 计算成功率
  const amount = numParam(decision, 'amount');
  const ctx: SuccessContext = {
    actor, target,
    locationId: actor.locationId,
    world,
    amount,
  };
  const rate = computeSuccessRate(decision.action, ctx);
  const success = Math.random() < rate;

  // 3. 分发到具体执行器
  const executor = EXECUTORS[decision.action];
  if (!executor) {
    return makeEvent(decision, actor, target, world, false, {
      description: `未知动作: ${decision.action}`,
    });
  }

  const result = executor(decision, actor, target, world, success);
  return makeEvent(decision, actor, target, world, success, result);
}

// 从参数里取数值的辅助函数
function numParam(d: ActionDecision, key: string): number {
  const v = d.parameters?.[key];
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

function strParam(d: ActionDecision, key: string, fallback = ''): string {
  const v = d.parameters?.[key];
  return typeof v === 'string' ? v : String(v ?? fallback);
}

// 每个动作的执行逻辑
const EXECUTORS: Record<string, (
  d: ActionDecision,
  actor: Character,
  target: Character | null,
  world: World,
  success: boolean,
) => EventResult> = {

  // ── 给钱 ──
  give_money: (d, actor, target, _world) => {
    const amount = numParam(d, 'amount');
    if (!target || amount <= 0 || actor.money < amount) {
      return { success: false, description: '给钱失败：金额无效或钱不够' };
    }
    return {
      description: `${actor.name}给了${target.name}${amount}两银子`,
      moneyChanges: [
        { characterId: actor.id, amount: -amount },
        { characterId: target.id, amount },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 10, affinity: 15 } },
      ],
    };
  },

  // ── 偷窃 ──
  steal: (d, actor, target, world, success) => {
    const amount = numParam(d, 'amount') || 20;
    if (!target) {
      // 偷地点（如仓库）→ 从该地点的库存偷（简化：从官仓偷）
      const stolen = Math.min(amount, world.state.grainReserve);
      if (!success) {
        return {
          description: `${actor.name}偷窃失败，惊动了守卫`,
          wantedChanges: [{ characterId: actor.id, delta: 1 }],
          worldStateChanges: { security: -1 },
        };
      }
      return {
        description: `${actor.name}从仓库偷了${stolen}两的粮食`,
        wantedChanges: [{ characterId: actor.id, delta: 2 }],
        worldStateChanges: {
          security: -2,
          grainReserve: world.state.grainReserve - stolen,
          crimeLevel: world.state.crimeLevel + 2,
        },
      };
    }

    // 偷角色
    const stolen = Math.min(amount, target.money);
    if (!success) {
      return {
        description: `${actor.name}想偷${target.name}的钱，被发现了`,
        wantedChanges: [{ characterId: actor.id, delta: 1 }],
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -30, affinity: -25, resentment: 40 } },
        ],
        worldStateChanges: {
          crimeLevel: world.state.crimeLevel + 2,
          security: world.state.security - 1,
        },
      };
    }
    return {
      description: `${actor.name}偷走了${target.name}${stolen}两银子`,
      moneyChanges: [
        { characterId: target.id, amount: -stolen },
        { characterId: actor.id, amount: stolen },
      ],
      wantedChanges: [{ characterId: actor.id, delta: 3 }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: -40, affinity: -30, resentment: 50 } },
      ],
      worldStateChanges: {
        crimeLevel: world.state.crimeLevel + 3,
        security: world.state.security - 2,
      },
    };
  },

  // ── 买 ──
  buy: (d, actor, _target, world) => {
    const itemId = strParam(d, 'itemId', 'grain');
    const quantity = numParam(d, 'quantity') || 1;
    const price = getPrice(itemId, world);
    const total = price * quantity;
    if (actor.money < total) {
      return { success: false, description: `${actor.name}钱不够买${itemId}` };
    }
    return {
      description: `${actor.name}买了${quantity}个${itemId}（共${total}两）`,
      moneyChanges: [{ characterId: actor.id, amount: -total }],
      itemChanges: [{ characterId: actor.id, itemId, quantity }],
    };
  },

  // ── 卖 ──
  sell: (d, actor, _target, world) => {
    const itemId = strParam(d, 'itemId', 'grain');
    const quantity = numParam(d, 'quantity') || 1;
    const price = getPrice(itemId, world);
    const owned = actor.inventory.find((i) => i.itemId === itemId)?.quantity ?? 0;
    if (owned < quantity) {
      return { success: false, description: `${actor.name}没有足够的${itemId}` };
    }
    const total = price * quantity;
    return {
      description: `${actor.name}卖了${quantity}个${itemId}（得${total}两）`,
      moneyChanges: [{ characterId: actor.id, amount: total }],
      itemChanges: [{ characterId: actor.id, itemId, quantity: -quantity }],
    };
  },

  // ── 逮捕 ──
  arrest: (d, actor, target, world, success) => {
    if (!target) return { success: false, description: '逮捕目标无效' };
    if (!success) {
      return {
        description: `${actor.name}试图逮捕${target.name}，被对方逃脱`,
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { resentment: 30, fear: 10 } },
        ],
      };
    }
    return {
      description: `${actor.name}逮捕了${target.name}`,
      detentionChanges: [{ characterId: target.id, detained: true }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { resentment: 40, fear: 20 } },
      ],
      worldStateChanges: {
        security: world.state.security + 5,
        crimeLevel: world.state.crimeLevel - 3,
      },
    };
  },

  // ── 释放 ──
  release: (d, actor, target) => {
    if (!target) return { success: false, description: '释放目标无效' };
    return {
      description: `${actor.name}释放了${target.name}`,
      detentionChanges: [{ characterId: target.id, detained: false }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 20 } },
      ],
    };
  },

  // ── 行贿 ──
  bribe: (d, actor, target, _world, success) => {
    const amount = numParam(d, 'amount') || 10;
    if (!target || actor.money < amount) {
      return { success: false, description: '行贿失败：目标无效或钱不够' };
    }
    if (!success) {
      return {
        description: `${actor.name}试图行贿${target.name}，被拒绝`,
        moneyChanges: [{ characterId: actor.id, amount: -amount }],
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -10, respect: -10 } },
        ],
        wantedChanges: [{ characterId: actor.id, delta: 2 }],  // 行贿被拒可能被告发
      };
    }
    const roleName = target.role === '县武装总管' || target.role === '县令'
      ? '对方收下了'
      : '对方动摇了';
    return {
      description: `${actor.name}行贿${target.name}${amount}两，${roleName}`,
      moneyChanges: [
        { characterId: actor.id, amount: -amount },
        { characterId: target.id, amount },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { affinity: 10, respect: -10, loyalty: -5 } },
      ],
    };
  },

  // ── 威胁 ──
  threaten: (d, actor, target, world, success) => {
    const demand = numParam(d, 'amount') || 10;
    if (!target) return { success: false, description: '威胁目标无效' };
    if (!success) {
      return {
        description: `${actor.name}威胁${target.name}，${target.name}不吃这套`,
        relationshipChanges: [
          { fromId: target.id, toId: actor.id, changes: { trust: -20, resentment: 30 } },
        ],
        wantedChanges: [{ characterId: actor.id, delta: 1 }],
      };
    }
    const paid = Math.min(demand, target.money);
    return {
      description: `${actor.name}威胁${target.name}，${target.name}被迫交出${paid}两`,
      moneyChanges: [
        { characterId: target.id, amount: -paid },
        { characterId: actor.id, amount: paid },
      ],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: -30, fear: 40, resentment: 30 } },
      ],
      wantedChanges: [{ characterId: actor.id, delta: 2 }],
      worldStateChanges: {
        crimeLevel: world.state.crimeLevel + 2,
        security: world.state.security - 1,
      },
    };
  },

  // ── 雇佣 ──
  hire: (d, actor, target) => {
    const wage = numParam(d, 'wage') || 10;
    if (!target || actor.money < wage) {
      return { success: false, description: '雇佣失败' };
    }
    return {
      description: `${actor.name}雇佣了${target.name}（日薪${wage}两）`,
      moneyChanges: [{ characterId: actor.id, amount: -wage }],
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { trust: 10, loyalty: 15 } },
      ],
    };
  },

  // ── 举报 ──
  report_crime: (d, actor, target, world) => {
    if (!target) return { success: false, description: '举报目标无效' };
    return {
      description: `${actor.name}举报了${target.name}的罪行`,
      relationshipChanges: [
        { fromId: target.id, toId: actor.id, changes: { resentment: 50, fear: 20 } },
      ],
      worldStateChanges: {
        security: world.state.security + 3,
        crimeLevel: world.state.crimeLevel - 2,
      },
    };
  },

  // ── 加入组织 ──
  join_faction: (d, actor, _target, world) => {
    const factionId = strParam(d, 'factionId', 'faction_guanfu') as FactionId;
    return {
      description: `${actor.name}加入了${world.factions.get(factionId)?.name ?? factionId}`,
      factionChanges: [{ characterId: actor.id, factionId }],
    };
  },

  // ── 离开组织 ──
  leave_faction: (d, actor, _target, world) => {
    const old = actor.factionId;
    return {
      description: `${actor.name}退出了${old ? (world.factions.get(old)?.name ?? old) : '组织'}`,
      factionChanges: [{ characterId: actor.id, factionId: null }],
    };
  },

  // ── 勒索 ──
  demand_money: (d, actor, target, world, success) => {
    return EXECUTORS.threaten(d, actor, target, world, success);
  },

  // ── 移动 ──
  move: (d, actor) => {
    // v2 兼容：plan 中 move 用 targetId 作为目的地；v1 用 parameters.locationId
    const locationId = (strParam(d, 'locationId', d.targetId ?? '') || actor.locationId) as LocationId;
    if (locationId === actor.locationId) {
      return { description: `${actor.name}留在原地` };
    }
    return {
      description: `${actor.name}移动到${locationId}`,
      locationChanges: [{ characterId: actor.id, locationId }],
    };
  },

  // ── 交谈 ──
  talk: (d, actor, target) => {
    const message = strParam(d, 'message');
    return {
      description: message
        ? `${actor.name}对${target?.name ?? '某人'}说：${message.slice(0, 60)}`
        : `${actor.name}想找人聊聊`,
      relationshipChanges: target
        ? [
            { fromId: target.id, toId: actor.id, changes: { affinity: 2 } },
            { fromId: actor.id, toId: target.id, changes: { affinity: 2 } },
          ]
        : undefined,
    };
  },

  // ── 等待/休息（v2 新增）──
  wait: (d, actor) => {
    return { description: `${actor.name}在原地等待休息` };
  },

  // ── 发呆（回退）──
  idle: (d, actor) => {
    return { description: `${actor.name}原地发呆` };
  },
};

/** 生成 GameEvent */
function makeEvent(
  decision: ActionDecision,
  actor: Character,
  target: Character | null,
  world: World,
  success: boolean,
  result: EventResult,
): GameEvent {
  const witnesses = getWitnesses(actor, world);
  return {
    id: `evt_${world.tick}_${actor.id}_${Math.random().toString(36).slice(2, 8)}`,
    tick: world.tick,
    type: decision.action,
    actorId: actor.id,
    targetId: target?.id ?? null,
    locationId: actor.locationId,
    // 执行器显式声明的 success 覆盖随机成功率结果
    success: result.success ?? success,
    result,
    witnesses,
    knownTo: [actor.id, ...witnesses],
    description: result.description ?? `${actor.name}做了动作 ${decision.action}`,
  };
}

function getWitnesses(actor: Character, world: World): string[] {
  return Array.from(world.characters.values())
    .filter((c) => c.id !== actor.id && c.locationId === actor.locationId && c.isAlive)
    .map((c) => c.id);
}

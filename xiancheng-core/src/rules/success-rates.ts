// ============================================================
// 清河县 · 成功率计算
// Phase 2：规则引擎
// ============================================================

import { Character, World, LocationId } from '../types';

export interface SuccessContext {
  actor: Character;
  target: Character | null;
  locationId: LocationId;
  world: World;
  amount?: number;  // 动作金额参数（bribe 等需要）
}

/**
 * 计算一个动作的成功率（0-1）
 * 原则：能力 + 状态 + 环境 + 对方状态 + 随机浮动
 */
export function computeSuccessRate(
  action: string,
  ctx: SuccessContext,
): number {
  const { actor, target, locationId, world } = ctx;
  const rng = () => Math.random() * 0.15;  // 随机浮动 0-0.15

  switch (action) {
    case 'steal': {
      // 偷窃成功率 = 隐蔽能力 * 0.4 + (1 - 目标战斗) * 0.25 + 地点隐蔽性 * 0.2 + 随机
      const locationStealth = STEALTH_BY_LOCATION[locationId] ?? 0.5;
      const targetCombatFactor = target
        ? (1 - target.skills.combat / 10) * 0.25
        : 0.3;
      return clamp(
        (actor.skills.stealth / 10) * 0.4 +
          targetCombatFactor +
          locationStealth * 0.2 +
          rng(),
        0.05, 0.95,
      );
    }

    case 'arrest': {
      // 逮捕成功率 = 权限 + 战力差 + 对方状态
      if (actor.authorityLevel < 5) return 0;
      const authorityBonus = (actor.authorityLevel - 5) * 0.08;
      const combatDiff =
        ((actor.skills.combat - (target?.skills.combat ?? 5)) / 10) * 0.3;
      return clamp(0.5 + authorityBonus + combatDiff + rng(), 0.1, 0.98);
    }

    case 'bribe': {
      // 行贿成功率 = 金额吸引力 + 对方贪婪 - 对方正直
      if (!target) return 0;
      const amount = ctx.amount ?? 10;
      const amountAttract = Math.min(0.3, amount / 100);
      const greedFactor = target.personality.greed * 0.3;
      const honestyPenalty = target.personality.honesty * 0.2;
      return clamp(
        amountAttract + greedFactor - honestyPenalty + rng(),
        0.02, 0.9,
      );
    }

    case 'threaten':
    case 'demand_money': {
      // 威胁/勒索成功率 = 威慑力 + 目标恐惧 - 目标勇气
      if (!target) return 0;
      const intimidate = (actor.skills.intimidation / 10) * 0.35;
      const targetFear =
        ((target.relationships.get(actor.id)?.fear ?? 0) / 100) * 0.35;
      const targetResist = target.personality.riskTolerance * 0.2;
      return clamp(intimidate + targetFear - targetResist + rng(), 0.05, 0.9);
    }

    case 'release': {
      // 释放 = 权限检查
      if (actor.authorityLevel < 5) return 0;
      if (!target?.isDetained) return 0;
      return 1;
    }

    case 'buy':
    case 'sell':
      return 1;  // 买卖总是能发起（价格由定价规则决定）

    case 'give_money':
    case 'report_crime':
    case 'join_faction':
    case 'leave_faction':
    case 'move':
    case 'talk':
    case 'hire':
    case 'idle':
      return 1;  // 这些动作总是能发起（结果由规则/LLM 决定）

    default:
      return 0.5;
  }
}

// 地点的隐蔽性（0-1）
const STEALTH_BY_LOCATION: Record<LocationId, number> = {
  hideout: 0.9,     // 地下据点最隐蔽
  warehouse: 0.7,   // 仓库
  houses: 0.5,      // 民宅
  gate: 0.3,        // 城门（有人把守）
  market: 0.2,      // 街市（人多）
  shop: 0.4,        // 商铺
  yamen: 0.1,       // 县衙（守卫森严）
  main_area: 0.5,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { clamp };

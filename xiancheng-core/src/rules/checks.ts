// ============================================================
// 清河县 · 合法性检查
// Phase 2：规则引擎
// ============================================================

import { Character, World } from '../types';

export interface CheckResult {
  allowed: boolean;
  reason: string;
}

export function checkAction(
  action: string,
  actor: Character,
  target: Character | null,
  world: World,
): CheckResult {
  switch (action) {
    case 'steal':
      if (actor.locationId === 'yamen') {
        return { allowed: false, reason: '县衙守卫森严，不敢下手' };
      }
      if (target && target.id === actor.id) {
        return { allowed: false, reason: '不能偷自己' };
      }
      return { allowed: true, reason: '' };

    case 'arrest':
      if (actor.authorityLevel < 5) {
        return { allowed: false, reason: '你没有执法权' };
      }
      if (target?.factionId === 'faction_guanfu') {
        return { allowed: false, reason: '不能抓官府的人' };
      }
      if (target?.isDetained) {
        return { allowed: false, reason: '他已经在押' };
      }
      return { allowed: true, reason: '' };

    case 'release':
      if (actor.authorityLevel < 5) {
        return { allowed: false, reason: '你没有执法权' };
      }
      return { allowed: true, reason: '' };

    case 'bribe':
      if (actor.money <= 0) {
        return { allowed: false, reason: '你没钱行贿' };
      }
      return { allowed: true, reason: '' };

    case 'demand_money':
      if (target && target.skills.combat > actor.skills.combat + 2) {
        return { allowed: false, reason: '对方比你强，勒索有风险' };
      }
      return { allowed: true, reason: '' };

    case 'join_faction':
      if (actor.factionId) {
        return { allowed: false, reason: '你已经加入组织' };
      }
      return { allowed: true, reason: '' };

    case 'leave_faction':
      if (!actor.factionId) {
        return { allowed: false, reason: '你不在任何组织里' };
      }
      return { allowed: true, reason: '' };

    case 'move':
      return { allowed: true, reason: '' };

    default:
      return { allowed: true, reason: '' };
  }
}
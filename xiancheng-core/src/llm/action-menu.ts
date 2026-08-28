// ============================================================
// 清河县 · 动作菜单构建
// Phase 5：LLM 决策管道
// ============================================================

import { Character, World } from '../types';

/**
 * 生成角色当前可用动作列表（带条件 + 身份提示）
 * 只有"现实允许"的动作才出现在菜单里
 */
export function buildAvailableActions(character: Character, world: World): string[] {
  const items: string[] = [];

  // 移动（到附近地点）
  const LOCATIONS = ['yamen', 'market', 'shop', 'warehouse', 'houses', 'hideout', 'gate'];
  items.push(`move —— 移动到其他地点（可选：${LOCATIONS.join('/')}）`);

  // 交谈（附近有人）
  const nearby = Array.from(world.characters.values())
    .filter((c) => c.id !== character.id && c.locationId === character.locationId && c.isAlive);
  if (nearby.length > 0) {
    items.push(`talk —— 和附近的人交谈（目标：${nearby.map((c) => `${c.name}(${c.id})`).join('、')}）`);
  }

  // 经济类
  items.push(`give_money —— 给别人钱（参数 amount, targetId）`);
  items.push(`buy —— 买东西（参数 itemId, quantity）`);
  items.push(`sell —— 卖东西（参数 itemId, quantity）`);

  // 犯罪类（按身份提示 💡）
  if (character.socialStatus === 'criminal' || character.drives.wealth < 0.4) {
    items.push(`steal —— 偷窃（参数 amount, targetId）💡 符合你的处境`);
    items.push(`demand_money —— 勒索（参数 amount, targetId）`);
  } else {
    items.push(`steal —— 偷窃（参数 amount, targetId）`);
  }
  items.push(`bribe —— 行贿（参数 amount, targetId）`);

  // 执法类（有权限才显示）
  if (character.authorityLevel >= 5) {
    items.push(`arrest —— 逮捕（目标：被通缉或可疑的人）💡 你有执法权`);
    items.push(`release —— 释放（目标：在押的人）`);
    items.push(`report_crime —— 举报犯罪（targetId）`);
  } else {
    items.push(`report_crime —— 举报犯罪（targetId）`);
  }

  // 组织类
  if (!character.factionId) {
    items.push(`join_faction —— 加入组织（参数 factionId）`);
  } else {
    items.push(`leave_faction —— 退出组织`);
  }

  items.push(`hire —— 雇佣别人（参数 wage, targetId）`);
  items.push(`idle —— 原地发呆（什么都不做）`);

  return items;
}

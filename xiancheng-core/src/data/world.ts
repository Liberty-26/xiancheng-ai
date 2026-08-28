// ============================================================
// 清河县 · 初始世界状态
// Phase 1：骨架 + 数据模型
// ============================================================

import { World, WorldState, FactionState, FactionId, KnowledgeStore } from '../types';
import { INITIAL_CHARACTERS, CHARACTER_ORDER } from './characters';

export const INITIAL_WORLD_STATE: WorldState = {
  security: 65,
  publicMorale: 60,
  grainPrice: 100,    // 基准价
  governmentPrestige: 55,
  crimeLevel: 20,
  grainReserve: 500,
};

export const INITIAL_FACTIONS: Map<FactionId, FactionState> = new Map([
  ['faction_guanfu', {
    id: 'faction_guanfu', name: '官府',
    members: ['char_xianling', 'char_butou'],
    wealth: 1000, territory: ['yamen'], prestige: 60, goal: '维持统治',
  }],
  ['faction_shanghui', {
    id: 'faction_shanghui', name: '商行',
    members: [], wealth: 500, territory: ['shop'], prestige: 30, goal: '促进商业',
  }],
  ['faction_heimu', {
    id: 'faction_heimu', name: '黑手帮',
    members: [], wealth: 100, territory: ['hideout'], prestige: 10, goal: '扩张地下势力',
  }],
]);

export function createInitialWorld(): World {
  const characters = new Map<string, typeof INITIAL_CHARACTERS[number]>();
  for (const id of CHARACTER_ORDER) {
    const source = INITIAL_CHARACTERS.find((c) => c.id === id);
    if (!source) continue;
    // 深拷贝角色（Map 里的 relationships 也要拷贝）
    characters.set(id, structuredClone(source));
  }

  return {
    tick: 0,
    time: { day: 1, timeOfDay: 'morning', tick: 0 },
    characters,
    state: { ...INITIAL_WORLD_STATE },
    factions: new Map(
      Array.from(INITIAL_FACTIONS.entries()).map(([k, v]) => [k, structuredClone(v)]),
    ),
    events: [],
    stateDeltas: [],
    knowledge: { knownBy: new Map(), facts: new Map(), rumors: new Map() } as KnowledgeStore,
  };
}

// ============================================================
// 清河县 · 感知系统
// Phase 3：感知 + 信息传播
// ============================================================

import { Character, World, Perception, Fact, RumoredFact } from './types';

export class Perceiver {
  constructor(private world: World) {}

  /**
   * 感知：给定一个角色，返回它"此刻能看到/听到/知道"的一切
   * 原则：只给与角色相关的信息，不给全知
   */
  perceive(character: Character): Perception {
    const locationId = character.locationId;
    const knowledge = this.world.knowledge;

    // 1. 附近的人（同位置的其他活着的角色）
    const nearbyCharacterIds = Array.from(this.world.characters.values())
      .filter((c) => c.id !== character.id && c.locationId === locationId && c.isAlive)
      .map((c) => c.id);

    // 2. 附近的事件（同位置、最近 3 个 tick 内的事件）
    const nearbyEvents = this.world.events
      .filter((e) => e.locationId === locationId && this.world.tick - e.tick <= 3)
      .slice(-5);

    // 3. 已知事实 ID（从知识库）
    const knownFacts = Array.from(knowledge.knownBy.entries())
      .filter(([, knowers]) => knowers.has(character.id))
      .map(([factId]) => factId);

    // 4. 最近听到的谣言
    const recentRumors = (knowledge.rumors.get(character.id) ?? []).slice(-5);

    return {
      locationId,
      nearbyCharacterIds,
      nearbyEvents,
      recentRumors,
      knownFacts,
    };
  }

  /**
   * 生成给 LLM 的感知描述文本（Phase 5 用）
   */
  renderPerceptionText(perception: Perception, world: World): string {
    const locationName = perception.locationId;
    const lines: string[] = [];
    lines.push(`你现在在：${locationName}`);

    if (perception.nearbyCharacterIds.length > 0) {
      const names = perception.nearbyCharacterIds
        .map((id) => world.characters.get(id)?.name ?? id)
        .join('、');
      lines.push(`附近有：${names}`);
    } else {
      lines.push('附近没有其他人。');
    }

    if (perception.nearbyEvents.length > 0) {
      lines.push('你最近在这里看到/听到：');
      for (const e of perception.nearbyEvents) {
        lines.push(`  - ${e.description}`);
      }
    }

    if (perception.knownFacts.length > 0) {
      lines.push('你知道的事情：');
      // 从 facts store 查内容
      for (const facts of world.knowledge.facts.values()) {
        for (const f of facts) {
          if (perception.knownFacts.includes(f.id)) {
            lines.push(`  - ${f.content}`);
          }
        }
      }
    }

    if (perception.recentRumors.length > 0) {
      lines.push('你最近听到的传言：');
      for (const r of perception.recentRumors) {
        lines.push(`  - [可信度${Math.round(r.credibility * 100)}%] ${r.content}`);
      }
    }

    return lines.join('\n');
  }
}

// 类型 re-export（避免未使用告警）
export type { Fact, RumoredFact };

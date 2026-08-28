// ============================================================
// 清河县 · 模拟引擎
// Phase 2：接入规则引擎
// ============================================================

import {
  World, Character, GameEvent, Time, TimeOfDay, Relationship,
} from './types';
import { createInitialWorld } from './data/world';
import { execute as executeAction } from './rules';

export class SimulationEngine {
  world: World;
  private running = false;

  constructor() {
    this.world = createInitialWorld();
  }

  async start() {
    this.running = true;
    console.log('=== 清河县模拟器启动 ===\n');
    while (this.running) {
      await this.tickOnce();
      await this.sleep(500); // 每 tick 暂停 500ms 方便观察
    }
  }

  stop() {
    this.running = false;
  }

  /** 推进一个 tick：每个角色决策 → 执行 → 应用变化 */
  async tickOnce(): Promise<void> {
    this.world.tick += 1;
    this.world.time = advanceTime(this.world.time);

    console.log(
      `--- 第 ${this.world.tick} tick | 第 ${this.world.time.day} 天 ${timeLabel(this.world.time.timeOfDay)} ---`,
    );

    for (const [, character] of this.world.characters) {
      if (character.isDetained || !character.isAlive) {
        console.log(`  [跳过] ${character.name}（${character.isDetained ? '被关押' : '已死亡'}）`);
        continue;
      }

      // Phase 2：用测试决策驱动角色（Phase 5 换成 LLM）
      const decision = makeTestDecision(character);
      if (!decision) continue;

      // 执行动作（规则引擎）
      const event = executeAction(decision, character, this.world);
      this.world.events.push(event);

      // 应用所有状态变化
      this.applyEvent(event);

      // 打印
      const status = event.success ? '✅' : '❌';
      console.log(`  ${status} ${event.description}`);
    }

    this.printWorldState();
    console.log('');
  }

  /** 应用 Event 的所有变化（核心函数，Phase 3+ 会扩展） */
  applyEvent(event: GameEvent): void {
    // 1. 金钱变化
    for (const mc of event.result.moneyChanges ?? []) {
      const c = this.world.characters.get(mc.characterId);
      if (!c) continue;
      const from = c.money;
      c.money = Math.max(0, c.money + mc.amount);
      this.world.stateDeltas.push({
        entityId: mc.characterId, field: 'money', from, to: c.money,
        eventId: event.id, tick: this.world.tick,
      });
    }
    // 2. 物品变化
    for (const ic of event.result.itemChanges ?? []) {
      const c = this.world.characters.get(ic.characterId);
      if (!c) continue;
      const item = c.inventory.find((i) => i.itemId === ic.itemId);
      if (item) {
        item.quantity += ic.quantity;
      } else if (ic.quantity > 0) {
        c.inventory.push({ itemId: ic.itemId, quantity: ic.quantity });
      }
    }
    // 3. 通缉度变化
    for (const wc of event.result.wantedChanges ?? []) {
      const c = this.world.characters.get(wc.characterId);
      if (!c) continue;
      c.wantedLevel = clampNum(c.wantedLevel + wc.delta, 0, 10);
    }
    // 4. 关押变化
    for (const dc of event.result.detentionChanges ?? []) {
      const c = this.world.characters.get(dc.characterId);
      if (!c) continue;
      c.isDetained = dc.detained;
    }
    // 5. 组织变化
    for (const fc of event.result.factionChanges ?? []) {
      const c = this.world.characters.get(fc.characterId);
      if (!c) continue;
      // 从旧组织移除成员
      if (c.factionId) {
        const oldFaction = this.world.factions.get(c.factionId);
        if (oldFaction) {
          oldFaction.members = oldFaction.members.filter((m) => m !== c.id);
        }
      }
      c.factionId = fc.factionId;
      // 加入新组织
      if (fc.factionId) {
        const newFaction = this.world.factions.get(fc.factionId);
        if (newFaction && !newFaction.members.includes(c.id)) {
          newFaction.members.push(c.id);
        }
      }
    }
    // 6. 位置变化
    for (const lc of event.result.locationChanges ?? []) {
      const c = this.world.characters.get(lc.characterId);
      if (!c) continue;
      c.locationId = lc.locationId;
    }
    // 7. 世界状态变化
    if (event.result.worldStateChanges) {
      for (const [k, v] of Object.entries(event.result.worldStateChanges)) {
        const key = k as keyof typeof this.world.state;
        const raw = v as number;
        // grainReserve 是储量（上限 2000），其余公共状态限制 0-100
        if (key === 'grainReserve') {
          this.world.state[key] = clampNum(raw, 0, 2000) as never;
        } else {
          this.world.state[key] = clampNum(raw, 0, 100) as never;
        }
      }
    }
    // 8. 关系变化
    for (const rc of event.result.relationshipChanges ?? []) {
      const from = this.world.characters.get(rc.fromId);
      const to = this.world.characters.get(rc.toId);
      if (!from || !to) continue;
      const rel = from.relationships.get(to.id) ?? emptyRelationship();
      for (const [field, delta] of Object.entries(rc.changes)) {
        const key = field as keyof Relationship;
        rel[key] = clampNum((rel[key] as number) + (delta as number), -100, 100);
      }
      from.relationships.set(to.id, rel);
    }
  }

  private printWorldState() {
    const s = this.world.state;
    console.log(
      `  [世界] 治安:${s.security} 民心:${s.publicMorale} 粮价:${s.grainPrice} 威望:${s.governmentPrestige} 犯罪:${s.crimeLevel} 官仓:${s.grainReserve}`,
    );
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// 工具函数
// ============================================================

function advanceTime(time: Time): Time {
  const sequence: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
  const idx = sequence.indexOf(time.timeOfDay);
  if (idx < sequence.length - 1) {
    return { ...time, timeOfDay: sequence[idx + 1] };
  }
  return { day: time.day + 1, timeOfDay: 'morning', tick: time.tick };
}

function timeLabel(t: TimeOfDay): string {
  const map: Record<TimeOfDay, string> = {
    morning: '早晨 08:00',
    afternoon: '下午 14:00',
    evening: '傍晚 20:00',
    night: '深夜 02:00',
  };
  return map[t] ?? t;
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function emptyRelationship(): Relationship {
  return { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
}

/** Phase 2 的测试决策：简单规则驱动（Phase 5 换成 LLM） */
function makeTestDecision(c: Character): import('./types').ActionDecision | null {
  // 小偷：有机会就偷商人
  if (c.role === '小偷') {
    return {
      action: 'steal',
      targetId: 'char_shangren',
      parameters: { amount: 20 },
    };
  }
  // 商人：偶尔卖点东西
  if (c.role === '商人') {
    return {
      action: 'sell',
      parameters: { itemId: 'cloth', quantity: 1 },
    };
  }
  // 其余：发呆
  return { action: 'idle' };
}

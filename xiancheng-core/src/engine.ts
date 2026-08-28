// ============================================================
// 清河县 · 模拟引擎
// Phase 3：接入感知与信息传播
// ============================================================

import {
  World, Character, GameEvent, Time, TimeOfDay, Relationship, Perception,
} from './types';
import { createInitialWorld } from './data/world';
import { execute as executeAction } from './rules';
import { Knowledge, shareKnowledgeDuringTalk, randomGossip } from './knowledge';
import { Perceiver } from './perceiver';

export class SimulationEngine {
  world: World;
  private running = false;
  private knowledge: Knowledge;
  private perceiver: Perceiver;
  private perceptions = new Map<string, Perception>();

  constructor() {
    this.world = createInitialWorld();
    this.knowledge = new Knowledge();
    this.world.knowledge = this.knowledge.getStore();
    this.perceiver = new Perceiver(this.world);
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

  /** 推进一个 tick：每个角色决策 → 执行 → 应用变化 → 传播 */
  async tickOnce(): Promise<void> {
    this.world.tick += 1;
    this.world.time = advanceTime(this.world.time);

    console.log(
      `--- 第 ${this.world.tick} tick | 第 ${this.world.time.day} 天 ${timeLabel(this.world.time.timeOfDay)} ---`,
    );

    // 收集感知（供决策使用，Phase 5 会用）
    for (const [id, c] of this.world.characters) {
      this.perceptions.set(id, this.perceiver.perceive(c));
    }

    for (const [, character] of this.world.characters) {
      if (character.isDetained || !character.isAlive) {
        console.log(`  [跳过] ${character.name}（${character.isDetained ? '被关押' : '已死亡'}）`);
        continue;
      }

      // Phase 2/3：用测试决策驱动角色（Phase 5 换成 LLM）
      const decision = makeTestDecision(character, this.world);
      if (!decision) continue;

      // 执行动作（规则引擎）
      const event = executeAction(decision, character, this.world);
      this.world.events.push(event);

      // 应用所有状态变化
      this.applyEvent(event);

      // ★ 信息传播：记录事件到知识库（让行为者+目击者知道）
      this.knowledge.recordEvent(event);

      // ★ talk 动作传递知识
      if (decision.action === 'talk' && decision.targetId) {
        const target = this.world.characters.get(decision.targetId);
        if (target) {
          const shared = shareKnowledgeDuringTalk(character.id, target.id, this.world, this.knowledge);
          if (shared.length > 0) {
            console.log(`  [消息] ${character.name} 告诉 ${target.name}：${shared.join('、').slice(0, 60)}`);
          }
        }
      }

      // 打印
      const status = event.success ? '✅' : '❌';
      console.log(`  ${status} ${event.description}`);
    }

    // ★ 随机八卦扩散
    randomGossip(this.world, this.knowledge);

    this.printWorldState();
    this.printKnowledgeStats();
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

  private printKnowledgeStats() {
    const totalFacts = this.world.knowledge.knownBy.size;
    const totalKnowers = Array.from(this.world.knowledge.knownBy.values())
      .reduce((sum, s) => sum + s.size, 0);
    if (totalFacts > 0) {
      console.log(`  [信息] ${totalFacts} 条事实，${totalKnowers} 次"知道"记录`);
    }
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

/** Phase 3 的测试决策：简单规则驱动（Phase 5 换成 LLM） */
function makeTestDecision(c: Character, world: World): import('./types').ActionDecision | null {
  // 小偷：有机会就偷商人（但如果被抓过，先躲一躲）
  if (c.role === '小偷') {
    if (c.wantedLevel > 3 && Math.random() < 0.4) {
      return { action: 'move', parameters: { locationId: 'hideout' } };
    }
    return {
      action: 'steal',
      targetId: 'char_shangren',
      parameters: { amount: 20 },
    };
  }
  // 商人：卖点东西；如果被偷过，去报告
  if (c.role === '商人') {
    const thiefRel = c.relationships.get('char_xiaotou');
    if (thiefRel && thiefRel.resentment > 40 && Math.random() < 0.3) {
      return { action: 'report_crime', targetId: 'char_xiaotou' };
    }
    return {
      action: 'sell',
      parameters: { itemId: 'cloth', quantity: 1 },
    };
  }
  // 市民甲：偶尔把听到的消息告诉别人
  if (c.role === '市民' && c.id === 'char_shimin_jia' && Math.random() < 0.2) {
    return { action: 'talk', targetId: 'char_butou', parameters: { message: '我听说最近有人偷东西' } };
  }
  // 其余：发呆
  return { action: 'idle' };
}

// ============================================================
// 清河县 · 知识存储与信息传播
// Phase 3：感知 + 信息传播
// ============================================================

import {
  KnowledgeStore, Fact, RumoredFact, GameEvent, CharacterId,
  type World,
} from './types';

export class Knowledge {
  private store: KnowledgeStore;

  constructor() {
    this.store = {
      knownBy: new Map(),
      facts: new Map(),
      rumors: new Map(),
    };
  }

  getStore(): KnowledgeStore { return this.store; }

  /**
   * 记录一个事件，并让行为者 + 目击者知道
   */
  recordEvent(event: GameEvent): void {
    const factId = event.id;
    const fact: Fact = {
      id: factId,
      content: event.description,
      category: 'event',
      isTrue: true,           // 事件本身是真实发生的
      createdAt: event.tick,
    };

    // 存储事实（用事件 actor 作为索引即可，findFact 会遍历）
    const factsFor = this.store.facts.get(event.actorId) ?? [];
    factsFor.push(fact);
    this.store.facts.set(event.actorId, factsFor);

    // 让行为者 + 目击者知道
    const knowers = new Set([event.actorId, ...event.witnesses]);
    for (const cid of knowers) {
      this.addKnownFact(cid, factId);
    }
  }

  /**
   * A 把一条消息/事实告诉 B（面对面）
   * @returns 是否成功传播
   */
  shareFact(fromId: CharacterId, toId: CharacterId, factId: string, tick: number): boolean {
    const fact = this.findFact(factId);
    if (!fact) return false;

    this.addKnownFact(toId, factId);

    // 记录一条"已知道的信息"给 B（带来源）
    const rumor: RumoredFact = {
      factId,
      content: fact.content,
      credibility: fact.isTrue ? 1 : 0.3,
      sourceId: fromId,
      tick,
    };
    const rumorsFor = this.store.rumors.get(toId) ?? [];
    rumorsFor.push(rumor);
    this.store.rumors.set(toId, rumorsFor);
    return true;
  }

  /**
   * 传播一条谣言（二道传播，可信度递减）
   */
  spreadRumor(fromId: CharacterId, toId: CharacterId, rumor: RumoredFact): void {
    const decayed: RumoredFact = {
      ...rumor,
      credibility: rumor.credibility * 0.8,   // 每传一手可信度打 8 折
      sourceId: fromId,
    };
    const rumorsFor = this.store.rumors.get(toId) ?? [];
    rumorsFor.push(decayed);
    this.store.rumors.set(toId, rumorsFor);
  }

  /** 某个角色知道哪些事实 ID */
  getKnownFactIds(characterId: string): string[] {
    // knownBy 以 factId 为 key → Set<characterId>，这里遍历找出该角色知道的所有事实
    const result: string[] = [];
    for (const [factId, knowers] of this.store.knownBy) {
      if (knowers.has(characterId)) {
        result.push(factId);
      }
    }
    return result;
  }

  /** 某个角色知道哪些事实内容 */
  getKnownFacts(characterId: string): Fact[] {
    const ids = this.getKnownFactIds(characterId);
    return ids
      .map((id) => this.findFact(id))
      .filter((f): f is Fact => !!f);
  }

  /** 某个角色最近听到的谣言 */
  getRumorsFor(characterId: string): RumoredFact[] {
    return this.store.rumors.get(characterId) ?? [];
  }

  /** 某条事实有多少人知道 */
  getFactSpread(factId: string): number {
    return this.store.knownBy.get(factId)?.size ?? 0;
  }

  /** 某条事实是否被某人知道 */
  knows(characterId: string, factId: string): boolean {
    return this.store.knownBy.get(factId)?.has(characterId) ?? false;
  }

  private addKnownFact(characterId: string, factId: string): void {
    const known = this.store.knownBy.get(factId) ?? new Set();
    known.add(characterId);
    this.store.knownBy.set(factId, known);
  }

  private findFact(factId: string): Fact | null {
    for (const facts of this.store.facts.values()) {
      const f = facts.find((item) => item.id === factId);
      if (f) return f;
    }
    return null;
  }
}

// ============================================================
// 传播规则
// ============================================================

/**
 * talk 动作时的知识传递：A 告诉 B 一条最近知道的重大事实
 * @returns 传递了哪些事实内容
 */
export function shareKnowledgeDuringTalk(
  fromId: CharacterId,
  toId: CharacterId,
  world: World,
  knowledge: Knowledge,
): string[] {
  const knownFacts = knowledge.getKnownFacts(fromId);
  if (knownFacts.length === 0) return [];

  // 按新鲜度排序，挑最近的一条
  const sorted = [...knownFacts].sort((a, b) => b.createdAt - a.createdAt);
  const shared = sorted.slice(0, 1);
  for (const fact of shared) {
    knowledge.shareFact(fromId, toId, fact.id, world.tick);
  }
  return shared.map((f) => f.content);
}

/**
 * 公共地点的事件 → 同位置所有人都算目击者（由 executors 的 witnesses 处理）
 * 这里处理：公共事件在下一 tick 仍然会被同位置的"后来者"感知到
 */
export function publicSpread(event: GameEvent, world: World): void {
  const PUBLIC_LOCATIONS = ['market', 'gate', 'main_area'];
  if (!PUBLIC_LOCATIONS.includes(event.locationId)) return;
  // 事件已经记录到 knowledge，同位置角色在 perceive 时会看到 nearbyEvents
  void world;
}

/**
 * 随机八卦：每 tick 有概率让一个知道消息的人告诉同位置的另一个人
 */
export function randomGossip(world: World, knowledge: Knowledge, gossipChance = 0.1): void {
  if (Math.random() > gossipChance) return;

  const characters = Array.from(world.characters.values()).filter((c) => c.isAlive);
  if (characters.length < 2) return;

  const from = characters[Math.floor(Math.random() * characters.length)];
  const knownIds = knowledge.getKnownFactIds(from.id);
  if (knownIds.length === 0) return;

  const factId = knownIds[Math.floor(Math.random() * knownIds.length)];
  const fact = knowledge.getKnownFacts(from.id).find((f) => f.id === factId);
  if (!fact) return;

  const neighbors = characters.filter(
    (c) => c.id !== from.id && c.locationId === from.locationId && c.isAlive,
  );
  if (neighbors.length === 0) return;

  const to = neighbors[Math.floor(Math.random() * neighbors.length)];
  knowledge.spreadRumor(from.id, to.id, {
    factId,
    content: fact.content,
    credibility: 0.9,
    sourceId: from.id,
    tick: world.tick,
  });
}

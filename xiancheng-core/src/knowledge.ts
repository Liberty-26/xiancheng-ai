// ============================================================
// 清河县 · 知识存储与信息传播
// Phase 3：感知 + 信息传播
// ============================================================

import {
  KnowledgeStore, Fact, RumoredFact, GameEvent, CharacterId,
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
    return Array.from(this.store.knownBy.get(characterId) ?? []);
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

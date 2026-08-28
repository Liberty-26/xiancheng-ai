// ============================================================
// 清河县 · 记忆系统
// Phase 5：LLM 决策管道（记忆反馈回路的核心）
// ============================================================

import { Memory, GameEvent, Character, World } from './types';

export class MemorySystem {
  private memories: Map<string, Memory[]> = new Map();  // characterId → memories

  constructor() {}

  /** 事件 → 记忆（行为者 + 目标 + 目击者都记录） */
  recordEvent(event: GameEvent, world: World): void {
    const recipients = new Set<string>([event.actorId]);
    if (event.targetId) recipients.add(event.targetId);

    for (const cid of recipients) {
      const importance = this.computeImportance(event);
      this.addMemory({
        id: `mem_${event.id}_${cid}`,
        characterId: cid,
        tick: event.tick,
        text: event.description,
        type: 'event',
        importance,
        credibility: 1,  // 亲身经历 = 100% 可信
        relatedCharacterIds: [event.actorId, ...(event.targetId ? [event.targetId] : [])],
        tags: [event.type, event.locationId],
      });
    }

    // 目击者记录（可信度稍低）
    for (const witnessId of event.witnesses) {
      if (recipients.has(witnessId)) continue;
      this.addMemory({
        id: `mem_${event.id}_${witnessId}`,
        characterId: witnessId,
        tick: event.tick,
        text: `我亲眼看到：${event.description}`,
        type: 'event',
        importance: this.computeImportance(event) * 0.8,
        credibility: 0.9,
        relatedCharacterIds: [event.actorId, ...(event.targetId ? [event.targetId] : [])],
        tags: [event.type, event.locationId],
      });
    }
  }

  /** 关系变化 → 记忆 */
  recordRelationshipChange(
    characterId: string,
    otherId: string,
    change: { field: string; value: number },
    tick: number,
  ): void {
    const fieldNames: Record<string, string> = {
      trust: '信任', affinity: '好感', fear: '恐惧',
      respect: '尊敬', loyalty: '忠诚', resentment: '怨恨',
    };
    const dir = change.value > 0 ? '上升了' : '下降了';
    const abs = Math.abs(change.value);
    this.addMemory({
      id: `mem_rel_${characterId}_${otherId}_${tick}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      tick,
      text: `我对${otherId}的${fieldNames[change.field] ?? change.field}${dir}（${abs}）`,
      type: 'relationship',
      importance: Math.min(0.9, abs / 100),
      credibility: 1,
      relatedCharacterIds: [otherId],
      tags: ['relationship'],
    });
  }

  /** 被传递的信息 → 记忆（可信度取决于来源） */
  recordRumor(characterId: string, rumor: { content: string; credibility: number; sourceId: string }, tick: number): void {
    this.addMemory({
      id: `mem_rumor_${characterId}_${tick}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      tick,
      text: `我听说：${rumor.content}`,
      type: 'info',
      importance: 0.4,
      credibility: rumor.credibility,
      relatedCharacterIds: rumor.sourceId ? [rumor.sourceId] : [],
      tags: ['rumor', 'info'],
    });
  }

  /** 检索：按相关性 + 重要性 + 新鲜度 */
  retrieve(characterId: string, _query: string, world: World, limit = 8): Memory[] {
    const all = this.memories.get(characterId) ?? [];
    const now = world.tick;

    return all
      .filter((m) => now - m.tick < 100)   // 100 tick 内的记忆
      .map((m) => ({
        ...m,
        _score: m.importance * 0.5 + this.freshness(m, now) * 0.3 + (m.credibility * 0.2),
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit) as Memory[];
  }

  /** 把记忆渲染成文本（给 LLM） */
  renderMemories(memories: Memory[]): string {
    if (memories.length === 0) return '（暂无近期记忆）';
    return memories.map((m) => {
      const cred = m.credibility < 1 ? `（可信度${Math.round(m.credibility * 100)}%）` : '';
      const time = `[tick ${m.tick}]`;
      return `- ${time} ${m.text}${cred}`;
    }).join('\n');
  }

  private freshness(m: Memory, now: number): number {
    return Math.max(0, 1 - (now - m.tick) / 100);
  }

  private computeImportance(event: GameEvent): number {
    const IMPORTANCE: Record<string, number> = {
      steal: 0.7, arrest: 0.8, release: 0.6, bribe: 0.7, threaten: 0.7,
      demand_money: 0.7, report_crime: 0.6, hire: 0.5, give_money: 0.5,
      buy: 0.3, sell: 0.3, move: 0.2, talk: 0.3, idle: 0.1,
      join_faction: 0.6, leave_faction: 0.5,
    };
    return IMPORTANCE[event.type] ?? 0.4;
  }

  private addMemory(m: Memory): void {
    const list = this.memories.get(m.characterId) ?? [];
    list.push(m);
    // 限制每个角色最多 100 条记忆
    if (list.length > 100) list.shift();
    this.memories.set(m.characterId, list);
  }
}
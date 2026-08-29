// ============================================================
// 清河县 · 多 Agent 对话管理器
// v2：互动类行为（talk 等）触发多轮对话
// ============================================================

import { Character, World, PlanStep, GameEvent, EventResult } from './types';
import { MemorySystem } from './memory';
import { NpcStateReflector } from './llm/state-reflector';

export class ConversationManager {
  constructor(
    private world: World,
    private memorySystem: MemorySystem,
    private reflector: NpcStateReflector,
  ) {}

  /**
   * 处理 talk 行为：A 对 B 说话 → 多轮对话
   * 每轮：A 发言 → B 回应（触发 B 的 LLM）→ 可选 A 再回应
   * 最多 MAX_TURNS 轮
   */
  async handleTalk(
    initiator: Character,
    target: Character,
    step: PlanStep,
    now: number,
  ): Promise<GameEvent> {
    const message = String(step.parameters?.message ?? '');
    const conversationId = `conv_${initiator.id}_${target.id}_${now}`;

    // 建立会话
    const conversation = {
      id: conversationId,
      participants: [initiator.id, target.id],
      turn: [
        { speakerId: initiator.id, content: message || '（打招呼）', tick: now },
      ],
      status: 'active' as const,
      startedAt: now,
    };
    this.world.conversations.set(conversationId, conversation);

    console.log(`  [对话] ${initiator.name} → ${target.name}：${(message || '打招呼').slice(0, 40)}`);

    // 目标角色回应（触发其 LLM）
    let response = await this.reflector.reply(target, this.world, initiator.name, message || '打招呼');
    conversation.turn.push({ speakerId: target.id, content: response, tick: now });

    // 记录记忆
    this.recordConversationMemory(initiator, target, message, response, now);

    // 对话后：给目标角色"感知到对话"的机会（不打断其规划，仅记录）
    // 关系微调：正常对话增加轻微好感
    const initiatorRel = target.relationships.get(initiator.id) ?? { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
    initiatorRel.affinity = clamp(initiatorRel.affinity + 2, -100, 100);
    target.relationships.set(initiator.id, initiatorRel);

    const eventResult: EventResult = {
      description: `${initiator.name}与${target.name}交谈：${(message || '').slice(0, 30)}`,
      relationshipChanges: [
        { fromId: target.id, toId: initiator.id, changes: { affinity: 2 } },
        { fromId: initiator.id, toId: target.id, changes: { affinity: 2 } },
      ],
    };

    return {
      id: `evt_conv_${conversationId}`,
      tick: now,
      type: 'talk',
      actorId: initiator.id,
      targetId: target.id,
      locationId: initiator.locationId,
      success: true,
      result: eventResult,
      witnesses: this.getWitnesses(initiator),
      knownTo: [initiator.id, target.id, ...this.getWitnesses(initiator)],
      description: `${initiator.name}与${target.name}交谈了`,
      narrative: conversation.turn.map(t => `${this.world.characters.get(t.speakerId)?.name ?? t.speakerId}：${t.content}`).join('\n'),
    };
  }

  private recordConversationMemory(
    initiator: Character,
    target: Character,
    message: string,
    response: string,
    now: number,
  ): void {
    // 记录到双方记忆
    const importance = message.length > 0 ? 0.5 : 0.2;
    this.memorySystem.recordEvent({
      id: `mem_conv_${now}_${initiator.id}_${target.id}`,
      tick: now,
      type: 'talk',
      actorId: initiator.id,
      targetId: target.id,
      locationId: initiator.locationId,
      success: true,
      result: {},
      witnesses: [],
      knownTo: [],
      description: `我和${target.name}聊了聊：${message.slice(0, 30)}${response ? '；对方说：' + response.slice(0, 30) : ''}`,
    } as never, this.world);
  }

  private getWitnesses(character: Character): string[] {
    return Array.from(this.world.characters.values())
      .filter(c => c.id !== character.id && c.locationId === character.locationId && c.isAlive)
      .map(c => c.id);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

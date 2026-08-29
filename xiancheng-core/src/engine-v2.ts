// ============================================================
// 清河县 · 状态驱动引擎 v2
// NPC 完成行动 → 代码验证条件 → 触发 LLM 反思 → 新状态
// 时间按行动耗时自然流动（事件队列，非 tick）
// ============================================================

import {
  World, Character, NpcState, PlanStep, Condition, GameEvent, Conversation,
  travelTime, findPath,
} from './types';
import { createInitialWorld } from './data/world';
import { execute as executeAction } from './rules';
import { Knowledge, shareKnowledgeDuringTalk, randomGossip } from './knowledge';
import { Perceiver } from './perceiver';
import { applyDriveChanges, decayDrives } from './drive';
import { MemorySystem } from './memory';
import { LLMClient } from './llm/client';
import { NpcStateReflector } from './llm/state-reflector';
import { ConversationManager } from './conversation';
import { applyRelationshipWitnessEffects, applyRelationshipCouplings } from './relationship';

export class SimulationEngineV2 {
  world: World;
  private running = false;
  readonly knowledge: Knowledge;
  readonly perceiver: Perceiver;
  readonly memorySystem: MemorySystem;
  private reflector: NpcStateReflector;
  private conversations: ConversationManager;
  private llm: LLMClient;

  constructor(options?: { useLlm?: boolean }) {
    this.world = createInitialWorld();
    this.knowledge = new Knowledge();
    this.world.knowledge = this.knowledge.getStore();
    this.perceiver = new Perceiver(this.world);
    this.memorySystem = new MemorySystem();
    this.llm = new LLMClient();
    const useLlm = options?.useLlm ?? this.llm.isConfigured;
    this.reflector = new NpcStateReflector(this.llm, this.memorySystem, useLlm);
    this.conversations = new ConversationManager(this.world, this.memorySystem, this.reflector);
  }

  get usesLlm(): boolean { return this.reflector.usesLlm; }

  async start() {
    this.running = true;
    console.log('=== 清河县模拟器 v2（状态驱动）===');
    console.log(`=== 决策模式: ${this.usesLlm ? 'LLM（' + (process.env.SIMULATION_MODEL ?? '') + '）' : '测试模式'} ===\n`);

    // 初始化：所有 NPC 先生成初始状态
    for (const [, c] of this.world.characters) {
      if (!c.isAlive || c.isDetained) continue;
      if (!c.npcState) {
        await this.reflector.generateInitialState(c, this.world);
      }
    }

    while (this.running) {
      await this.advanceOneAction();
    }
  }

  stop() { this.running = false; }

  /** 玩家执行一个动作（公开，供 API 调用） */
  async executeStepForPlayer(step: PlanStep): Promise<GameEvent> {
    const player = this.world.characters.get('char_player');
    if (!player) throw new Error('玩家角色不存在');
    return this.executeStep(player, step);
  }

  /** 玩家动作的事件后处理（公开，供 API 调用） */
  postEventProcessingForPlayer(character: Character, event: GameEvent): void {
    this.postEventProcessing(character, event);
  }

  /**
   * 推进一个行动（事件队列模式）：
   * 1. 所有 NPC 若有规划未执行完，按 finishAt 排序
   * 2. 执行最早完成的行动
   * 3. 推进世界时间
   * 4. 行动后检查条件 → 决定是否触发 LLM 反思
   */
  async advanceOneAction(): Promise<GameEvent | null> {
    // 确保每个 NPC 都有状态
    for (const [, c] of this.world.characters) {
      if (!c.isAlive || c.isDetained) continue;
      if (!c.npcState) {
        await this.reflector.generateInitialState(c, this.world);
      }
    }

    // 当前时刻
    const now = this.world.clock.now;

    // 为没有调度中的 NPC 生成下一步调度
    const scheduledIds = new Set(this.world.clock.scheduled.map(s => s.characterId));
    for (const [, c] of this.world.characters) {
      if (!c.isAlive || c.isDetained) continue;
      if (!c.npcState || scheduledIds.has(c.id)) continue;
      // 调度该 NPC 当前步骤
      const state = c.npcState;
      if (state.currentStepIndex >= state.plan.length) {
        // 规划执行完 → 触发反思（生成新状态）
        await this.reflectAndReset(c);
        continue;
      }
      const step = state.plan[state.currentStepIndex];
      // 计算实际耗时：move 按速度+距离，其他按 LLM 给的时间
      const duration = this.computeStepDuration(c, step);
      this.world.clock.scheduled.push({
        characterId: c.id,
        step,
        finishAt: now + duration,
      });
      scheduledIds.add(c.id);
    }

    if (this.world.clock.scheduled.length === 0) {
      // 没有可执行的行动 → 时间流逝一小段（所有人都在等待反思）
      this.world.clock.now += 5;
      return null;
    }

    // 找到最早完成的行动
    this.world.clock.scheduled.sort((a, b) => a.finishAt - b.finishAt);
    const next = this.world.clock.scheduled.shift()!;
    this.world.clock.now = next.finishAt;

    const character = this.world.characters.get(next.characterId);
    if (!character || !character.isAlive || character.isDetained) {
      // 角色不可用，丢弃该行动
      return null;
    }

    const event = await this.executeStep(character, next.step);
    this.world.events.push(event);
    this.applyEvent(event);
    this.postEventProcessing(character, event);

    // 推进该 NPC 到下一步
    const state = character.npcState;
    if (state) {
      state.currentStepIndex += 1;
      this.printStep(character, next.step, event);

      // 关键节点：检查条件
      const check = this.checkConditions(character, state);
      if (check === 'success' || check === 'fail') {
        await this.reflectAndReset(character, check);
      } else if (state.currentStepIndex >= state.plan.length) {
        // 规划执行完 → 反思
        await this.reflectAndReset(character);
      }
      // 否则继续执行下一步（下次 advanceOneAction 会重新调度）
    }

    return event;
  }

  /** 计算行动的实际耗时（分钟）：
   *  - move：按速度 + 地图距离（统一 WALK_SPEED）
   *  - 其他：用 LLM 给的 duration（兜底 5 分钟）
   */
  private computeStepDuration(character: Character, step: PlanStep): number {
    if (step.action === 'move') {
      const toId = step.targetId ?? (step.parameters?.locationId as string) ?? '';
      if (!toId) return 5;
      return travelTime(character.locationId, toId);
    }
    return Math.max(1, step.duration || 5);
  }

  /** 执行一个行动（代码层） */
  private async executeStep(character: Character, step: PlanStep): Promise<GameEvent> {
    // 处理需要移动的交互（talk/bribe/threaten 等目标在别处时先走过去）
    if (step.targetId && step.action !== 'move') {
      const target = this.world.characters.get(step.targetId);
      if (target && target.locationId !== character.locationId) {
        const path = findPath(character.locationId, target.locationId);
        if (path && path.length > 1) {
          // 走到目标位置（用 move 事件记录）
          const moveEvent = executeAction({
            action: 'move',
            parameters: { locationId: target.locationId },
          }, character, this.world);
          if (moveEvent.result.locationChanges) {
            this.world.events.push(moveEvent);
            this.applyEvent(moveEvent);
            this.postEventProcessing(character, moveEvent);
          }
        }
      }
    }

    // 对话类行动 → 交给对话管理器（多 agent）
    // 若 LLM 没指定 targetId，自动找同位置最近的人
    if (step.action === 'talk') {
      let target = step.targetId ? this.world.characters.get(step.targetId) : null;
      if (!target || !target.isAlive) {
        target = this.findNearbyCharacter(character);
      }
      if (target && target.isAlive && target.id !== character.id) {
        return this.conversations.handleTalk(character, target, step, this.world.clock.now);
      }
    }

    // 普通行动 → 规则引擎
    return executeAction({
      action: step.action,
      targetId: step.targetId,
      parameters: step.parameters,
    }, character, this.world);
  }

  /** 找同位置最近的活人（talk 没指定目标时用） */
  private findNearbyCharacter(character: Character): Character | null {
    let closest: { id: string; dist: number } | null = null;
    for (const [, c] of this.world.characters) {
      if (c.id === character.id || !c.isAlive || c.isDetained) continue;
      if (c.locationId !== character.locationId) continue;
      const dx = Math.abs(c.locationId.charCodeAt(0) - character.locationId.charCodeAt(0));
      const dy = Math.abs(c.locationId.length - character.locationId.length);
      const dist = dx + dy;
      if (!closest || dist < closest.dist) {
        closest = { id: c.id, dist };
      }
    }
    return closest ? this.world.characters.get(closest.id) ?? null : null;
  }

  /** 事件后处理（Drive/关系/记忆/知识/八卦） */
  private postEventProcessing(character: Character, event: GameEvent): void {
    applyDriveChanges(character, event);
    if (event.targetId && event.targetId !== character.id) {
      const target = this.world.characters.get(event.targetId);
      if (target) applyDriveChanges(target, event);
    }
    const relChanges = applyRelationshipWitnessEffects(event, this.world);
    for (const rc of event.result.relationshipChanges ?? []) {
      for (const [field, val] of Object.entries(rc.changes)) {
        if (Math.abs(val as number) >= 10) {
          this.memorySystem.recordRelationshipChange(rc.fromId, rc.toId, { field, value: val as number }, this.world.clock.now);
        }
      }
    }
    for (const rc of relChanges ?? []) {
      for (const [field, val] of Object.entries(rc.changes)) {
        if (Math.abs(val as number) >= 10) {
          this.memorySystem.recordRelationshipChange(rc.fromId, rc.toId, { field, value: val as number }, this.world.clock.now);
        }
      }
    }
    this.memorySystem.recordEvent(event, this.world);
    this.knowledge.recordEvent(event);

    for (const [, c] of this.world.characters) {
      applyRelationshipCouplings(c);
    }
    randomGossip(this.world, this.knowledge);
  }

  /** 条件验证（代码解释器） */
  checkConditions(character: Character, state: NpcState): 'success' | 'fail' | 'none' {
    if (this.checkCondition(state.successCondition, character)) return 'success';
    if (state.failureCondition && this.checkCondition(state.failureCondition, character)) return 'fail';
    return 'none';
  }

  private checkCondition(cond: Condition, character: Character): boolean {
    switch (cond.type) {
      case 'money_ge':
        return character.money >= cond.value;
      case 'item_has': {
        const owned = character.inventory.find(i => i.itemId === cond.itemId)?.quantity ?? 0;
        return owned >= (cond.quantity ?? 1);
      }
      case 'relationship_le': {
        const rel = character.relationships.get(cond.targetId);
        return (rel?.[cond.field as keyof typeof rel] ?? 0) <= cond.value;
      }
      case 'location_at':
        return character.locationId === cond.locationId;
      case 'talk_success': {
        // 简单判定：对方对你的信任上升了（由对话后关系变化体现）
        const rel = character.relationships.get(cond.targetId);
        return (rel?.trust ?? 0) > 0;
      }
      case 'talk_refused': {
        const rel = character.relationships.get(cond.targetId);
        // 对方信任很低 → 视为被拒绝累计
        return (rel?.trust ?? 0) < -20 * (cond.times ?? 1);
      }
      case 'time_elapsed':
        return this.world.clock.now - (character.npcState?.createdAt ?? 0) >= cond.minutes;
      case 'custom':
        return this.checkCustom(cond.check, character);
      default:
        return false;
    }
  }

  private checkCustom(check: string, character: Character): boolean {
    switch (check) {
      case 'safety_restored': return character.drives.safety >= 0.5;
      case 'belonging_restored': return character.drives.belonging >= 0.5;
      default: return false;
    }
  }

  /** 各 NPC 上次反思的世界时间（防抖用） */
  private lastReflectAt = new Map<string, number>();
  /** 最小反思间隔（世界分钟）：避免同一 NPC 短时间内重复反思 */
  private readonly MIN_REFLECT_INTERVAL = 90;

  /** 反思：触发 LLM 生成新状态（带防抖：同一 NPC 最短间隔内不重复反思） */
  private async reflectAndReset(character: Character, result?: 'success' | 'fail') {
    // 防抖：距离上次反思不足最小间隔 → 跳过（保留旧状态，稍后再反思）
    const lastAt = this.lastReflectAt.get(character.id) ?? 0;
    if (this.world.clock.now - lastAt < this.MIN_REFLECT_INTERVAL) {
      // 如果规划已走完但没有新状态，给一个等待步骤避免卡死
      if (character.npcState && character.npcState.currentStepIndex >= character.npcState.plan.length) {
        character.npcState.plan.push({ action: 'wait', duration: this.MIN_REFLECT_INTERVAL - (this.world.clock.now - lastAt) });
      }
      return;
    }

    const oldState = character.npcState;
    const newState = await this.reflector.reflect(character, this.world, oldState, result);
    character.npcState = newState;
    this.lastReflectAt.set(character.id, this.world.clock.now);
    if (oldState) {
      console.log(`  [反思] ${character.name}：${result === 'success' ? '目标达成' : result === 'fail' ? '目标受挫' : '规划完成'} → 新目标：${newState.goal.slice(0, 30)}`);
    }
  }

  /** 应用事件（复用 v1 逻辑） */
  applyEvent(event: GameEvent): void {
    // 金钱
    for (const mc of event.result.moneyChanges ?? []) {
      const c = this.world.characters.get(mc.characterId);
      if (!c) continue;
      const from = c.money;
      c.money = Math.max(0, c.money + mc.amount);
      this.world.stateDeltas.push({ entityId: mc.characterId, field: 'money', from, to: c.money, eventId: event.id, tick: this.world.clock.now });
    }
    // 物品
    for (const ic of event.result.itemChanges ?? []) {
      const c = this.world.characters.get(ic.characterId);
      if (!c) continue;
      const item = c.inventory.find(i => i.itemId === ic.itemId);
      if (item) item.quantity += ic.quantity;
      else if (ic.quantity > 0) c.inventory.push({ itemId: ic.itemId, quantity: ic.quantity });
    }
    // 通缉
    for (const wc of event.result.wantedChanges ?? []) {
      const c = this.world.characters.get(wc.characterId);
      if (!c) continue;
      c.wantedLevel = clamp(c.wantedLevel + wc.delta, 0, 10);
    }
    // 关押
    for (const dc of event.result.detentionChanges ?? []) {
      const c = this.world.characters.get(dc.characterId);
      if (!c) continue;
      c.isDetained = dc.detained;
    }
    // 组织
    for (const fc of event.result.factionChanges ?? []) {
      const c = this.world.characters.get(fc.characterId);
      if (!c) continue;
      if (c.factionId) {
        const old = this.world.factions.get(c.factionId);
        if (old) old.members = old.members.filter(m => m !== c.id);
      }
      c.factionId = fc.factionId;
      if (fc.factionId) {
        const nf = this.world.factions.get(fc.factionId);
        if (nf && !nf.members.includes(c.id)) nf.members.push(c.id);
      }
    }
    // 位置
    for (const lc of event.result.locationChanges ?? []) {
      const c = this.world.characters.get(lc.characterId);
      if (!c) continue;
      c.locationId = lc.locationId;
    }
    // 世界状态
    if (event.result.worldStateChanges) {
      for (const [k, v] of Object.entries(event.result.worldStateChanges)) {
        const key = k as keyof typeof this.world.state;
        const raw = v as number;
        this.world.state[key] = (key === 'grainReserve' ? clamp(raw, 0, 2000) : clamp(raw, 0, 100)) as never;
      }
    }
    // 关系
    for (const rc of event.result.relationshipChanges ?? []) {
      const from = this.world.characters.get(rc.fromId);
      const to = this.world.characters.get(rc.toId);
      if (!from || !to) continue;
      const rel = from.relationships.get(to.id) ?? { trust: 0, affinity: 0, fear: 0, respect: 0, loyalty: 0, resentment: 0 };
      for (const [field, delta] of Object.entries(rc.changes)) {
        const key = field as keyof typeof rel;
        rel[key] = clamp((rel[key] as number) + (delta as number), -100, 100);
      }
      from.relationships.set(to.id, rel);
    }
  }

  /** 打印行动执行 */
  private printStep(character: Character, step: PlanStep, event: GameEvent): void {
    const status = event.success ? '✅' : '❌';
    console.log(`  [${this.formatClock(this.world.clock.now)}] ${status} ${event.description}`);
  }

  formatClock(now: number): string {
    const day = Math.floor(now / 1440) + 1;
    const hour = Math.floor((now % 1440) / 60);
    const min = now % 60;
    return `第${day}天 ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  get worldState() { return this.world.state; }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// 临时：keep Conversation type referenced
export type { Conversation };

// ============================================================
// 清河县 · 决策主逻辑（结构化输出 + 校验 + 重试）
// Phase 5：LLM 决策管道
// ============================================================

import { Character, World, Perception, ActionDecision } from '../types';
import { LLMClient } from './client';
import { buildSystemPrompt, buildUserContent } from './prompt-builder';
import { buildAvailableActions } from './action-menu';
import { ACTION_DECISION_SCHEMA, ZodActionDecision, AVAILABLE_ACTIONS } from './schemas';
import { MemorySystem } from '../memory';
import { Perceiver } from '../perceiver';

export class DecisionMaker {
  private llm: LLMClient;
  private memorySystem: MemorySystem;
  private systemPrompts = new Map<string, string>();  // 缓存系统提示词
  private consecutiveFailures = 0;
  private readonly FAILURE_CIRCUIT_BREAK = 3;   // 连续失败 3 次熔断
  private circuitOpen = false;

  constructor(llm: LLMClient, memorySystem: MemorySystem) {
    this.llm = llm;
    this.memorySystem = memorySystem;
  }

  /** 熔断状态：true = 暂时停用 LLM（自动降级到测试决策） */
  get isCircuitOpen(): boolean { return this.circuitOpen; }

  /** 重置熔断（外部调用，比如确认 API 恢复后） */
  resetCircuit(): void {
    this.circuitOpen = false;
    this.consecutiveFailures = 0;
  }

  /** 让角色做一次决策（含校验 + 重试 + 熔断降级） */
  async decide(character: Character, world: World, perception: Perception): Promise<ActionDecision> {
    // 熔断已打开 → 直接返回 null（调用方会用测试决策回退）
    if (this.circuitOpen || !this.llm.isConfigured) {
      return { action: 'idle', reason: '（LLM 不可用，降级模式）' };
    }
    // L1：系统提示词（缓存）
    let systemPrompt = this.systemPrompts.get(character.id);
    if (!systemPrompt) {
      systemPrompt = buildSystemPrompt(character);
      this.systemPrompts.set(character.id, systemPrompt);
    }

    // L3：检索记忆
    const memories = this.memorySystem.retrieve(character.id, '', world, 8);

    // L2：动作菜单
    const availableActions = buildAvailableActions(character, world);

    // L2：拼装状态快照
    const userContent = buildUserContent({
      character, world, perception, memories, availableActions,
    });

    // 调用 LLM（最多重试 2 次）
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await this.llm.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          { jsonSchema: ACTION_DECISION_SCHEMA, temperature: 0.7 },
        );

        // 解析 JSON
        const parsed = this.parseJson(raw);
        const decision = this.validateDecision(parsed);
        // 成功后复位失败计数
        this.consecutiveFailures = 0;
        return decision;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`  [重试${attempt + 1}] ${character.name} 决策校验失败: ${lastError.slice(0, 80)}`);
        // 账户余额不足等持久性错误 → 直接熔断，不再重试
        if (isPermanentApiError(lastError)) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= this.FAILURE_CIRCUIT_BREAK) {
            this.circuitOpen = true;
            console.warn('  [熔断] LLM 连续失败，切换到降级模式（测试决策）');
          }
          break;
        }
      }
    }

    // 全部失败 → 回退 idle
    return {
      action: 'idle',
      reason: '我一时不知该怎么办',
      innerMonologue: `（内心：${lastError.slice(0, 50)}）`,
    };
  }

  private parseJson(raw: string): unknown {
    // 兼容 LLM 输出可能带 ```json 代码块
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    // 提取第一个 { 到最后一个 }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('无 JSON 对象');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  private validateDecision(raw: unknown): ActionDecision {
    const parsed = ZodActionDecision.parse(raw);

    // 额外校验：action 必须在基础枚举里
    if (!AVAILABLE_ACTIONS.includes(parsed.action as never)) {
      throw new Error(`非法 action: ${parsed.action}`);
    }

    return {
      action: parsed.action,
      targetId: parsed.targetId,
      parameters: parsed.parameters,
      reason: parsed.reason,
      innerMonologue: parsed.innerMonologue,
    };
  }
}

/** 判断是否为持久性 API 错误（余额不足/认证失败等，重试无意义） */
function isPermanentApiError(message: string): boolean {
  return (
    message.includes('balance is insufficient') ||
    message.includes('402') ||
    message.includes('InvalidApiKey') ||
    message.includes('401') ||
    message.includes('account balance')
  );
}

/** 便利函数：完整决策流程（供 engine 调用） */
export async function makeDecision(
  character: Character,
  world: World,
  llm: LLMClient,
  memorySystem: MemorySystem,
  perceiver: Perceiver,
): Promise<ActionDecision> {
  const dm = new DecisionMaker(llm, memorySystem);
  const perception = perceiver.perceive(character);
  return dm.decide(character, world, perception);
}

// ============================================================
// 清河县 · Goal 管理
// Phase 4：Drive + Goal 系统
// ============================================================

import { Character, World, Goal } from './types';
import { generateGoalTemplate, checkGoalCompletion, updateGoalProgress, renderGoal } from './goal';
import { getDriveBaseline } from './drive';
import { LlmGoalGenerator } from './llm/goal-generator';

export class GoalManager {
  // 记录每个角色上次评估的 tick（避免每 tick 都评估）
  private lastEvaluated = new Map<string, number>();
  private readonly EVAL_INTERVAL = 5;        // 每 5 tick 评估一次
  private readonly DRIVE_CHANGE_THRESHOLD = 0.15;  // 或 drive 变化超过 0.15
  private llmWarned = false;

  constructor(
    private world: World,
    private llmGenerator?: LlmGoalGenerator,
  ) {}

  /** 每 tick 调用：检查完成 + 决定是否重评估 */
  tick(): void {
    for (const [, character] of this.world.characters) {
      if (!character.isAlive || character.isDetained) continue;
      this.checkAndUpdateGoal(character);
      void this.maybeReevaluate(character);
    }
  }

  /** 检查当前 Goal 是否完成/失败 */
  private checkAndUpdateGoal(character: Character): void {
    if (!character.currentGoal) return;

    // 更新进度
    updateGoalProgress(character.currentGoal, character, this.world);

    // 检查完成
    const status = checkGoalCompletion(character.currentGoal, character, this.world);
    if (status === 'completed') {
      console.log(`  [目标达成] ${character.name}：${character.currentGoal.description}`);
      // 标记完成 + 奖励 Drives（满足感）
      character.currentGoal.status = 'completed';
      character.drives.wealth = Math.min(1, character.drives.wealth + 0.1);
      character.drives.belonging = Math.min(1, character.drives.belonging + 0.1);
      character.currentGoal = null;  // 清空，下次会生成新目标
      this.lastEvaluated.set(character.id, this.world.tick);
    } else if (status === 'failed') {
      character.currentGoal.status = 'failed';
      character.currentGoal = null;
      this.lastEvaluated.set(character.id, this.world.tick);
    }
  }

  /** 决定是否重新评估（生成新 Goal） */
  private async maybeReevaluate(character: Character): Promise<void> {
    // 没有目标 → 生成一个
    if (!character.currentGoal) {
      await this.generateNewGoal(character);
      return;
    }

    // 间隔到了 → 重新评估
    const lastEval = this.lastEvaluated.get(character.id) ?? 0;
    if (this.world.tick - lastEval < this.EVAL_INTERVAL) return;

    // Drive 相对基线变化过大 → 重新评估
    const baseline = getDriveBaseline(character);
    const driveDrift = (Object.keys(character.drives) as (keyof typeof character.drives)[]).some(
      (key) => Math.abs(character.drives[key] - baseline[key]) > this.DRIVE_CHANGE_THRESHOLD,
    );
    if (!driveDrift) return;

    await this.generateNewGoal(character);
  }

  /** 生成新 Goal（Phase 4：模板；Phase 5：LLM） */
  private async generateNewGoal(character: Character): Promise<void> {
    let newGoal: Goal | null = null;

    // 优先用 LLM 生成（带轻量降级：LLM 失败时用模板）
    if (this.llmGenerator) {
      try {
        newGoal = await this.llmGenerator.generate(character, this.world);
      } catch (e) {
        // 静默降级到模板（日志只在第一次失败时输出）
        if (!this.llmWarned) {
          console.warn(`  [LLM目标生成不可用] ${character.name}: ${e}`);
          this.llmWarned = true;
        }
      }
    }
    // LLM 未配置或失败 → 模板兜底
    if (!newGoal) {
      newGoal = generateGoalTemplate(character, this.world);
    }
    if (!newGoal) return;
    newGoal.createdAt = this.world.tick;

    if (character.currentGoal) {
      character.currentGoal.status = 'abandoned';
      console.log(`  [目标放弃] ${character.name}：${character.currentGoal.description}`);
    }

    character.currentGoal = newGoal;
    this.lastEvaluated.set(character.id, this.world.tick);
    console.log(`  [新目标] ${character.name}：${newGoal.description}（优先级 ${newGoal.priority.toFixed(1)}）`);
  }

  /** 供决策层读取：把 Goal 渲染成文本（Phase 5 用） */
  renderGoalText(character: Character): string {
    return renderGoal(character);
  }
}

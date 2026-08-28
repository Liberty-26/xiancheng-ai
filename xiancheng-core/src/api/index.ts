// ============================================================
// 清河县 · Express API
// Phase 7：API + 前端
// ============================================================

import express from 'express';
import { SimulationEngine } from '../engine';
import { ActionDecision, Character, GameEvent, Relationship } from '../types';
import { execute as executeAction } from '../rules';
import { applyDriveChanges } from '../drive';
import { applyRelationshipWitnessEffects, applyRelationshipCouplings } from '../relationship';

export function createApi(engine: SimulationEngine): express.Express {
  const app = express();
  app.use(express.json());

  // ── 健康检查 ──
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', tick: engine.world.tick });
  });

  // ── 世界状态 ──
  app.get('/api/state', (_req, res) => {
    res.json({
      tick: engine.world.tick,
      time: engine.world.time,
      state: engine.world.state,
      factions: Array.from(engine.world.factions.values()),
      decisionMode: engine.usesLlm ? 'llm' : 'test',
    });
  });

  // ── 角色列表 ──
  app.get('/api/characters', (_req, res) => {
    const chars = Array.from(engine.world.characters.values()).map(serializeCharacter);
    res.json(chars);
  });

  // ── 单角色详情 ──
  app.get('/api/characters/:id', (req, res) => {
    const c = engine.world.characters.get(req.params.id);
    if (!c) return res.status(404).json({ error: '角色不存在' });
    const relations: Record<string, Relationship> = {};
    for (const [targetId, rel] of c.relationships) {
      relations[targetId] = rel;
    }
    res.json({
      ...serializeCharacter(c),
      relationships: relations,
      memories: engine.memorySystem.retrieve(c.id, '', engine.world, 20),
    });
  });

  // ── 事件流 ──
  app.get('/api/events', (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const events = engine.world.events.slice(-limit);
    res.json(events.map(serializeEvent));
  });

  // ── 玩家执行动作 ──
  app.post('/api/action', (req, res) => {
    const body = req.body as ActionDecision;
    const player = engine.world.characters.get('char_player');
    if (!player) return res.status(400).json({ error: '玩家角色不存在' });

    // 玩家也感知（不参与 LLM，直接执行规则）
    const event = executeAction(body, player, engine.world);
    engine.applyEvent(event);
    engine.world.events.push(event);

    // 应用完整副作用（Drive/关系/记忆/知识）
    applyDriveChanges(player, event);
    if (event.targetId && event.targetId !== player.id) {
      const target = engine.world.characters.get(event.targetId);
      if (target) applyDriveChanges(target, event);
    }
    applyRelationshipWitnessEffects(event, engine.world);
    for (const [, c] of engine.world.characters) applyRelationshipCouplings(c);
    engine.memorySystem.recordEvent(event, engine.world);
    engine.knowledge.recordEvent(event);

    res.json({
      event: serializeEvent(event),
      player: serializeCharacter(player),
      state: engine.world.state,
    });
  });

  // ── 控制 ──
  app.post('/api/control/tick', async (_req, res) => {
    await engine.tickOnce();
    res.json({ ok: true, tick: engine.world.tick });
  });

  app.post('/api/control/start', (_req, res) => {
    engine.start();
    res.json({ ok: true });
  });

  app.post('/api/control/stop', (_req, res) => {
    engine.stop();
    res.json({ ok: true });
  });

  return app;
}

// ── 序列化辅助 ──

export function serializeCharacter(c: Character) {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    factionId: c.factionId,
    socialStatus: c.socialStatus,
    authorityLevel: c.authorityLevel,
    wantedLevel: c.wantedLevel,
    locationId: c.locationId,
    isDetained: c.isDetained,
    isAlive: c.isAlive,
    money: c.money,
    inventory: c.inventory,
    drives: c.drives,
    personality: c.personality,
    skills: c.skills,
    reputation: c.reputation,
    currentGoal: c.currentGoal,
  };
}

function serializeEvent(e: GameEvent) {
  return {
    id: e.id,
    tick: e.tick,
    type: e.type,
    actorId: e.actorId,
    targetId: e.targetId,
    locationId: e.locationId,
    success: e.success,
    description: e.description,
    witnesses: e.witnesses,
  };
}

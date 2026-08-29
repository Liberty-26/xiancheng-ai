// ============================================================
// 清河县 · v2 状态驱动引擎 — Express 服务器入口
// 提供 API + 前端静态服务（显示 NPC 状态/目标/规划）
// ============================================================

import { SimulationEngineV2 } from './engine-v2';
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Character, NpcState } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engine = new SimulationEngineV2({ useLlm: true });
const app = express();
app.use(express.json());

// ── API ──

// 世界状态
app.get('/api/state', (_req, res) => {
  res.json({
    clock: engine.world.clock.now,
    timeLabel: engine.formatClock(engine.world.clock.now),
    state: engine.world.state,
    decisionMode: engine.usesLlm ? 'llm' : 'test',
  });
});

// 角色列表（含 v2 状态：目标+规划+条件）
app.get('/api/characters', (_req, res) => {
  const chars = Array.from(engine.world.characters.values()).map((c) => serializeCharacter(c));
  res.json(chars);
});

// 单角色详情（含关系+记忆）
app.get('/api/characters/:id', (req, res) => {
  const c = engine.world.characters.get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  const relations: Record<string, unknown> = {};
  for (const [tid, rel] of c.relationships) relations[tid] = rel;
  res.json({
    ...serializeCharacter(c),
    relationships: relations,
    memories: engine.memorySystem.retrieve(c.id, '', engine.world, 20),
  });
});

// 事件流
app.get('/api/events', (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(engine.world.events.slice(-limit).map((e) => ({
    id: e.id,
    tick: e.tick,
    type: e.type,
    actorId: e.actorId,
    targetId: e.targetId,
    locationId: e.locationId,
    success: e.success,
    description: e.description,
  })));
});

// 玩家动作
app.post('/api/action', (req, res) => {
  const body = req.body;
  const player = engine.world.characters.get('char_player');
  if (!player) return res.status(400).json({ error: '玩家角色不存在' });
  // 玩家直接执行一个动作（作为其下一步）
  const step = {
    action: body.action,
    targetId: body.targetId,
    parameters: body.parameters,
    duration: 5,
  };
  engine.executeStepForPlayer(step).then((event) => {
    engine.applyEvent(event);
    if (!event.description.includes('交谈')) {
      engine.world.events.push(event);
      engine.postEventProcessingForPlayer(player, event);
    }
    res.json({
      event: { description: event.description, success: event.success },
      player: serializeCharacter(player),
    });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

// 控制
app.post('/api/control/tick', async (_req, res) => {
  await engine.advanceOneAction();
  res.json({ ok: true, clock: engine.world.clock.now });
});
app.post('/api/control/start', (_req, res) => {
  void engine.start();
  res.json({ ok: true });
});
app.post('/api/control/stop', (_req, res) => {
  engine.stop();
  res.json({ ok: true });
});

// 前端静态
app.use(express.static(join(__dirname, '..', 'client')));
const server = createServer(app);
const PORT = process.env.PORT ?? 3300;
server.listen(PORT, () => {
  console.log(`\n🖥️  清河县 v2 · AI 社会模拟器`);
  console.log(`──────────────────────────────────`);
  console.log(`  模拟地址: http://localhost:${PORT}`);
  console.log(`  决策模式: ${engine.usesLlm ? 'LLM (' + (process.env.SIMULATION_MODEL ?? '') + ')' : '测试'}`);
  console.log(`──────────────────────────────────\n`);
});

process.on('SIGINT', () => { engine.stop(); process.exit(0); });

// ── 序列化 ──
function serializeCharacter(c: Character) {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    locationId: c.locationId,
    money: c.money,
    wantedLevel: c.wantedLevel,
    isDetained: c.isDetained,
    drives: c.drives,
    goal: c.npcState?.goal ?? '(思考中…)',
    plan: c.npcState?.plan ?? [],
    successCondition: c.npcState?.successCondition ?? null,
    currentStepIndex: c.npcState?.currentStepIndex ?? -1,
    currentGoal: c.currentGoal,
  };
}
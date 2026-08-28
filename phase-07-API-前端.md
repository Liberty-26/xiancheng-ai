# Phase 7：API + 前端可视化

> 目标：能通过浏览器看到县城状态，玩家能操作
>
> 预计时间：4-6 小时
>
> 前置依赖：Phase 1-6 全部完成

---

## 7.1 创建的所有文件

```
xiancheng-core/
├── src/api/
│   └── index.ts          # Express 服务器
├── client/
│   ├── index.html        # 前端主页面
│   ├── style.css         # 样式
│   └── app.js            # 前端逻辑
└── package.json          # 增加 express 依赖
```

---

## 7.2 后端 API 设计

```
GET  /api/health          → { status: 'ok' }
GET  /api/state           → 世界状态（治安/民心/粮价/威望/犯罪/时间）
GET  /api/characters      → 所有角色（含 drives/goals/关系/位置/财产）
GET  /api/characters/:id  → 单个角色详情（含完整关系矩阵）
GET  /api/events          → 最近事件流
POST /api/action          → 玩家执行动作 { action, targetId, parameters }
GET  /api/timeline        → 时间线摘要
POST /api/control/tick    → 手动推进一个 tick（调试用）
POST /api/control/start   → 开始自动运行
POST /api/control/stop    → 停止自动运行
```

---

## 7.3 src/api/index.ts —— Express 服务器

```typescript
import express from 'express';
import cors from 'cors';
import { SimulationEngine } from '../engine';
import { ActionDecision } from '../types';
import { execute as executeAction } from '../rules';
import { applyEvent } from '../engine';   // 需要导出 applyEvent

export function createApi(engine: SimulationEngine): express.Express {
  const app = express();
  app.use(cors());
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
    res.json({
      ...serializeCharacter(c),
      relationships: serializeRelationships(c),
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

    // 合法性检查
    const event = executeAction(body, player, engine.world);
    engine.applyEventToWorld(event);   // 应用变化
    engine.world.events.push(event);

    res.json({
      event: serializeEvent(event),
      player: serializeCharacter(player),
      state: engine.world.state,
    });
  });

  // ── 控制 ──
  app.post('/api/control/tick', async (_req, res) => {
    await engine.tickOnce();   // engine 需要提供 tickOnce
    res.json({ ok: true, tick: engine.world.tick });
  });

  app.post('/api/control/start', (_req, res) => {
    engine.start();  // 需要支持外部启动
    res.json({ ok: true });
  });

  app.post('/api/control/stop', (_req, res) => {
    engine.stop();
    res.json({ ok: true });
  });

  return app;
}

// ── 序列化辅助 ──

function serializeCharacter(c: any) {
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

function serializeRelationships(c: any) {
  const out: Record<string, any> = {};
  for (const [targetId, rel] of c.relationships) {
    out[targetId] = rel;
  }
  return out;
}

function serializeEvent(e: any) {
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
```

---

## 7.4 修改 engine.ts —— 提供 tickOnce + 序列化

```typescript
// engine.ts 需要新增：
export class SimulationEngine {
  // ... 现有 ...

  /** 供 API 调用：手动推进一个 tick */
  async tickOnce(): Promise<void> {
    await this.tick();
  }

  /** 供 API 调用：应用事件（外部玩家动作） */
  applyEventToWorld(event: GameEvent): void {
    this.applyEvent(event);
    // 也触发 Drive/关系/记忆/传播
    const actor = this.world.characters.get(event.actorId);
    if (actor) applyDriveChanges(actor, event, this.world);
    applyRelationshipChanges(event, this.world);
    for (const c of this.world.characters.values()) applyRelationshipCouplings(c);
    this.memorySystem.recordEvent(event, this.world);
    this.knowledge.recordEvent(event);
  }
}
```

---

## 7.5 启动入口（index.ts 改造）

```typescript
import { SimulationEngine } from './engine';
import { createApi } from './api';
import { createServer } from 'http';
import express from 'express';

const engine = new SimulationEngine();
const app = createApi(engine);

// 服务前端静态文件
const clientDir = new URL('../client/', import.meta.url).pathname;
app.use(express.static(clientDir));

const server = createServer(app);
const PORT = process.env.PORT ?? 3200;
server.listen(PORT, () => {
  console.log(`清河县服务器运行在 http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/state`);
});

process.on('SIGINT', () => {
  engine.stop();
  process.exit(0);
});
```

---

## 7.6 client/index.html —— 前端

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>清河县 · AI 社会模拟器</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>🏯 清河县</h1>
    <div id="time-display"></div>
    <div class="controls">
      <button id="btn-tick">▶ 推进一 tick</button>
      <button id="btn-start">⏵ 自动运行</button>
      <button id="btn-stop">⏸ 停止</button>
      <button id="btn-refresh">🔄 刷新</button>
    </div>
  </header>

  <main>
    <!-- 世界状态栏 -->
    <section id="world-state" class="panel">
      <h2>世界状态</h2>
      <div id="world-metrics" class="metrics"></div>
    </section>

    <!-- 角色网格 -->
    <section id="characters" class="panel">
      <h2>角色</h2>
      <div id="character-grid"></div>
    </section>

    <!-- 事件流 -->
    <section id="events" class="panel">
      <h2>事件流</h2>
      <div id="event-list"></div>
    </section>
  </main>

  <!-- 角色详情弹窗 -->
  <div id="char-modal" class="modal" hidden>
    <div class="modal-content">
      <span id="modal-close" class="close">&times;</span>
      <div id="modal-body"></div>
    </div>
  </div>

  <!-- 玩家操作面板 -->
  <div id="player-panel" class="player-panel" hidden>
    <h3>🧍 玩家操作</h3>
    <div id="player-info"></div>
    <div id="player-actions"></div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

---

## 7.7 client/style.css —— 样式

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #1a1d2a;
  color: #e8e8e8;
  min-height: 100vh;
}
header {
  display: flex; align-items: center; gap: 20px;
  padding: 16px 24px;
  background: #252a3d;
  border-bottom: 2px solid #3a4060;
}
header h1 { font-size: 22px; color: #ffd166; }
header button {
  padding: 8px 16px; border: none; border-radius: 6px;
  background: #4a5fae; color: white; cursor: pointer; font-size: 14px;
}
header button:hover { background: #5a6fc0; }
main {
  display: grid;
  grid-template-columns: 300px 1fr;
  grid-template-rows: auto 1fr;
  gap: 16px;
  padding: 16px 24px;
}
.panel {
  background: #232838;
  border-radius: 10px;
  padding: 16px;
  border: 1px solid #333a55;
}
.panel h2 { font-size: 16px; color: #8aa2ff; margin-bottom: 12px; }
.metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.metric { background: #2a3048; padding: 10px; border-radius: 8px; text-align: center; }
.metric .label { font-size: 12px; color: #8892b0; }
.metric .value { font-size: 20px; font-weight: bold; color: #ffd166; }
#character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.char-card {
  background: #2a3048;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid #39405f;
  transition: all 0.2s;
}
.char-card:hover { border-color: #8aa2ff; transform: translateY(-2px); }
.char-card .name { font-weight: bold; font-size: 16px; }
.char-card .role { color: #8892b0; font-size: 13px; }
.char-card .drive-bar { margin-top: 8px; }
.drive-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 12px; }
.drive-row .bar-bg { flex: 1; height: 8px; background: #1a1d2a; border-radius: 4px; overflow: hidden; }
.drive-row .bar-fill { height: 100%; border-radius: 4px; }
.drive-row .tag { width: 36px; color: #8892b0; }
.wanted { color: #ff6b6b; font-weight: bold; }
#events { grid-column: 1 / -1; max-height: 300px; overflow-y: auto; }
#event-list { display: flex; flex-direction: column; gap: 4px; }
.event-item { padding: 6px 10px; background: #2a3048; border-radius: 6px; font-size: 13px; }
.event-item.success { border-left: 3px solid #2ecc71; }
.event-item.fail { border-left: 3px solid #ff6b6b; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal-content { background: #232838; padding: 24px; border-radius: 12px; width: 500px; max-height: 80vh; overflow-y: auto; }
.close { float: right; cursor: pointer; font-size: 24px; }
.player-panel {
  position: fixed; right: 16px; bottom: 16px;
  width: 320px; background: #232838; border-radius: 12px;
  padding: 16px; border: 1px solid #4a5fae;
}
.player-panel h3 { color: #ffd166; margin-bottom: 10px; }
.player-actions button { display: block; width: 100%; margin: 4px 0; padding: 6px; border-radius: 6px; border: 1px solid #4a5fae; background: #2a3048; color: #e8e8e8; cursor: pointer; }

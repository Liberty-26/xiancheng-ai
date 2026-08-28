// ============================================================
// 清河县 · 入口（API + 模拟引擎）
// Phase 7：API + 前端
// ============================================================

import { SimulationEngine } from './engine';
import { createApi } from './api';
import { createServer } from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const engine = new SimulationEngine({ useLlm: true });
const app = createApi(engine);

// 服务前端静态文件
const clientDir = join(__dirname, '..', 'client');
app.use(express.static(clientDir));

const server = createServer(app);
const PORT = process.env.PORT ?? 3200;

server.listen(PORT, () => {
  console.log(`\n🖥️  清河县 · AI 社会模拟器`);
  console.log(`──────────────────────────────────`);
  console.log(`  模拟地址: http://localhost:${PORT}`);
  console.log(`  API 接口: http://localhost:${PORT}/api/state`);
  console.log(`  决策模式: ${engine.usesLlm ? 'LLM (' + (process.env.SIMULATION_MODEL ?? '') + ')' : '测试决策'}`);
  console.log(`──────────────────────────────────\n`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n停止服务');
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  engine.stop();
  process.exit(0);
});
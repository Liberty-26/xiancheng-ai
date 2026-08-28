// ============================================================
// 清河县 · 前端逻辑
// Phase 7：API + 前端
// ============================================================

const API = '';
let autoRun = false;
let autoTimer = null;

// ── DOM ──
const $ = (sel) => document.querySelector(sel);
const timeDisplay = $('#time-display');
const worldMetrics = $('#world-metrics');
const characterGrid = $('#character-grid');
const eventList = $('#event-list');
const decisionMode = $('#decision-mode');
const charModal = $('#char-modal');
const modalBody = $('#modal-body');
const playerPanel = $('#player-panel');
const playerInfo = $('#player-info');
const playerActions = $('#player-actions');

const btnTick = $('#btn-tick');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnRefresh = $('#btn-refresh');
const modalClose = $('#modal-close');

// ── 工具 ──
async function apiGet(path, options) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...(options || {}),
  });
  return res.json();
}

const DRIVE_COLORS = {
  safety: '#2ecc71', wealth: '#f1c40f', power: '#e74c3c',
  belonging: '#8aa2ff', revenge: '#ff6b6b',
};
const DRIVE_NAMES = {
  safety: '安全', wealth: '财富', power: '权力',
  belonging: '归属', revenge: '复仇',
};

// ── 渲染 ──
async function refresh() {
  try {
    const [state, characters, events] = await Promise.all([
      apiGet('/api/state'),
      apiGet('/api/characters'),
      apiGet('/api/events?limit=50'),
    ]);

    // 时间
    const timeMap = {
      morning: '早晨 08:00', afternoon: '下午 14:00',
      evening: '傍晚 20:00', night: '深夜 02:00',
    };
    timeDisplay.textContent = `第 ${state.time.day} 天 · ${timeMap[state.time.timeOfDay] || state.time.timeOfDay} · tick ${state.tick}`;

    // 决策模式
    decisionMode.textContent = state.decisionMode === 'llm' ? 'LLM 驱动' : '测试决策';
    decisionMode.className = 'badge' + (state.decisionMode === 'llm' ? '' : ' test');

    // 世界状态
    const s = state.state;
    worldMetrics.innerHTML = `
      <div class="metric"><div class="label">治安</div><div class="value">${s.security}</div></div>
      <div class="metric"><div class="label">民心</div><div class="value">${s.publicMorale}</div></div>
      <div class="metric"><div class="label">粮价</div><div class="value">${s.grainPrice}</div></div>
      <div class="metric"><div class="label">官府威望</div><div class="value">${s.governmentPrestige}</div></div>
      <div class="metric"><div class="label">犯罪程度</div><div class="value">${s.crimeLevel}</div></div>
      <div class="metric"><div class="label">官仓</div><div class="value">${s.grainReserve}</div></div>
    `;

    // 角色卡片
    characterGrid.innerHTML = '';
    for (const c of characters) {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.dataset.id = c.id;
      card.innerHTML = `
        <div class="name">${c.name} ${c.isDetained ? '🔒' : ''}</div>
        <div class="role">${c.role} · ${c.locationId}</div>
        <div class="goal">🎯 ${c.currentGoal ? c.currentGoal.description.slice(0, 18) : '无目标'}</div>
        ${c.wantedLevel > 0 ? `<div class="wanted">⚠️ 通缉 ${c.wantedLevel}</div>` : ''}
        <div class="drive">
          ${Object.entries(c.drives).map(([k, v]) => `
            <div class="drive-row">
              <span class="tag">${DRIVE_NAMES[k] || k}</span>
              <div class="bar-bg"><div class="bar-fill" style="width:${Math.round((v) * 100)}%;background:${DRIVE_COLORS[k] || '#888'}"></div></div>
            </div>`).join('')}
        </div>
      `;
      card.onclick = () => openCharModal(c.id);
      characterGrid.appendChild(card);
    }

    // 事件流（最新在顶部）
    eventList.innerHTML = '';
    for (const e of [...events].reverse()) {
      const item = document.createElement('div');
      item.className = 'event-item ' + (e.success ? 'success' : 'fail');
      item.innerHTML = `<span class="tick">[t${e.tick}]</span>${e.description}`;
      eventList.appendChild(item);
    }

    // 玩家面板
    const player = characters.find((c) => c.id === 'char_player');
    if (player) {
      playerPanel.hidden = false;
      renderPlayerPanel(player);
    }
  } catch (err) {
    console.error('刷新失败:', err);
  }
}

// ── 角色详情弹窗 ──
async function openCharModal(id) {
  const c = await apiGet('/api/characters/' + id);
  if (!c || c.error) return;

  const relations = Object.entries(c.relationships || {})
    .map(([tid, rel]) => {
      const parts = [
        rel.trust !== 0 ? `信任${rel.trust}` : null,
        rel.affinity !== 0 ? `好感${rel.affinity}` : null,
        rel.fear > 0 ? `恐惧${rel.fear}` : null,
        rel.resentment > 0 ? `怨恨${rel.resentment}` : null,
        rel.loyalty > 0 ? `忠诚${rel.loyalty}` : null,
      ].filter(Boolean).join('，');
      return `<div>• ${tid}：${parts || '中性'}</div>`;
    }).join('');

  const memories = (c.memories || []).map((m) =>
    `<div class="mem-item">[t${m.tick}] ${m.text}</div>`).join('');

  modalBody.innerHTML = `
    <h2>${c.name}（${c.role}）</h2>
    <p style="color:#8892b0">位置：${c.locationId} | 银两：${c.money} | 通缉：${c.wantedLevel} | ${c.isDetained ? '被关押' : '自由'}</p>
    <p style="color:#ffd166;margin-top:8px">🎯 ${c.currentGoal ? c.currentGoal.description : '无目标'}</p>
    <h3 style="margin-top:12px;color:#8aa2ff">驱动力</h3>
    ${Object.entries(c.drives).map(([k, v]) =>
      `<div class="drive-row"><span class="tag">${DRIVE_NAMES[k] || k}</span>
       <div class="bar-bg"><div class="bar-fill" style="width:${Math.round((v) * 100)}%;background:${DRIVE_COLORS[k] || '#888'}"></div></div>
       <span>${(v).toFixed(2)}</span></div>`).join('')}
    <h3 style="margin-top:12px;color:#8aa2ff">人际关系</h3>
    <div style="font-size:13px">${relations || '（无）'}</div>
    <div class="memories">
      <h3 style="color:#8aa2ff">最近记忆</h3>
      ${memories || '<div class="mem-item">（无记忆）</div>'}
    </div>
  `;
  charModal.hidden = false;
}

// ── 玩家操作面板 ──
function renderPlayerPanel(player) {
  playerInfo.innerHTML = `
    <div style="font-size:13px">
      💰 ${player.money}两 | 📍 ${player.locationId} | 
      ${player.wantedLevel > 0 ? `⚠️通缉${player.wantedLevel}` : ''}
    </div>
  `;
  const actions = [
    { label: '给钱', action: 'give_money', param: 'amount', val: '20' },
    { label: '偷窃', action: 'steal', param: 'amount', val: '20' },
    { label: '威胁', action: 'threaten', param: 'amount', val: '10' },
    { label: '行贿', action: 'bribe', param: 'amount', val: '10' },
    { label: '买粮', action: 'buy', param: 'itemId', val: 'grain' },
    { label: '举报', action: 'report_crime', param: 'target', val: '' },
    { label: '发呆', action: 'idle', param: '', val: '' },
  ];
  playerActions.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.onclick = async () => {
      const targets = await apiGet('/api/characters');
      const nonPlayer = targets.filter((c) => c.id !== 'char_player' && !c.isDetained);
      if (nonPlayer.length === 0) { alert('没有可交互的角色'); return; }
      // 简化为选第一个非玩家角色（完整版应弹选择器）
      const targetId = prompt(`选择目标角色（默认 ${nonPlayer[0].name}）:\n${nonPlayer.map((c) => c.id + '=' + c.name).join('\n')}`) || nonPlayer[0].id;
      const parameters = {};
      if (a.param) parameters[a.param] = a.val;
      const res = await apiGet('/api/action', {
        method: 'POST',
        body: JSON.stringify({ action: a.action, targetId, parameters }),
      });
      console.log('动作结果:', res);
      refresh();
    };
    playerActions.appendChild(btn);
  }
}

// ── 控制 ──
btnTick.onclick = async () => { await apiGet('/api/control/tick', { method: 'POST' }); refresh(); };
btnStart.onclick = () => {
  autoRun = true;
  btnTick.disabled = true;
  btnStart.disabled = true;
  btnStop.disabled = false;
  runAutoTicks();
};
btnStop.onclick = () => {
  autoRun = false;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  btnTick.disabled = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
};
btnRefresh.onclick = refresh;
modalClose.onclick = () => { charModal.hidden = true; };

async function runAutoTicks() {
  if (!autoRun) return;
  try {
    await apiGet('/api/control/tick', { method: 'POST' });
    await refresh();
  } catch (err) {
    console.error('自动运行出错:', err);
    autoRun = false;
  }
  if (autoRun) autoTimer = window.setTimeout(runAutoTicks, 1200);
}

// 点击弹窗外关闭
charModal.addEventListener('click', (e) => {
  if (e.target === charModal) charModal.hidden = true;
});

// ── 启动 ──
btnStop.disabled = true;
refresh();
setInterval(() => { if (!autoRun) refresh(); }, 5000);  // 非自动时每5秒刷新

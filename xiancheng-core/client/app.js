// ============================================================
// 清河县 v2 · 前端逻辑（地图 + 角色 + 状态驱动展示）
// ============================================================

const API = '';
let autoRun = false;
let autoTimer = null;

// ── DOM ──
const $ = (sel) => document.querySelector(sel);
const timeDisplay = $('#time-display');
const worldMetrics = $('#world-metrics');
const characterList = $('#character-list');
const eventList = $('#event-list');
const decisionMode = $('#decision-mode');
const mapOverlay = $('#map-overlay');
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

// 地点 → 地图像素坐标（背景图 1280×800，从 TMJ 区域中心推算）
const LOCATION_POS = {
  yamen:     { x: 228, y: 132 },
  market:    { x: 636, y: 148 },
  shop:      { x: 1052, y: 132 },
  warehouse: { x: 220, y: 396 },
  houses:    { x: 1068, y: 396 },
  hideout:   { x: 548, y: 620 },
  gate:      { x: 944, y: 740 },
};
const app_LOCATION_NAMES = {
  yamen: '县衙', market: '街市', shop: '商铺',
  warehouse: '仓库', houses: '民宅', hideout: '地下据点', gate: '城门',
};


// ── 头像加载器 ──
const avatarLoader = {
  cache: {},
  get(id) { return this.cache[id] || null; },
  loadAll() {
    const ids = ['char_xianling','char_butou','char_shangren','char_shimin_jia','char_shimin_yi','char_xiaotou','char_player'];
    for (const id of ids) {
      const img = new Image();
      img.src = `avatars/${id}.png`;
      this.cache[id] = img;
    }
  },
};
avatarLoader.loadAll();

// ── 渲染 ──
async function refresh() {
  try {
    const [state, characters, events] = await Promise.all([
      apiGet('/api/state'),
      apiGet('/api/characters'),
      apiGet('/api/events?limit=60'),
    ]);

    // 时间（v2 timeLabel 优先）
    if (state.timeLabel) {
      timeDisplay.textContent = state.timeLabel;
    } else {
      timeDisplay.textContent = `第 ${state.time.day} 天 · tick ${state.tick}`;
    }

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

    // ── 地图：角色位置标注 ──
    updateMapView(characters);

    // ── 角色列表（头像 + 目标 + 规划）──
    characterList.innerHTML = '';
    for (const c of characters) {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.dataset.id = c.id;
      const planLine = (c.plan || []).length > 0
        ? `<div class="plan">📋 ${c.plan.slice(0, 4).map(p => p.action).join(' → ')}${c.plan.length > 4 ? '…' : ''}</div>`
        : '<div class="plan">📋 思考中…</div>';
      card.innerHTML = `
        <div class="char-head">
          <img class="char-avatar" src="avatars/${c.id}.png" alt="${c.name}">
          <div>
            <div class="name">${c.name} ${c.isDetained ? '🔒' : ''}</div>
            <div class="role">${c.role} · ${app_LOCATION_NAMES[c.locationId] || c.locationId}</div>
          </div>
        </div>
        <div class="goal">🎯 ${c.goal ? c.goal.slice(0, 26) : '（思考中…）'}</div>
        ${planLine}
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
      characterList.appendChild(card);
    }

    // ── 事件流 ──
    eventList.innerHTML = '';
    for (const e of [...events].reverse()) {
      const item = document.createElement('div');
      item.className = 'event-item ' + (e.success ? 'success' : 'fail');
      item.innerHTML = `<span class="tick">[t${e.tick}]</span>${e.description}`;
      eventList.appendChild(item);
    }

    // ── 玩家面板 ──
    const player = characters.find((c) => c.id === 'char_player');
    if (player) {
      playerPanel.hidden = false;
      renderPlayerPanel(player);
    }
  } catch (err) {
    console.error('刷新失败:', err);
    const dbg = document.getElementById('debug-err');
    if (dbg) dbg.textContent = '刷新失败: ' + String(err && err.stack || err);
  }
}

// ── 场景视图渲染（MUD 式）──
function renderMap(characters) {
  updateMapView(characters);
}
// 初始化场景视图
setTimeout(() => { if (typeof initMapView === 'function') initMapView(); }, 100);

// ── 角色详情弹窗（v2：目标+规划）──
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

  const planSteps = (c.plan || []).map((p, i) =>
    `<div class="plan-step">${i + 1}. ${p.action}${p.targetId ? ' → ' + p.targetId : ''}（${p.duration || '?'}分钟）</div>`).join('');

  modalBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <img src="avatars/${c.id}.png" style="width:60px;height:72px;border-radius:8px">
      <div>
        <h2 style="margin:0">${c.name}（${c.role}）</h2>
        <p style="color:#8892b0;margin:4px 0 0">📍 ${app_LOCATION_NAMES[c.locationId] || c.locationId} | 💰 ${c.money}两 | 通缉：${c.wantedLevel}</p>
      </div>
    </div>
    <p style="color:#ffd166;margin-top:10px">🎯 ${c.goal ? c.goal : '（思考中…）'}</p>
    ${planSteps ? `<div style="margin-top:6px">${planSteps}</div>` : ''}
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
      💰 ${player.money}两 | 📍 ${app_LOCATION_NAMES[player.locationId] || player.locationId}
      ${player.wantedLevel > 0 ? ` | ⚠️通缉${player.wantedLevel}` : ''}
    </div>
  `;
  const actions = [
    { label: '给钱', action: 'give_money', param: 'amount', val: '20' },
    { label: '偷窃', action: 'steal', param: 'amount', val: '20' },
    { label: '威胁', action: 'threaten', param: 'amount', val: '10' },
    { label: '行贿', action: 'bribe', param: 'amount', val: '10' },
    { label: '买粮', action: 'buy', param: 'itemId', val: 'grain' },
    { label: '举报', action: 'report_crime', param: 'target', val: '' },
    { label: '等待', action: 'wait', param: '', val: '' },
  ];
  playerActions.innerHTML = '';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.onclick = async () => {
      const targets = await apiGet('/api/characters');
      const nonPlayer = targets.filter((c) => c.id !== 'char_player' && !c.isDetained);
      const parameters = {};
      if (a.param) parameters[a.param] = a.val;
      let targetId = undefined;
      if (a.action !== 'wait' && a.action !== 'buy') {
        if (nonPlayer.length === 0) { alert('没有可交互的角色'); return; }
        targetId = prompt(`选择目标角色（默认 ${nonPlayer[0].name}）:\n${nonPlayer.map((c) => c.id + '=' + c.name).join('\n')}`) || nonPlayer[0].id;
      }
      await apiGet('/api/action', {
        method: 'POST',
        body: JSON.stringify({ action: a.action, targetId, parameters }),
      });
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
  if (autoRun) autoTimer = window.setTimeout(runAutoTicks, 2000);
}

charModal.addEventListener('click', (e) => {
  if (e.target === charModal) charModal.hidden = true;
});

// ── 启动 ──
btnStop.disabled = true;
refresh();
setInterval(() => { if (!autoRun) refresh(); }, 5000);

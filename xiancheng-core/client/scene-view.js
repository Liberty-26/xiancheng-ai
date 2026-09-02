// ============================================================
// 清河县 · MUD 场景视图
// 每个地点一张场景图，角色站在场景上
// ============================================================

const SCENE_META = {
  yamen:     { name: '县衙', icon: '🏛️' },
  market:    { name: '街市', icon: '🏮' },
  shop:      { name: '商铺', icon: '🏪' },
  warehouse: { name: '仓库', icon: '📦' },
  houses:    { name: '民宅', icon: '🏠' },
  hideout:   { name: '地下据点', icon: '🕳️' },
  gate:      { name: '城门', icon: '🏯' },
};

let currentScene = 'yamen';
let sceneCharacters = [];

// 初始化场景视图
function initSceneView() {
  buildSceneNav();
}

// 构建底部地点导航
function buildSceneNav() {
  const nav = document.getElementById('scene-nav');
  if (!nav) return;
  nav.innerHTML = '';
  for (const [id, meta] of Object.entries(SCENE_META)) {
    const btn = document.createElement('button');
    btn.className = 'scene-nav-btn';
    btn.dataset.scene = id;
    btn.innerHTML = `${meta.icon} ${meta.name}`;
    btn.onclick = () => selectScene(id);
    nav.appendChild(btn);
  }
}

// 切换场景
function selectScene(id) {
  currentScene = id;
  document.querySelectorAll('.scene-nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.scene === id);
  });
  renderScene();
}

// 渲染场景：背景图 + 角色
function renderScene() {
  const container = document.getElementById('scene-container');
  const meta = SCENE_META[currentScene] || { name: currentScene, icon: '📍' };
  if (!container) return;

  const inScene = sceneCharacters.filter((c) => c.locationId === currentScene);
  const others = sceneCharacters.filter((c) => c.locationId !== currentScene);

  container.innerHTML = `
    <div class="scene-title">${meta.icon} ${meta.name}</div>
    <div class="scene-bg-wrap">
      <img class="scene-bg" src="scenes/${currentScene}.png" alt="${meta.name}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="scene-fallback" style="display:none">⚠️ 场景图未生成</div>
      <div class="scene-chars">
        ${inScene.map((c) => `
          <div class="scene-char" onclick="openCharModal('${c.id}')" title="${(c.goal || '思考中').slice(0, 30)}">
            <img src="avatars/${c.id}.png" class="scene-char-img" onerror="this.style.visibility='hidden'">
            <span class="scene-char-name">${c.name}</span>
          </div>
        `).join('')}
        ${inScene.length === 0 ? '<div class="scene-empty">此处无人</div>' : ''}
      </div>
    </div>
    <div class="scene-elsewhere">
      <span style="color:#8892b0;font-size:12px">其他地点：</span>
      ${others.map((c) => `
        <span class="elsewhere-chip" onclick="openCharModal('${c.id}')">
          ${SCENE_META[c.locationId]?.icon || '📍'} ${SCENE_META[c.locationId]?.name || c.locationId} · ${c.name}
        </span>
      `).join('')}
    </div>
  `;
}

// 由 refresh() 调用：更新角色数据并渲染
function updateSceneView(characters) {
  sceneCharacters = characters;
  const player = characters.find((c) => c.id === 'char_player');
  if (player && player.locationId && SCENE_META[player.locationId]) {
    if (currentScene !== player.locationId) {
      currentScene = player.locationId;
      document.querySelectorAll('.scene-nav-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.scene === currentScene);
      });
    }
  }
  renderScene();
}
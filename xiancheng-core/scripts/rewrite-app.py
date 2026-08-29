# 重写 app.js：地图渲染改为 Canvas 像素风 + 头像加载器
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/app.js'
src = open(path, encoding='utf-8').read()

# 1) 在 DOM 区后加 canvas 引用（保持 mapOverlay，添加 gameMap/gameCtx）
old_dom = "const mapOverlay = $('#map-overlay');"
new_dom = """const mapOverlay = $('#map-overlay');
const gameMap = document.getElementById('game-map');
const gameCtx = gameMap ? gameMap.getContext('2d') : null;"""
assert old_dom in src
src = src.replace(old_dom, new_dom)

# 2) 头像加载器
avatar_code = """
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
"""
# 插到 DRIVE_NAMES 后
anchor = "// ── 渲染 ──"
assert anchor in src
src = src.replace(anchor, avatar_code + "\n" + anchor)

# 3) 把 renderMap 替换为 canvas 渲染（调 map-canvas.js 的函数）
old_render = """// ── 地图渲染：角色头像标记在对应地点上 ──
function renderMap(characters) {
  mapOverlay.innerHTML = '';
  // 地点标签
  for (const [locId, pos] of Object.entries(LOCATION_POS)) {
    const label = document.createElement('div');
    label.className = 'map-loc-label';
    label.style.left = pos.x + 'px';
    label.style.top = pos.y + 'px';
    label.textContent = LOCATION_NAMES[locId] || locId;
    mapOverlay.appendChild(label);
  }
  // 角色头像（按地点聚合摆放）
  const byLoc = {};
  for (const c of characters) {
    if (!byLoc[c.locationId]) byLoc[c.locationId] = [];
    byLoc[c.locationId].push(c);
  }
  for (const [locId, list] of Object.entries(byLoc)) {
    const pos = LOCATION_POS[locId];
    if (!pos) continue;
    list.forEach((c, i) => {
      const offset = (i - (list.length - 1) / 2) * 26;
      const el = document.createElement('div');
      el.className = 'map-char';
      el.title = `${c.name}：${c.goal || '思考中'}`;
      el.style.left = (pos.x + offset - 20) + 'px';
      el.style.top = (pos.y + 30) + 'px';
      const img = document.createElement('img');
      img.src = `avatars/${c.id}.png`;
      img.alt = c.name;
      el.appendChild(img);
      el.onclick = () => openCharModal(c.id);
      mapOverlay.appendChild(el);
    });
  }
}"""

new_render = """// ── 地图渲染：Canvas 像素风（调用 map-canvas.js）──
function renderMap(characters) {
  // Canvas 像素地图绘制（草/路/建筑 + 角色头像）
  if (gameMap && gameCtx) {
    drawBaseMapIfNeeded();
    drawCharactersOnMap(characters, avatarLoader);
  }
}"""

assert old_render in src, 'renderMap not found'
src = src.replace(old_render, new_render)

open(path, 'w', encoding='utf-8').write(src)
print('app.js 已重写：canvas 地图渲染 + 头像加载器')
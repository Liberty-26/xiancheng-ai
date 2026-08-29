import re
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/index.html'
src = open(path).read()

old = '''    <!-- 地图区 -->
    <section id="map-area" class="panel map-panel">
      <h2>🗺️ 县城地图</h2>
      <div id="map-container">
        <img id="map-bg" src="map/county-map.png" alt="清河县地图">
        <div id="map-overlay"></div>
      </div>
    </section>'''

new = '''    <!-- 地图区 -->
    <section id="map-area" class="panel map-panel">
      <h2>🗺️ 县城地图（俯视 2D）</h2>
      <div id="map-container">
        <canvas id="game-map" width="960" height="600"></canvas>
        <div id="map-overlay"></div>
      </div>
    </section>'''

assert old in src, 'map block not found'
src = src.replace(old, new)
open(path, 'w').write(src)
print('index.html canvas 地图已替换')
import sys
sys.stdout.reconfigure(encoding='utf-8')
path = '/Users/libaodian/Desktop/小县城/xiancheng-core/client/index.html'
src = open(path, encoding='utf-8').read()

old = '''  <script src="map-canvas.js"></script>
  <script src="app.js"></script>
</body>'''
new = '''  <div id="debug-err" style="position:fixed;bottom:0;left:0;right:0;background:#b9800b;color:#fff;padding:8px 12px;font-size:12px;z-index:999;display:none;white-space:pre-wrap;max-height:80px;overflow:auto"></div>
  <script src="map-canvas.js"></script>
  <script src="app.js"></script>
</body>'''

assert old in src, 'script block not found'
src = src.replace(old, new)
open(path, 'w', encoding='utf-8').write(src)
print('index.html: 加了 debug-err 元素')
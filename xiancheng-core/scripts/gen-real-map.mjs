// 千问文生图：以程序化对齐地图为参考图，生成真实风格古代县城俯视图
// 参考图保证布局与碰撞网格一致，提示词保证真实贴图质感
// 输出：client/map/bg.png（1280×800）

import dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync, readFileSync } from "fs";

dotenv.config({ path: resolve(import.meta.dirname, "..", ".env") });

const API_KEY = process.env.QWEN_IMAGE_API_KEY;
const API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MODEL = process.env.QWEN_IMAGE_MODEL || "qwen-image-3.0";
const TIMEOUT = parseInt(process.env.QWEN_IMAGE_TIMEOUT_MS || "300000", 10);

// 参考图：当前程序化对齐地图（与 TMJ 碰撞网格 100% 对齐）
const REF_PATH = resolve(import.meta.dirname, "..", "client/map/bg.png");
const OUT_PATH = resolve(import.meta.dirname, "..", "client/map/bg.png");

const PROMPT = `请以我提供的参考图为布局基准，重新绘制一张【真实质感的中国古代县城俯视地图】，1280×800 横版游戏地图背景。

【硬性要求——布局必须与参考图完全一致】
1. 整张地图是俯视（top-down）视角的县城全景，参考图里划分的 7 个区域的位置、大小、形状必须原样保留，道路连接方式不变。
2. 左上区域是县衙：红墙青瓦的官府院落，有正堂、两侧厢房、院墙、门前石狮子。
3. 中上区域是街市：开阔的集市广场，青石板地面，两侧木质摊位、彩色布篷、幌子旗。
4. 右上区域是商铺：二层木楼商铺，灰瓦屋顶，木格窗，门口挂布幌子。
5. 左中区域是仓库：木板搭建的粮仓，灰瓦顶，门口堆着麻袋。
6. 右中区域是民宅：几栋青砖瓦房小院，低矮院墙，院内种树。
7. 中下区域是地下据点：地面上只看到一个隐秘入口的破旧院落，石板掩盖。
8. 右下区域是城门：城门楼+门洞+城墙，通向城外的黄土官道。
9. 区域之间用土黄色/青灰色的道路连接，路边有树木、草丛。

【美术风格——要真实、有质感，绝不要色块】
10. 中国古风手绘游戏美术风格，色彩丰富有层次：瓦片屋顶要有瓦楞纹理和光影，墙要有砖缝，地面要有石板缝和青苔，树木要有枝叶细节，道路要有车辙痕迹。
11. 【重要】整张图必须是【晴朗白天的明亮色调】：阳光明媚、色彩明快、对比清晰，屋顶是青灰色/红棕色，树木是翠绿色，天空明亮。绝不能是夜晚、黄昏、阴天或昏暗色调。
12. 全图有柔和的阳光和阴影，明暗过渡自然，写实但不脏。
13. 只画场景，不画任何人、动物、文字。
14. 画面精致细腻，像成熟商业游戏的地图背景，可以放大到 1280×800 不糊。`;

async function main() {
  console.log("=== 生成真实风格县城地图（参考图编辑） ===\n");

  // 读取参考图 → base64
  const refBuf = readFileSync(REF_PATH);
  const refB64 = refBuf.toString("base64");
  console.log(`参考图: ${REF_PATH} (${refBuf.length} bytes)`);

  const body = {
    model: MODEL,
    input: {
      messages: [
        {
          role: "user",
          content: [
            { image: `data:image/png;base64,${refB64}` },
            { text: PROMPT },
          ],
        },
      ],
    },
    parameters: { size: "1280*800", n: 1 },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ` + JSON.stringify(data).slice(0, 300));
    const imgUrl = data?.output?.choices?.[0]?.message?.content?.find((p) => p.type === "image")?.image;
    if (!imgUrl) throw new Error("无图片URL: " + JSON.stringify(data).slice(0, 300));

    console.log("图片URL获取成功，下载中...");
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`下载失败: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());

    // 备份旧图
    const { existsSync, copyFileSync } = await import("fs");
    const bakPath = resolve(import.meta.dirname, "..", "client/map/bg-procedural-backup.png");
    if (existsSync(OUT_PATH) && !existsSync(bakPath)) {
      copyFileSync(OUT_PATH, bakPath);
      console.log(`已备份旧程序化地图 → ${bakPath}`);
    }

    writeFileSync(OUT_PATH, buf);
    console.log(`[完成] 新地图已写入 client/map/bg.png (${buf.length} bytes)`);

    // 检查尺寸
    const { execSync } = await import("child_process");
    try {
      execSync(`python3 -c "
from PIL import Image
im = Image.open('${OUT_PATH}')
print('尺寸:', im.size, '模式:', im.mode)
"`);
    } catch { /* 无PIL则跳过 */ }
  } catch (e) {
    console.error(`[失败] ${e.message.slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((e) => console.error("Fatal:", e));

// 千问文生图批量生成 7 个场景背景
// 格式：1280×800，中国古代县城俯视/平视 2D 游戏场景，简单干净

import dotenv from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";

dotenv.config({ path: resolve(import.meta.dirname, "..", ".env") });

const API_KEY = process.env.QWEN_IMAGE_API_KEY;
const API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const MODEL = process.env.QWEN_IMAGE_MODEL || "qwen-image-3.0";
const TIMEOUT = parseInt(process.env.QWEN_IMAGE_TIMEOUT_MS || "240000", 10);

const SCENES = [
  {
    id: "yamen",
    name: "县衙",
    prompt: "中国古代县城县衙的2D游戏场景背景图，俯视角度。画面中央是一座青瓦红墙的县衙正堂，门前有三级台阶和两尊石狮子，左侧有鼓架，右侧是告示牌。院落铺青砖，院墙外能看到远处的民居屋顶和树木。光线明亮，色彩温和。游戏美术风格，简洁干净，只画场景不画人物。16:10横版。",
  },
  {
    id: "market",
    name: "街市",
    prompt: "中国古代县城街市的2D游戏场景背景图，俯视角度。画面是一条石板路主街，两侧排列着露天木制摊位，摊位上摆放着布匹、粮食、陶罐、蔬果等货物。摊位上方挂着彩色的布篷和幌子。街道上有行人往来的空间（不画人）。远处能看见民居的灰瓦屋顶和树木。阳光明媚，色彩鲜明活泼。游戏美术风格。16:10横版。",
  },
  {
    id: "shop",
    name: "商铺",
    prompt: "中国古代县城商铺的2D游戏场景背景图，俯视角度。画面是一座临街的二层木楼商铺，门口挂着布幌子，写着'陈记'字样。一楼是敞开的店门和柜台，柜台上摆着布匹和货物。店铺前是石板路，旁边有一棵老槐树。整条街干净整洁。暖色调，棕色和米黄色为主。游戏美术风格，只画场景不画人物。16:10横版。",
  },
  {
    id: "warehouse",
    name: "仓库",
    prompt: "中国古代县城粮仓仓库的2D游戏场景背景图，俯视角度。画面是一座木头搭建的大仓库，灰瓦屋顶，墙体是木板拼接。仓库正门敞开，可以看到里面堆放的麻袋和木箱。仓库前是一片夯实的泥土地面，堆着几个空木桶。光线较暗，偏冷色调。游戏美术风格，只画场景不画人物。16:10横版。",
  },
  {
    id: "houses",
    name: "民宅",
    prompt: "中国古代县城民宅区的2D游戏场景背景图，俯视角度。画面是几栋相邻的青砖瓦房小院，有低矮的院墙和木门。院子里晾晒着衣物（不画人），墙角有花盆和蔬菜。一条小土路从门前经过，路边有柳树。生活气息浓厚，暖色调，柔和的阳光。游戏美术风格，只画场景不画人物。16:10横版。",
  },
  {
    id: "hideout",
    name: "地下据点",
    prompt: "中国古代县城地下秘密据点的2D游戏场景背景图，俯视角度。画面是一个昏暗的地下室空间，粗糙的石头墙壁，只有几盏油灯照明。室内有破旧的木桌、椅子，角落里堆着一些杂物和麻袋。一面墙上贴着几张发黄的纸。阴森、神秘的氛围，暗色调，光影对比强。游戏美术风格，只画场景不画人物。16:10横版。",
  },
  {
    id: "gate",
    name: "城门",
    prompt: "中国古代县城城门的2D游戏场景背景图，俯视角度。画面是一座雄伟的城门楼，两层楼阁，青瓦屋顶，红色木柱和城墙是灰砖砌筑。城门洞大开，可以看到门外是一条黄土官道，远处有农田和小山丘。城墙两侧延伸出去。天空开阔，有白云。温暖色调，古朴雄伟。游戏美术风格，只画场景不画人物。16:10横版。",
  },
];

async function generateScene({ id, name, prompt }) {
  const outDir = resolve(import.meta.dirname, "..", "client/scenes");
  mkdirSync(outDir, { recursive: true });

  const outPath = resolve(outDir, `${id}.png`);
  if (existsSync(outPath)) {
    console.log(`[SKIP] ${name}(${id}) 已存在`);
    return;
  }

  console.log(`[开始] ${name}(${id}) ...`);
  const body = {
    model: MODEL,
    input: {
      messages: [{ role: "user", content: [{ text: prompt }] }],
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
    const imgUrl = data?.output?.choices?.[0]?.message?.content?.find((p) => p.type === "image")?.image;
    if (!imgUrl) throw new Error("无图片URL: " + JSON.stringify(data).slice(0, 200));

    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`下载失败: ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(outPath, buf);
    console.log(`[完成] ${name}(${id}) ${buf.length} bytes`);
  } catch (e) {
    console.error(`[失败] ${name}(${id}): ${e.message.slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`=== 千问文生图 批量生成 ${SCENES.length} 个场景 ===\n`);
  for (const scene of SCENES) {
    await generateScene(scene);
    // 每张间隔 2 秒，避免撞限流
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\n完成");
  // 列出
  const { readdirSync, statSync } = await import("fs");
  for (const f of readdirSync(resolve(import.meta.dirname, "..", "client/scenes"))) {
    const s = statSync(resolve(import.meta.dirname, "..", "client/scenes", f));
    console.log(`  ${f}: ${s.size} bytes`);
  }
}

main().catch((e) => console.error("Fatal:", e));
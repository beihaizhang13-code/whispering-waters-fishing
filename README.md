# 🎣 微风垂钓物语 2.0 (Whispering Waters Fishing)

一款基于原生 HTML5 Canvas + SVG + Tailwind CSS + Tone.js 开发的 2D/2.5D 休闲垂钓与生态观赏网页游戏，现已完成**前后端解耦全栈工程基座**：支持横向大世界自由探索、乘船远航、20 种独立建模鱼类互动收集、水族箱经营与悬赏订单玩法，并已构建共享数值契约、双端 SQLite/PostgreSQL 数据库迁移、平台无关后端服务骨架与自动化测试体系。

- **在线试玩**：https://whispering-waters-fishing.netlify.app
- **工程蓝图中心**：[docs/README.md](docs/README.md)

---

## ✨ 核心特色

- **2400px 四大横向生态海域**：
  - 🌾 **芦苇浅滩** (`0–600`)：温暖岸坡、摇曳蒲草与睡莲浅水区
  - 🌉 **微风木栈桥** (`600–1200`)：暖光风灯、栈桥甲板与路亚钓点
  - 🏝️ **翡翠湖心岛** (`1200–1800`，需乘船)：湖心奇石、樱花飘落与石灯笼
  - ⚓ **星渊沉船湾** (`1800–2400`，需乘船)：幽灵沉船、晶簇浮标与深海巨物
- **流畅 2.5D 转向手感与镜头前瞻**：
  - 步行与划船具备起步加减速、急停转向微尘、SOCD 后按优先防卡顿、船体水阻纵倾以及垂挂浮漂摆锤惯性。
- **20 种鱼类独立双模建模与互动手感**：
  - 普通 / 稀有 / 史诗 / 传说 / 神话 5 档稀有度共 20 种鱼类，分别拥有独立分层动态 **SVG** 与关节/脊柱 **Canvas 2D** 模型。
- **性格化遛鱼博弈与动态环境**：
  - 稳健、冲刺、沉底、幻影四大鱼类性格与跃水刺鱼 QTE；结合晴空 / 烟雨 / 雷暴 / 星陨极光天气、昼夜天色与限时「黄金鱼潮」。
- **完整全栈工程架构基座 (v2.1 Foundation)**：
  - **前后端单一事实源 (`shared/`)**：统一 20 鱼种目录、Archive/Save v2 校验 Schema、确定性全服天气/鱼潮时钟与错误码。
  - **核心解耦后端 (`backend/` + `netlify/functions/` + `server.js`)**：采用 Web 标准 `Request`/`Response` 路由，同一套代码既运行于本地 Node 24 (`node:sqlite`)，也直接部署到 Netlify Functions (`@netlify/database` Postgres)。
  - **双端迁移与完整蓝图 (`db/` + `docs/` + `tests/`)**：12 张核心业务表建表迁移与成就种子、7 篇中文工程蓝图文档及单元/契约/集成自动化测试。

---

## 🎮 操作说明

### 桌面端键盘 / 鼠标
- `A` / `D` 或 `←` / `→`：左右步行或划船探索
- `E`：登船 / 靠岸下船
- `空格键` 或长按画布/主按钮：蓄力抛竿、咬钩提竿、遛鱼控制
- `W` / `↑`（或点击提示横幅/画布）：大鱼跃水空中刺鱼 QTE
- `1` ~ `4`：快速切换鱼饵
- `Esc`：关闭当前弹窗

### 移动端触控
- 支持独立移动按钮、快捷海域传送栏、单指/多指触控抛竿与 QTE 刺鱼。

---

## 🚀 本地运行、构建与验证

项目在本地开发阶段**零外部 npm 依赖**，仅需 **Node.js 24+** 即可直接运行完整前端、API 服务、SQLite 迁移与自动化测试：

```bash
# 1. 初始化本地 SQLite 数据库 (可选，默认 ./data/whispering_waters.sqlite)
node scripts/db_migrate_local.mjs

# 2. 构建发布目录 dist/
node scripts/build.mjs

# 3. 启动本地全栈预览服务器 (前端 + /api/v1/*)
node server.js

# 4. 运行全仓库完整性自检与全部自动化测试
node scripts/verify.mjs
node --test tests/unit/*.test.mjs tests/contract/*.test.mjs tests/integration/*.test.mjs
```

启动后可在浏览器或终端访问：
- 游戏主页面：`http://127.0.0.1:18888/index.html`
- API 健康检查：`http://127.0.0.1:18888/api/v1/health`
- 全服天气与鱼潮：`http://127.0.0.1:18888/api/v1/world/state`

---

## 📁 目录结构

```text
.
├── index.html                        # 主页面与 UI 弹窗结构
├── manifest.webmanifest              # PWA 应用清单
├── css/                              # 全局样式与动画
├── js/
│   ├── core.js                       # 全局状态、生态区、天气与运行时状态机
│   ├── fish_renderer.js              # 共享鱼类建模引擎与 2.5D 交互控制器
│   ├── fish_models_*.js              # 20 种普通/稀有/史诗/神话鱼类模型
│   ├── art_audio.js                  # 装备/物种数据库与 Tone.js 音效系统
│   ├── scene_character.js            # 2400px 生态场景、角色与船只渲染
│   ├── gameplay_physics.js           # 概率引擎、遛鱼物理博弈、QTE 与飞鱼演出
│   ├── ui_aquarium.js                # 存档、鱼篓、互动水族箱、悬赏、图鉴与商店
│   ├── api_client.js                 # [M0 桩] 同源 /api/v1/* 请求客户端
│   └── cloud_sync.js                 # [M0 桩] 本地优先与云同步状态机
├── shared/                           # 前后端单一事实源 (目录/存档Schema/时钟/错误码)
├── backend/                          # 平台无关后端核心 (config/auth/domain/http/repositories)
├── db/                               # SQLite 与 PostgreSQL 双端迁移及初始种子
├── netlify/
│   ├── functions/api.mjs             # Netlify Functions v2 API 统一入口 (/api/*)
│   └── database/README.md            # Netlify Database 迁移晋升指南
├── scripts/                          # build.mjs / db_migrate_local.mjs / verify.mjs
├── tests/                            # unit / contract / integration 自动化测试
├── docs/                             # 架构、防作弊、DB、API、安全、运维与路线图文档
├── dist/                             # 自动化构建出的 Netlify 发布产物目录
├── archive/
│   └── cozy_fishing_game.html        # 早期单文件版本留档
├── server.js                         # 本地全栈安全开发服务器 (127.0.0.1:18888)
├── netlify.toml                      # Netlify 构建、Functions 与安全/缓存响应头配置
├── package.json                      # 工程脚本与 Node >=24 引擎声明
└── .env.example                      # 环境变量模板
```

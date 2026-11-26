# 01. 系统架构与核心解耦设计

## 1. 设计目标与架构选型

《微风垂钓物语 2.0》采用 **“核心解耦 + Netlify 全栈 + 本地 Node 24/SQLite 镜像”** 混合权威架构：

1. **体验不妥协**：60fps 2.5D 角色划船/转身物理、8 阶段抛竿/咬钩/遛鱼博弈、Tone.js 程序化声学和 Canvas/SVG 双模鱼类渲染全部保留在浏览器端，**断网或后端维护时仍可单机畅玩**。
2. **核心与平台彻底解耦**：所有 HTTP 路由、鉴权、云存档合并、经济防作弊和世界时钟均写在平台无关的 `backend/`（基于 Web 标准 `Request` / `Response`）；`netlify/functions/api.mjs` 与本地 `server.js` 仅作为入口适配器。
3. **本地零依赖、线上零运维**：
   - 本地开发直接利用 `Node.js 24` 原生 `node:sqlite` 与 `node:test`，无需安装 Docker 或本地 PostgreSQL 即可做完整联调；
   - 线上通过 Netlify Functions + Netlify Database (PostgreSQL) 与静态前端同域部署，彻底免除 CORS 跨域和自建运维负担。
4. **平滑演进退路**：若未来需要独立云服务器或 WebSocket 多人同屏实时钓场，只需新增一个独立 Node HTTP/WS 入口挂载 `backend/http/router.mjs` 和领域服务即可，无需重写业务逻辑。

---

## 2. 整体分层架构图

```mermaid
flowchart TB
  subgraph Client["浏览器客户端 (Local-First + 60fps 表现层)"]
    UI["Canvas 2400px 世界 / 20 种双模鱼 / 水族箱与商店 UI"]
    Sync["js/cloud_sync.js (本地优先队列与冲突恢复)"]
    ApiCli["js/api_client.js (同源 /api/v1/* 客户端)"]
    LocalStore[("浏览器 localStorage")]
    UI --> Sync
    Sync --> LocalStore
    Sync --> ApiCli
  end

  subgraph Shared["前后端单一事实源 (shared/)"]
    Catalog["game_catalog.js (20 鱼种 / 装备 / 价格 / 成就)"]
    Schema["save_schema.js (v2 存档清洗与边界校验)"]
    Clock["world_clock.js (确定性全服天气与自然鱼潮)"]
    Err["error_codes.js (统一错误码枚举)"]
  end

  subgraph Gateway["双端入口适配器"]
    LocalSrv["server.js (Node 24 本地安全开发服)"]
    NetlifyFn["netlify/functions/api.mjs (Netlify Functions v2)"]
  end

  subgraph Backend["平台无关后端核心 (backend/)"]
    Router["backend/http/router.mjs + 中间件/响应信封"]
    Auth["auth/auth_service.mjs"]
    Domain["domain/* (存档合并 / 水族箱 / 经济校验 / 排行 / 社交 / 世界事件)"]
    RepoIf["repositories/interfaces.mjs"]
    Router --> Auth
    Router --> Domain
    Auth --> RepoIf
    Domain --> RepoIf
  end

  subgraph Storage["可替换存储层 (db/)"]
    Sqlite["repositories/sqlite/adapter.mjs (Node 24 node:sqlite)"]
    Postgres["repositories/postgres/adapter.mjs (@netlify/database Postgres)"]
  end

  ApiCli -- "同域 HTTP /api/v1/*" --> LocalSrv
  ApiCli -- "同域 HTTPS /api/v1/*" --> NetlifyFn
  LocalSrv --> Router
  NetlifyFn --> Router
  RepoIf --> Sqlite
  RepoIf --> Postgres
  Client -.-> Shared
  Backend -.-> Shared
```

---

## 3. 核心请求数据流（云同步与混合权威）

```mermaid
sequenceDiagram
  participant P as 玩家浏览器
  participant L as localStorage
  participant C as CloudSync/ApiClient
  participant G as API 网关 (server.js / Netlify Fn)
  participant D as 领域服务 + 风控校验
  participant DB as SQLite / Postgres

  Note over P,L: 1. 玩家在前端完成蓄力、遛鱼、QTE（60fps 本地实时）
  P->>L: 立即写入本地存档，保证手感零延迟
  P->>C: 入队待校验事件 (clientCatchUid / idempotencyKey)
  C->>G: POST /api/v1/gameplay/catches (携带会话凭证)
  G->>D: 同源校验 + 限流 + 参数 Schema 校验
  D->>DB: 检查 clientCatchUid 幂等键 & 玩家当前海域/船只/鱼饵
  D->>D: 重算价格并判定体长/重量/频次合法性
  D->>DB: 写入 catch_logs + economy_ledger + 更新 player_saves.revision
  DB-->>D: 提交事务
  D-->>G: 返回权威余额与新 revision
  G-->>C: 200 OK { ok: true, data, meta }
  C-->>P: 对齐云端 revision；若断网则保留队列待重连同步
```

---

## 4. 前后端职责清晰边界

| 能力模块 | 前端职责 (`js/`) | 共享契约 (`shared/`) | 后端职责 (`backend/`) |
| :--- | :--- | :--- | :--- |
| **移动与物理手感** | 角色/船只插值、浮漂抛物线、QTE 判定、Canvas/SVG 渲染 | 世界宽度 `2400`、海域坐标区间 | 仅校验上报捕鱼时所在海域是否合法（如深水需船） |
| **抽鱼与鱼类生成** | 客户端按权重大致体验出鱼节奏，支持离线单机游玩 | 20 鱼种基础权重、体长/重量上下界、稀有度倍率 | 接收捕鱼记录后做合理性边界复核并按基准公式重算售价 |
| **经济与道具升级** | UI 展示价格与即时响应反馈 | 鱼饵/钓竿/卷线器/船只/服装/水族箱价格目录 | 服务端权威扣款、防负余额、防重放幂等与流水记账 |
| **水族箱收益** | 弹窗内实时互动喂食、气泡、游动演出 | 稀有度基础每分钟门票、等级容量与收益倍数 | 服务端以 UTC 时间差结算离线门票（封顶 24 小时） |
| **存档与账号** | `localStorage` 本地首写、登录后触发合并向导 | `SaveSchema v2` 结构、清洗与边界规则 | 会话管理、密码哈希、游客合并、`revision` 乐观锁 |
| **全服天气与鱼潮** | 渲染天气粒子与黄金鱼潮视觉效果 | `world_clock.js` 确定性 UTC 算法 | 返回全服时钟并与数据库祈愿 `world_events` 叠加 |

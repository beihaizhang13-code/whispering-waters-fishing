# 07. 分阶段实施路线图 (Roadmap)

本项目采用 **“先立骨架与契约，再分里程碑填充与联调”** 的演进策略，确保每一阶段都可独立构建、独立验证、不破坏现有玩家体验。

---

## M0：全栈项目完整性与工程基座（当前阶段 ✅）

- **交付物**：
  - 仓库清理与工程配置（`package.json`, `.env.example`, `.editorconfig`, `manifest.webmanifest`, `netlify.toml`, `.github/workflows/ci.yml`）；
  - 前后端单一事实源（`shared/game_catalog.js`, `save_schema.js`, `world_clock.js`, `error_codes.js`）；
  - 双端 SQLite / PostgreSQL 12 表初始化迁移与成就种子（`db/`）；
  - 平台无关后端核心骨架（`backend/`）、Netlify Functions 入口（`netlify/functions/api.mjs`）与防路径遍历本地服务器（`server.js`）；
  - 前端 `ApiClient` 与 `CloudSync` 接入桩；
  - 构建/迁移/自检脚本（`scripts/`）、完整蓝图文档（`docs/`）与单元/契约/集成测试（`tests/`）。
- **验收标准**：`node scripts/build.mjs`、`node scripts/verify.mjs`、`node --test` 全绿通过，前端单机游玩 100% 保持原样。

---

## M1：游客认证、正式账号绑定与云存档闭环

- **目标**：打通“免登录游客开局 → 可选邮箱/OAuth 绑定升级 → 多端云存档乐观锁与冲突合并”。
- **重点开发项**：
  1. 实现 `SqliteAuthRepository` 与 `PostgresAuthRepository`（`users`, `auth_identities`, `sessions`）；
  2. 实现 `auth_service.mjs`（`scrypt` 密码哈希、游客签名令牌、账号合并与注销）；
  3. 实现 `save_merge_service.mjs`（`GET/PUT /api/v1/save` 乐观锁 `409`、`/save/merge`、`/save/export`、`/save/import`）；
  4. 启用前端 `js/cloud_sync.js` 与轻量账号入口弹窗（保持无账号仍可本地单机游玩）。
- **验收标准**：本地 SQLite 与线上 Netlify Postgres 均可通过注册/登录/游客升级/409 冲突合并全套集成测试。

---

## M2：混合权威经济校验与水族箱离线收益

- **目标**：建立不可刷钱的后端经济账本与服务端离线挂机收益。
- **重点开发项**：
  1. 实现 `economy_validator.mjs`（捕鱼海域/体长/价格重算、鱼饵原子扣减、商店升级、悬赏交付、`economy_ledger` 幂等落库）；
  2. 实现 `aquarium_service.mjs`（UTC 离线门票结算上限 24h、喂食成长、水族箱扩建）；
  3. 完善 `catch_logs` 风控标记（`verified` / `flagged` / `rejected`）与 `audit_security_events` 记录。
- **验收标准**：篡改客户端金币/鱼价/跨海作弊上报全部被 `422 ANTICHEAT_REJECTED` 拦截；重复提交相同 `Idempotency-Key` 不会重复入账。

---

## M3：全服黄金鱼潮祈愿、多维排行榜与社交分享

- **目标**：补齐跨玩家互动与长期追求目标。
- **重点开发项**：
  1. 实现 `world_event_service.mjs` 全服黄金鱼潮祈愿与持久化播报；
  2. 实现 `leaderboard_service.mjs`（20 鱼种单鱼最重/最长榜、图鉴榜、财富榜、悬赏大师榜，仅收录 `verified` 成绩）；
  3. 实现 `social_service.mjs`（12 项里程碑成就追踪领奖、个人水族箱只读分享页 `/share/:code` 与点赞）。
- **验收标准**：玩家可生成公开水族箱分享链接、查看全服榜单并在集齐图鉴/捕获神话鱼时领取成就奖励。

---

## M4：前端构建优化、PWA 离线增强与线上可观测性

- **目标**：彻底脱离开发期 CDN 运行时依赖，提升弱网加载速度与安全评级。
- **重点开发项**：
  1. 将 Tailwind CSS 编译为本地静态样式产物，本地托管 Tone.js 与字体资源，收紧 `netlify.toml` CSP（去除 `'unsafe-inline'`）；
  2. 接入 Service Worker 静态资源缓存（保留 `/api/*` Network-Only）；
  3. 接入前端错误上报与后端健康巡检告警。
- **验收标准**：Lighthouse PWA / 性能 / 最佳实践达到 90+，弱网下可秒开并自动完成断网重连云同步。

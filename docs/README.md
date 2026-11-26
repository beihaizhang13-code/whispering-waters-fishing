# 《微风垂钓物语 2.0》工程架构与全栈蓝图文档中心

欢迎查阅《微风垂钓物语 2.0》项目完整性基座文档。本套文档在 **M0 工程基座阶段** 完成，目标是先将全栈架构边界、前后端共享契约、数据库模型、API 规范、安全防作弊、运维发布与开发路线图完全对齐，再分阶段平稳填充业务逻辑。

---

## 📚 文档导航

| 文档 | 核心主题 | 适用读者 |
| :--- | :--- | :--- |
| [01-architecture.md](./01-architecture.md) | 系统分层架构、前后端边界、解耦适配器与迁移退路 | 全体开发与架构评审 |
| [02-domain-and-anticheat.md](./02-domain-and-anticheat.md) | 游客升级合并、离线水族箱结算、混合权威防作弊与全服时钟 | 后端与游戏数值策划 |
| [03-database-schema.md](./03-database-schema.md) | 12 张核心表 ER 图、SQLite/Postgres 对照与迁移安全规范 | 后端与 DBA |
| [04-api-contract.md](./04-api-contract.md) | `/api/v1/*` 全量 REST 接口契约、错误码、幂等与乐观锁 | 前后端联调开发 |
| [05-security-and-compliance.md](./05-security-and-compliance.md) | 认证鉴权、CSRF/限流/CSP、静态服务安全与隐私注销合规 | 全栈与安全审计 |
| [06-devops-and-runbook.md](./06-devops-and-runbook.md) | 本地零依赖开发、Netlify 部署步骤、环境变量与故障排查 Runbook | 运维与发布负责人 |
| [07-roadmap.md](./07-roadmap.md) | M0 ~ M4 分阶段实施里程碑与每阶段验收标准 | 项目统筹与研发排期 |

---

## 🧩 项目完整性状态矩阵

| 能力域 | M0 基座状态（当前） | 对应落地位置 | 后续落地里程碑 |
| :--- | :--- | :--- | :--- |
| **前端单机可玩核心** | ✅ 完整可用（零破坏） | `index.html`, `js/core.js` ~ `js/ui_aquarium.js` | M4 接入构建优化 |
| **前后端单一事实源** | ✅ 完整契约就绪 | `shared/game_catalog.js`, `save_schema.js`, `world_clock.js`, `error_codes.js` | 随数值调整持续同步 |
| **双端数据库迁移与种子** | ✅ 12 表 DDL + 12 成就就绪 | `db/migrations/sqlite/`, `db/migrations/postgres/`, `db/seeds/` | M1 晋升 `netlify/database/` |
| **本地安全开发服务器** | ✅ `/api/*` 网关 + 静态白名单 | `server.js` | 随 API 实现持续复用 |
| **Netlify Functions 网关** | ✅ v2 单入口已接通路由 | `netlify/functions/api.mjs` | M1 安装 `@netlify/functions` |
| **健康检查与全服时钟 API** | ✅ 真实可运行 | `GET /api/v1/health`, `GET /api/v1/world/state` | M3 叠加祈愿召唤事件 |
| **游客/注册/登录/升级绑定** | 📐 契约桩 (`501`) + 服务接口 | `backend/auth/auth_service.mjs`, `routes/auth.mjs` | M1 完整实现 |
| **云存档同步与合并导出** | 📐 契约桩 (`501`) + Schema 校验 | `backend/domain/save_merge_service.mjs`, `js/cloud_sync.js` | M1 完整实现 |
| **捕获审计/商店/离线水族箱** | 📐 契约桩 (`501`) + 风控规则 | `backend/domain/economy_validator.mjs`, `aquarium_service.mjs` | M2 完整实现 |
| **排行榜/成就/水族箱分享** | 📐 契约桩 (`501`) + 领域契约 | `backend/domain/leaderboard_service.mjs`, `social_service.mjs` | M3 完整实现 |
| **构建/自检/测试/CI 流水线** | ✅ 零依赖自动化运行 | `scripts/*.mjs`, `tests/**/*.test.mjs`, `.github/workflows/ci.yml` | 随 M1~M4 扩充用例 |

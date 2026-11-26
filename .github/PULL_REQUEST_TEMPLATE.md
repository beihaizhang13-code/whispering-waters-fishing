## 变更说明
<!-- 请简要描述本次变更解决的问题、实现的功能或优化点 -->

## 变更类型
- [ ] 前端玩法 / 视觉表现 (`js/`, `css/`, `index.html`)
- [ ] 前后端共享契约 (`shared/`)
- [ ] 后端领域服务 / 接口路由 (`backend/`, `netlify/functions/`, `server.js`)
- [ ] 数据库迁移 / 种子 (`db/`, `netlify/database/`)
- [ ] 工程脚本 / CI / 文档 (`scripts/`, `.github/`, `docs/`)

## 架构与数据一致性检查
- [ ] 若修改了鱼种、装备、价格或概率参数，是否已同步更新 `shared/game_catalog.js` 并跑通 `catalog_consistency` 测试？
- [ ] 若新增或修改数据库结构，是否同时更新了 `db/migrations/sqlite/` 与 `db/migrations/postgres/`，且**未修改**已上线过的历史迁移文件？
- [ ] 若修改了 API 路径或字段，是否已同步更新 `docs/04-api-contract.md`？
- [ ] 确认未提交 `.env`、真实密钥、本地 `.sqlite` 数据库或临时压缩包。

## 本地验证结果
- [ ] `node scripts/build.mjs`
- [ ] `node scripts/verify.mjs`
- [ ] `node --test tests/unit/*.test.mjs tests/contract/*.test.mjs tests/integration/*.test.mjs`

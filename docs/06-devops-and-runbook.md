# 06. 本地开发、部署上线与运维手册 (DevOps & Runbook)

## 1. 本地零依赖开发与验证（仅需 Node.js 24+）

当前项目所有基座脚本均基于 **Node.js v24+** 原生能力构建（`node:sqlite`、`node:test`、`node:crypto`），在尚未安装 `npm` 或 Docker 的 Windows/macOS/Linux 环境中均可直接运行：

```bash
# 1. 复制环境变量模板（按需修改）
cp .env.example .env

# 2. 初始化或更新本地 SQLite 数据库 (默认写入 ./data/whispering_waters.sqlite)
node scripts/db_migrate_local.mjs

# 3. 构建静态发布目录 dist/
node scripts/build.mjs

# 4. 启动本地全栈开发服务器（同时提供前端页面与 /api/v1/* 接口）
node server.js
# 浏览器打开: http://127.0.0.1:18888/index.html
# 健康检查:   http://127.0.0.1:18888/api/v1/health
# 全服时钟:   http://127.0.0.1:18888/api/v1/world/state

# 5. 运行全仓工程自检与全部自动化测试
node scripts/verify.mjs
node --test tests/unit/*.test.mjs tests/contract/*.test.mjs tests/integration/*.test.mjs
```

> 若系统已安装完整 Node.js + npm，也可直接使用等价命令：`npm run dev`、`npm run build`、`npm run verify`、`npm test`、`npm run db:migrate:local`。

---

## 2. 线上 Netlify 全栈部署上线步骤（进入 M1 时执行）

1. **安装运行环境与官方 SDK**：
   - 确保本机安装了包含 `npm` 的官方 Node.js 24 LTS，以及 `netlify-cli`（`>= 26.0.0`）。
   - 在仓库根目录安装 Netlify 运行时依赖：
     ```bash
     npm install @netlify/functions @netlify/database
     ```
2. **初始化并晋升 Postgres 迁移**：
   - 参照 [netlify/database/README.md](../netlify/database/README.md) 将 `db/migrations/postgres/20261126000100_initial_schema.sql` 与种子晋升到 `netlify/database/migrations/`。
   - 使用 `netlify dev` 在本地拉起模拟数据库并运行 `netlify database migrations apply` 验证。
3. **配置 Netlify Secrets（禁止明文入库）**：
   ```bash
   netlify env:set STORAGE_DRIVER postgres
   netlify env:set AUTH_SESSION_SECRET "<32+字节高熵随机串>" --secret
   netlify env:set AUTH_GUEST_TOKEN_SECRET "<32+字节高熵随机串>" --secret
   netlify env:set FEATURE_CLOUD_SYNC true
   ```
4. **发布验证**：
   - 推送分支触发 Netlify Deploy Preview，检查构建日志中的迁移应用记录；
   - 部署成功后立即请求 `https://<your-site>/api/v1/health` 确认 `storage.ok === true` 且 `storageDriver === "postgres"`。

---

## 3. 可观测性与健康检查

- **健康探针**：`GET /api/v1/health` 返回：
  - `status`: `"ok"`
  - `catalogVersion`: 与 `shared/game_catalog.js` 对齐的版本号
  - `storageDriver`: `"sqlite"` 或 `"postgres"`
  - `storage.ok`: 数据库连通性探针结果
- **单行结构化 JSON 日志**：每次 API 请求均输出包含 `ts`、`level`、`requestId`、`method`、`pathname`、`status`、`durationMs` 的日志，可通过 `requestId` 串联排查任意 4xx/5xx 故障。

---

## 4. 常见问题与应急 Runbook

| 故障现象 | 可能原因 | 排查与恢复动作 |
| :--- | :--- | :--- |
| Netlify 部署报错 `migration has been modified` | 修改了已上线过的 `netlify/database/migrations/*.sql` 文件 | 立即恢复原迁移文件内容；所有表结构变更只能追加新的时间戳 SQL 文件 |
| `/api/v1/health` 返回 `storage.ok: false` | `NETLIFY_DB_URL` 未注入或 `@netlify/database` 未安装 | 检查 `package.json` 依赖与 Netlify 控制台 Data & Storage > Database 绑定状态 |
| 本地 `server.js` 返回 `403 Forbidden` | 访问了静态白名单之外的目录（如 `/backend/`、`/.env`）或包含 `..` | 属于预期安全拦截；静态资源只允许放在 `css/`、`js/`、`shared/` 或白名单根目录文件 |
| `verify.mjs` 提示 `dist 产物与源码不一致` | 修改了 `index.html` / `js/` / `shared/` 但忘记重新构建 `dist/` | 运行 `node scripts/build.mjs` 后再提交或验证 |

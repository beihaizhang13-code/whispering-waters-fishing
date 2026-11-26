# Netlify Database 迁移晋升说明

## 为什么当前迁移放在 `db/migrations/postgres/` 而不是直接放在 `netlify/database/migrations/`？

Netlify Database 会自动扫描并执行 `netlify/database/migrations/` 中的所有 SQL 文件，并且会对已执行文件记录校验和（checksum）：
1. **未安装 `@netlify/database` 前**，Netlify 部署不会自动开通托管 Postgres 实例；
2. **任何对已执行迁移文件的修改或删除**，都会导致后续 Netlify 部署因 checksum drift 而直接失败。

因此在 **M0 基座阶段**，我们把尚未冻结的 Postgres DDL 保存在：
- `db/migrations/postgres/20261126000100_initial_schema.sql`

本地开发则零依赖运行 SQLite 镜像：
- `db/migrations/sqlite/0001_initial_schema.sql`

---

## 进入 M1 启用线上 Netlify Database 时的标准流程

1. 安装官方依赖（需已安装完整 Node.js / npm）：
   ```bash
   npm install @netlify/functions @netlify/database
   ```
   或直接运行：
   ```bash
   netlify database init --yes
   ```
2. 将 `db/migrations/postgres/20261126000100_initial_schema.sql`（及必要的种子 SQL）复制进 `netlify/database/migrations/`，确保文件名前缀为递增时间戳。
3. 严禁修改已经部署上线过的迁移文件；后续结构演进一律追加新的时间戳迁移文件（例如 `netlify database migrations new -d "..."`）。
4. 在 Netlify Site Environment Variables 中设置 `STORAGE_DRIVER=postgres` 以及认证相关 Secrets。

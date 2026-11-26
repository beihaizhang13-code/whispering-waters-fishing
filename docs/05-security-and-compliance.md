# 05. 安全防线、防护策略与数据合规清单

## 1. 认证与会话安全

| 防线维度 | 规范要求 | 落地位置 |
| :--- | :--- | :--- |
| **密码存储** | 使用 Node.js 原生 `crypto.scrypt`（随机 16 字节盐，N=16384），校验时使用 `crypto.timingSafeEqual` 防时序攻击 | `backend/auth/auth_service.mjs` (M1) |
| **会话与游客令牌** | 仅向客户端返回高熵随机 Token；数据库 `sessions.token_hash` 仅存 **SHA-256 哈希**，即使拖库也无法反推有效凭证 | `db/migrations/*/0001_initial_schema.sql` |
| **日志脱敏** | 所有结构化日志在序列化前自动递归将 `password`/`secret`/`token`/`authorization`/`cookie` 替换为 `[REDACTED]` | `backend/observability/logger.mjs` |
| **同源与 CSRF** | 所有 `POST`/`PUT`/`DELETE` 状态变更请求经过 `verifySameOrigin()` 检查 `Origin`；若启用 HttpOnly Cookie 会话，必须配合 `SameSite=Lax` + `Secure` + 同源校验 | `backend/http/middleware.mjs` |

---

## 2. 限流、静默降级与输入清洗

1. **分级限流**：
   - 登录/注册/升级接口：建议单 IP 每分钟 `<= 10` 次（防撞库与批量建游客垃圾号）；
   - 捕鱼上报/商店/排行榜接口：默认单会话每分钟 `<= 120` 次（`RATE_LIMIT_WINDOW_SEC` / `RATE_LIMIT_MAX_REQ` 可调）。
2. **输入清洗**：
   - API 网关限制请求体最大 `2 MB`（`server.js` 与 Functions 统一约束）；
   - 所有存档 JSON 均经 `shared/save_schema.js` 白名单拷贝与数值上下界裁剪，彻底拒绝原型链污染 (`__proto__` / `constructor`) 与超界参数。

---

## 3. 静态服务与 Web 安全响应头

1. **本地开发服务器 (`server.js`) 路径遍历防护**：
   - 仅开放显式白名单：`/`, `/index.html`, `/manifest.webmanifest`, `/css/*`, `/js/*`, `/shared/*`；
   - 使用 `path.resolve` 前缀断言，拦截任何包含 `..`、`\0`、或试图访问 `.env`、`.git/`、`backend/`、`db/`、`data/`、`archive/` 的请求并返回 `403`。
2. **Netlify CDN 安全头 (`netlify.toml`)**：
   - 已配置 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`；
   - `Content-Security-Policy` 兼容当前 `cdn.tailwindcss.com`、`cdnjs.cloudflare.com` (Tone.js) 与 Google Fonts；
   - **M4 安全强化计划**：在 M4 将 Tailwind CSS 构建为本地静态 CSS 产物并本地托管 Tone.js 后，从 CSP 中移除外部 CDN 与 `style-src 'unsafe-inline'`，并启用 Subresource Integrity (SRI) 或全本地同源策略。

---

## 4. 玩家数据隐私与合规清单

- [ ] **最小化采集**：游客模式不收集邮箱、手机号或真实姓名；仅记录匿名 `guest_device` 标识与游玩存档。
- [ ] **数据可携带权（导出/导入）**：通过 `GET /api/v1/save/export` 随时导出完整个人 JSON 存档包。
- [ ] **被遗忘权（账号注销）**：通过 `DELETE /api/v1/auth/account` 触发账号软删除或硬清理（吊销全部 `sessions`、脱敏 `auth_identities`、匿名化公开排行榜或清除个人分享快照 `aquarium_shares`）。
- [ ] **环境变量与 Secrets 隔离**：线上 `AUTH_SESSION_SECRET`、`AUTH_GUEST_TOKEN_SECRET`、`NETLIFY_DB_URL` 和 OAuth Client Secret 一律配置在 Netlify Secrets 中，严禁写入 `netlify.toml` 或客户端脚本。

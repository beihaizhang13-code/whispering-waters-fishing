# 04. REST API 契约规范 (`/api/v1/*`)

## 1. 通用约定

- **基础路径**：`/api/v1`（同域部署，本地与线上一致）。
- **请求头约定**：
  - `Content-Type: application/json`
  - `Authorization: Bearer <sessionToken>`（正式/已登录会话）或 `X-Guest-Token: <guestToken>`（游客凭证）
  - `Idempotency-Key: <uuid>`（写账本或非天然幂等的 `POST` 动作必传）
  - `X-Client-Version: <version>`（客户端版本标识）
- **统一响应信封**：
  ```json
  // 成功 (2xx)
  {
    "ok": true,
    "data": { },
    "meta": {
      "requestId": "req_...",
      "serverTime": "2026-11-26T03:00:00.000Z"
    }
  }

  // 失败 (4xx / 5xx)
  {
    "ok": false,
    "error": {
      "code": "SAVE_CONFLICT",
      "message": "云端存档版本已更新，请先拉取合并后再覆盖",
      "details": { }
    },
    "meta": {
      "requestId": "req_...",
      "serverTime": "2026-11-26T03:00:00.000Z"
    }
  }
  ```

---

## 2. 路由总览与状态表

> 状态标记说明：`LIVE (M0)` 表示已在当前骨架真实可运行；`STUB (Mx)` 表示路由与错误信封已就绪（当前返回 `501 NOT_IMPLEMENTED`），将在对应里程碑填充持久化实现。

### 2.1 系统与全服世界事件

| 方法与路径 | 状态 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/health` | `LIVE (M0)` | 公开 | 服务状态、目录版本 `catalogVersion`、存储驱动健康度与功能开关 |
| `GET /api/v1/world/state` | `LIVE (M0)` | 公开 | 返回当前确定性全服天气周期、下期天气与黄金鱼潮倒计时 |
| `POST /api/v1/world/golden-tide/summon` | `STUB (M3)` | 需鉴权 + 幂等 | 消耗 `8` 幸运值或 `180` 金币召唤 60 秒全服黄金鱼潮 |

### 2.2 账号与游客升级 (`/api/v1/auth/*`)

| 方法与路径 | 状态 | 鉴权 | 核心请求体 / 响应说明 |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/auth/guest` | `STUB (M1)` | 公开 | 签发匿名游客 `userId` 与 `guestToken` |
| `POST /api/v1/auth/register` | `STUB (M1)` | 公开 | `{ email, password, displayName, guestToken?, localSave? }` |
| `POST /api/v1/auth/login` | `STUB (M1)` | 公开 | `{ email, password }`，返回用户摘要与会话凭证 |
| `POST /api/v1/auth/logout` | `STUB (M1)` | 需鉴权 | 吊销当前 `session` |
| `POST /api/v1/auth/upgrade` | `STUB (M1)` | 需鉴权 | 游客账号原地绑定邮箱或 OAuth 身份并触发存档无损合并 |
| `GET /api/v1/auth/me` | `STUB (M1)` | 需鉴权 | 获取当前用户信息、绑定身份列表与账户状态 |
| `DELETE /api/v1/auth/account` | `STUB (M1)` | 需鉴权 | 合规账号注销与数据清理确认 |
| `GET /api/v1/auth/oauth/:provider` | `STUB (M1)` | 公开 | OAuth 授权跳转占位 (`google` / `github`) |

### 2.3 云存档同步与数据导出 (`/api/v1/save*`)

| 方法与路径 | 状态 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/save` | `STUB (M1)` | 需鉴权 | 拉取云存档 `snapshot`、`revision` 与待结算离线水族箱预估 |
| `PUT /api/v1/save` | `STUB (M1)` | 需鉴权 | 携带 `{ baseRevision, snapshot }` 推送；版本不一致返回 `409 SAVE_CONFLICT` |
| `POST /api/v1/save/merge` | `STUB (M1)` | 需鉴权 | 冲突恢复与多端合并 `{ localSnapshot, strategy }` |
| `GET /api/v1/save/export` | `STUB (M1)` | 需鉴权 | 导出带校验签名的标准 JSON 个人存档包 |
| `POST /api/v1/save/import` | `STUB (M1)` | 需鉴权 | 校验并导入 JSON 存档包 |

### 2.4 混合权威玩法与经济校验 (`/api/v1/gameplay/*`)

| 方法与路径 | 状态 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/gameplay/catches` | `STUB (M2)` | 需鉴权 + 幂等 | 上报 `{ clientCatchUid, fishId, biomeId, depthZone, baitId, lengthCm, weightKg, isShiny, disposition }` |
| `POST /api/v1/gameplay/shop/purchase` | `STUB (M2)` | 需鉴权 + 幂等 | 购买鱼饵或升级钓竿/卷线器/船只/服饰，服务端重算扣款 |
| `POST /api/v1/gameplay/orders/deliver` | `STUB (M2)` | 需鉴权 + 幂等 | 交付码头悬赏订单并原子发放赏金与幸运值 |
| `POST /api/v1/gameplay/aquarium/claim-offline` | `STUB (M2)` | 需鉴权 + 幂等 | 按 UTC 时间差结算并领取离线水族箱门票金币 |
| `POST /api/v1/gameplay/aquarium/feed` | `STUB (M2)` | 需鉴权 + 幂等 | 扣除 `15` 金币使水族箱全员体型与价值 `+8%` |
| `POST /api/v1/gameplay/aquarium/upgrade` | `STUB (M2)` | 需鉴权 + 幂等 | 扩建水族箱容量等级（1..5 级） |

### 2.5 排行榜、成就与水族箱分享

| 方法与路径 | 状态 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/leaderboards/me` | `STUB (M3)` | 需鉴权 | 查询本人各榜单当前排名与个人最佳成绩 |
| `GET /api/v1/leaderboards/species/:fishId` | `STUB (M3)` | 公开 | 单鱼种最重/最长榜（支持 `?metric=weight\|length&limit=50`） |
| `GET /api/v1/leaderboards/:boardType` | `STUB (M3)` | 公开 | 综合榜 (`encyclopedia` / `wealth` / `bounty_master`) |
| `GET /api/v1/achievements` | `STUB (M3)` | 需鉴权 | 查询 12 项成就的进度、解锁与领奖状态 |
| `POST /api/v1/achievements/:code/claim` | `STUB (M3)` | 需鉴权 + 幂等 | 领取已解锁成就奖励 |
| `POST /api/v1/aquarium/shares` | `STUB (M3)` | 需鉴权 | 生成当前水族箱的只读 `shareCode` 公开展示快照 |
| `GET /api/v1/aquarium/shares/:shareCode` | `STUB (M3)` | 公开 | 游客/好友浏览分享的水族箱配置与展览鱼列表 |
| `POST /api/v1/aquarium/shares/:shareCode/like` | `STUB (M3)` | 公开 + 幂等 | 为分享的水族箱点赞 |

---

## 3. 统一错误码总表 (见 `shared/error_codes.js`)

| 错误码 | HTTP 状态 | 触发场景与客户端处理建议 |
| :--- | :---: | :--- |
| `VALIDATION_ERROR` | `400` | 请求参数缺失、JSON 解析失败或存档结构违法 |
| `UNAUTHORIZED` | `401` | 未携带有效会话或 Token 已过期，客户端刷新或重新申请游客会话 |
| `FORBIDDEN` | `403` | 来源 Origin 未通过 CSRF 检查或账号无权限 |
| `NOT_FOUND` | `404` | 路由不存在或指定分享码/资源不存在 |
| `METHOD_NOT_ALLOWED` | `405` | 路由存在但 HTTP 方法不匹配 |
| `SAVE_CONFLICT` | `409` | `PUT /api/v1/save` 检测到 `baseRevision` 过期，应自动拉取并走 `/save/merge` |
| `IDEMPOTENCY_CONFLICT` | `409` | 同一 `Idempotency-Key` 携带了不同业务参数重复请求 |
| `ANTICHEAT_REJECTED` | `422` | 捕鱼海域、鱼体数值或库存不合法，拒绝入账 |
| `RATE_LIMITED` | `429` | 超出请求频率限制，退避重试 |
| `INTERNAL_ERROR` | `500` | 未预期服务端异常，通过 `meta.requestId` 检索日志 |
| `NOT_IMPLEMENTED` | `501` | M0 骨架阶段的业务契约桩路由，前端应保持本地单机降级 |

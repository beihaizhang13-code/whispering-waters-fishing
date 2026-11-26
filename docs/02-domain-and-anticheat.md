# 02. 领域模型、混合权威与防作弊设计

## 1. 游客即玩与账号升级合并机制

为保证用户打开网页即可零门槛垂钓（符合休闲游戏体验），同时支持跨设备同步与排行榜认证，系统采用 **“游客优先 + 无损绑定升级”** 模型：

1. **首次进入**：
   - 未登录玩家先以本地 `localStorage` 开局；当网络可用且启用云同步时，客户端调用 `POST /api/v1/auth/guest` 获取一个随机高熵 `guestToken`（服务端仅存 SHA-256 哈希于 `sessions` 和 `auth_identities(provider='guest_device')`）。
2. **绑定正式账号（`POST /api/v1/auth/upgrade` 或注册/登录合并）**：
   - 玩家点击“绑定邮箱”或第三方 OAuth 后：
     - **情况 A（游客升级为新正式账号）**：在事务中将原 `users.account_type` 从 `'guest'` 更新为 `'registered'`，并新增 `email_password` / `google` / `github` 的 `auth_identities` 记录，保留全部云端进度与历史流水。
     - **情况 B（游客或本地存档并入已有正式账号）**：将游客账号标记为 `merged_into_user_id = targetUserId`，并触发 `SaveMergeService.mergeSnapshots()`：
       - `records`（图鉴记录）：按 `fishId` 取并集，`maxKg` / `maxLen` 取最大值，`count` / `shinyCount` 合并去重；
       - `unlockedBoats` / `unlockedHats` / `unlockedOutfits`：取集合并集；
       - `rodLevel` / `reelLevel` / `aquariumLevel`：取两者较高值；
       - `coins` / `luckPoints` / `basket` / `aquarium`：防止用多个临时游客反复刷初始 80 金币并入主号——系统记录合并来源，同一主号限制游客并发合并配额，若合并带来余额调整则在 `economy_ledger` 记一笔 `save_merge_adjustment`。

---

## 2. 云存档乐观锁与冲突解决

- **乐观锁字段**：`player_saves.revision`（从 `1` 递增的整数）。
- **正常同步**：客户端 `PUT /api/v1/save` 必须携带 `baseRevision`。只有当 `db.revision === baseRevision` 时更新成功并返回 `revision + 1`。
- **冲突场景（`409 SAVE_CONFLICT`）**：例如玩家在手机与电脑同时挂机，另一端已经推进了 `revision`。服务端拒绝直接覆盖，返回云端最新快照与 `serverRevision`，由前端调用 `POST /api/v1/save/merge`（安全并集策略）生成新合并快照后再推送。
- **格式与边界防守**：所有上传与合并后的快照必须经过 `shared/save_schema.js` 的 `sanitizeAndValidateSave()` 检查，拒绝超出物理目录范围的等级（`>5`）、未定义道具 ID、负数金币或超容量水族箱。

---

## 3. 水族箱离线门票收益结算公式

当前单机版仅在网页打开时每秒增加 `aquariumUnclaimedCoins`。引入后端后，补充**服务端权威离线挂机结算**，防止通过修改本地时间刷金币：

1. **单位分钟门票产出**（与 `shared/game_catalog.js` 一致）：
   $$\text{BaseRate} = \sum_{f \in \text{aquarium}} \left(\text{RARITIES}[f.\text{rarity}].\text{aquariumIncome} \times \text{ShinyFactor}(f)\right)$$
   其中 $\text{ShinyFactor}(f) = 1.5$（闪光异色鱼）或 $1.0$（普通鱼），也可按成长投喂后的 `value` 比例加成设置明确封顶（单条鱼不超过同种基准值的 2.5 倍）。
2. **等级倍率**：
   $$\text{PerMinuteIncome} = \text{BaseRate} \times \text{AQUARIUM\_UPGRADES}[\text{aquariumLevel}].\text{incomeMult}$$
3. **离线有效时长**：
   $$\Delta t = \min\Big(\max(0, t_{\text{server\_now}} - t_{\text{aquarium\_last\_settled\_at}}),\ \text{OFFLINE\_AQUARIUM\_MAX\_HOURS} \times 3600\Big)$$
   默认 `OFFLINE_AQUARIUM_MAX_HOURS = 24` 小时，超过 24 小时不再继续累积（鼓励回流领取）。
4. **原子领奖**：在事务内更新 `aquarium_last_settled_at = NOW()`、累加 `coins` 并写入 `economy_ledger(event_type='aquarium_offline_claim')`，以 `Idempotency-Key` 保证重试不重复发币。

---

## 4. 混合权威防作弊模型

本游戏的核心乐趣在于 60fps 抛竿与遛鱼手操，因此**不把每一帧物理循环搬到服务端**，而是对**“结果入账与榜单提交”**实施服务端混合权威校验：

| 校验维度 | 具体防线 | 违规处理 |
| :--- | :--- | :--- |
| **海域可达性校验** | 上报捕鱼位于 `islet` (1200–1800) 或 `abyss` (1800–2400) 时，服务端检查 `player_saves` 中 `unlockedBoats` 是否含船只 | 拒绝入账并返回 `422 ANTICHEAT_REJECTED` |
| **物种数值边界** | 检查 `fishId` 存在于 `FISH_BY_ID`，`lengthCm`、`weightKg` 落在 `[min*0.5, max*1.25]` 合理区间（考虑喂养成长外的外在限制） | 标记 `validation_status = 'rejected'` 并记审计日志 |
| **价值服务端重算** | 不采信客户端上传的金币售价，由服务端按 `FISH_SPECIES[fishId].baseValue`、尺寸比例、Shiny 标志与当前服务端全服 `goldenTide` 状态重算 | 杜绝篡改内存或抓包改价 |
| **鱼饵与库存校验** | 使用非免费鱼饵（`worm`/`gold`/`star`）上报捕鱼时，在事务内检查并原子扣减库存 | 库存不足则回退按 `dough` 逻辑或拒绝高阶增益 |
| **频次与速率风控** | 单账号每分钟上报捕鱼次数超过人类物理极限（如最短蓄力+咬钩+遛鱼周期内连续高频上报） | 触发 `flagged` 标记并写入 `audit_security_events` |
| **榜单审核隔离** | `leaderboard_records` 仅展示 `audit_status = 'verified'` 的记录；疑似异常账号成绩自动降级为 `flagged` 待核查 | 保护全服榜单公信力 |

---

## 5. 全服确定性天气与黄金鱼潮时钟

为避免多实例 Serverless 函数之间出现“A 玩家看到雷暴、B 玩家看到晴天”的漂移，全服天气采用 **`shared/world_clock.js` 无状态确定性算法**：

- **全服天气周期**：每 `15 分钟` 轮换一次，基于 `floor(utcNowMs / 900000)` 与 `WORLD_CLOCK_SEED` 进行 FNV-1a 32 位哈希并映射概率分布：`sunny` (45%)、`rain` (27%)、`storm` (16%)、`meteor` (12%)。
- **自然黄金鱼潮**：每小时自动触发一次持续 `3 分钟` 的全服自然黄金鱼潮（窗口偏移同样由小时索引确定性计算）。
- **玩家祈愿鱼潮叠加**：当玩家在 M3 调用 `POST /api/v1/world/golden-tide/summon` 消耗幸运值或金币祈愿时，写入 `world_events` 一条持续 `60 秒` 的记录，查询 `/api/v1/world/state` 时自动取自然鱼潮与祈愿鱼潮的最晚结束时间对外广播。

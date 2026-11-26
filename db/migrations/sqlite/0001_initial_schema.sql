-- ============================================================================
-- 《微风垂钓物语 2.0》本地 SQLite 初始化建表迁移 (Node 24 node:sqlite 镜像)
-- 文件: db/migrations/sqlite/0001_initial_schema.sql
-- 说明: 与 db/migrations/postgres/20261126000100_initial_schema.sql 保持 1:1 语义一致
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 1. 玩家主表 (支持游客与正式账号平滑升级)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('guest', 'registered')),
  display_name TEXT NOT NULL,
  avatar_frame TEXT NOT NULL DEFAULT 'straw',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_delete', 'deleted')),
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  merged_into_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_merged_into ON users(merged_into_user_id);

-- 2. 多重认证凭据表 (游客令牌 / 邮箱密码 / 第三方 OAuth 解耦绑定)
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('guest_device', 'email_password', 'google', 'github')),
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  password_hash TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identities_email_unique
  ON auth_identities(email)
  WHERE email IS NOT NULL AND provider = 'email_password';

-- 3. 会话令牌表 (仅存 Token SHA-256 哈希，绝不存明文会话密钥)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 4. 云存档快照表 (单行文档 + 乐观锁 revision + 水族箱离线结算时间戳)
CREATE TABLE IF NOT EXISTS player_saves (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 2 CHECK (schema_version >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  coins INTEGER NOT NULL DEFAULT 80 CHECK (coins >= 0),
  luck_points INTEGER NOT NULL DEFAULT 0 CHECK (luck_points >= 0),
  aquarium_level INTEGER NOT NULL DEFAULT 1 CHECK (aquarium_level BETWEEN 1 AND 5),
  aquarium_last_settled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  species_unlocked_count INTEGER NOT NULL DEFAULT 0 CHECK (species_unlocked_count >= 0),
  total_catches INTEGER NOT NULL DEFAULT 0 CHECK (total_catches >= 0),
  save_payload TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_player_saves_updated_at ON player_saves(updated_at DESC);

-- 5. 渔获防作弊审计流水表 (支持 client_catch_uid 幂等去重)
CREATE TABLE IF NOT EXISTS catch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_catch_uid TEXT NOT NULL,
  fish_id TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'mythic')),
  biome_id TEXT NOT NULL,
  depth_zone INTEGER NOT NULL CHECK (depth_zone BETWEEN 0 AND 2),
  bait_id TEXT NOT NULL,
  weather_id TEXT NOT NULL,
  is_golden_tide INTEGER NOT NULL DEFAULT 0 CHECK (is_golden_tide IN (0, 1)),
  is_shiny INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
  length_cm REAL NOT NULL CHECK (length_cm > 0),
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  computed_value INTEGER NOT NULL CHECK (computed_value >= 0),
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK (disposition IN ('pending', 'sold', 'aquarium', 'basket', 'released', 'order')),
  validation_status TEXT NOT NULL DEFAULT 'verified' CHECK (validation_status IN ('verified', 'flagged', 'rejected')),
  validation_reason TEXT,
  caught_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, client_catch_uid)
);

CREATE INDEX IF NOT EXISTS idx_catch_logs_user_caught ON catch_logs(user_id, caught_at DESC);
CREATE INDEX IF NOT EXISTS idx_catch_logs_fish_weight ON catch_logs(fish_id, weight_kg DESC);

-- 6. 经济账本流水表 (只追加 Append-Only，覆盖金币/幸运值/鱼饵/购买/离线收益)
CREATE TABLE IF NOT EXISTS economy_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'catch_sell',
      'catch_release',
      'aquarium_offline_claim',
      'aquarium_feed',
      'aquarium_upgrade',
      'shop_purchase',
      'bounty_deliver',
      'golden_tide_summon',
      'achievement_claim',
      'save_merge_adjustment'
    )
  ),
  coins_delta INTEGER NOT NULL DEFAULT 0,
  luck_delta INTEGER NOT NULL DEFAULT 0,
  coins_after INTEGER NOT NULL CHECK (coins_after >= 0),
  luck_after INTEGER NOT NULL CHECK (luck_after >= 0),
  reference_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_economy_ledger_user_created ON economy_ledger(user_id, created_at DESC);

-- 7. 多维度排行榜聚合表
CREATE TABLE IF NOT EXISTS leaderboard_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_type TEXT NOT NULL CHECK (board_type IN ('species_weight', 'species_length', 'encyclopedia', 'wealth', 'bounty_master')),
  scope_key TEXT NOT NULL DEFAULT 'global',
  score_numeric REAL NOT NULL DEFAULT 0,
  display_name_snapshot TEXT NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  audit_status TEXT NOT NULL DEFAULT 'verified' CHECK (audit_status IN ('verified', 'flagged', 'rejected')),
  achieved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, board_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
  ON leaderboard_records(board_type, scope_key, audit_status, score_numeric DESC, achieved_at ASC);

-- 8. 全服祈愿事件记录表 (与确定性世界时钟配合)
CREATE TABLE IF NOT EXISTS world_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('golden_tide_summon', 'system_weather_override')),
  triggered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_world_events_active ON world_events(event_type, ends_at DESC);

-- 9. 成就定义目录表
CREATE TABLE IF NOT EXISTS achievement_definitions (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  target_value INTEGER NOT NULL DEFAULT 1 CHECK (target_value >= 1),
  reward_coins INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  reward_luck INTEGER NOT NULL DEFAULT 0 CHECK (reward_luck >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 10. 玩家成就进度与领奖表
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_code TEXT NOT NULL REFERENCES achievement_definitions(code) ON DELETE CASCADE,
  progress_value INTEGER NOT NULL DEFAULT 0 CHECK (progress_value >= 0),
  unlocked_at TEXT,
  claimed_at TEXT,
  PRIMARY KEY (user_id, achievement_code)
);

-- 11. 水族箱只读分享卡片表
CREATE TABLE IF NOT EXISTS aquarium_shares (
  id TEXT PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner_display_name TEXT NOT NULL,
  aquarium_level INTEGER NOT NULL CHECK (aquarium_level BETWEEN 1 AND 5),
  snapshot_json TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  views_count INTEGER NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_aquarium_shares_user ON aquarium_shares(user_id, created_at DESC);

-- 12. 安全与风控审计日志表
CREATE TABLE IF NOT EXISTS audit_security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'high', 'critical')),
  ip_hash TEXT,
  request_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_security_created ON audit_security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_security_user ON audit_security_events(user_id, created_at DESC);

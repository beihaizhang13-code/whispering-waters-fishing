-- ============================================================================
-- 《微风垂钓物语 2.0》初始化种子数据 (SQLite 与 PostgreSQL 通用幂等 SQL)
-- 与 shared/game_catalog.js 中 ACHIEVEMENTS 保持一致
-- ============================================================================

INSERT INTO achievement_definitions (code, title, description, category, target_value, reward_coins, reward_luck, sort_order)
VALUES
  ('first_catch', '初试锋芒', '成功钓起人生第 1 条鱼', 'fishing', 1, 40, 2, 1),
  ('encyclopedia_5', '浅水观察家', '解锁 5 种不同鱼类图鉴', 'collection', 5, 80, 2, 2),
  ('encyclopedia_12', '微风博物学者', '解锁 12 种不同鱼类图鉴', 'collection', 12, 220, 5, 3),
  ('encyclopedia_20', '全生态宗师', '集齐全部 20 种生态鱼类图鉴', 'collection', 20, 800, 15, 4),
  ('first_shiny', '异色星光', '首次捕获闪光异色 (Shiny) 鱼类', 'rarity', 1, 150, 4, 5),
  ('first_legendary', '传说邂逅', '首次捕获传说品级大鱼', 'rarity', 1, 260, 6, 6),
  ('first_mythic', '神话降临', '首次捕获神话品级鱼王', 'rarity', 1, 600, 12, 7),
  ('sail_abyss', '深海远航者', '购置船只并航行至星渊沉船湾', 'explore', 1, 120, 3, 8),
  ('aquarium_lv3', '生态馆主', '将观赏水族箱扩建至 3 级或以上', 'aquarium', 3, 200, 4, 9),
  ('aquarium_share', '海洋名片', '生成并分享 1 次个人水族箱展示链接', 'social', 1, 100, 3, 10),
  ('bounty_10', '老船长的挚友', '累计完成 10 次码头悬赏订单', 'orders', 10, 300, 8, 11),
  ('release_25', '碧波祈福者', '累计放生 25 条鱼积累祈福幸运', 'karma', 25, 180, 10, 12)
ON CONFLICT (code) DO NOTHING;

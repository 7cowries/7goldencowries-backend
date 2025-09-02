BEGIN;

INSERT OR IGNORE INTO quests (code, title, xp, type, requirement, active, url)
VALUES
  ('JOIN_TELEGRAM', 'Join our Telegram', 30, 'social', 'join_telegram', 1, 'https://t.me/GOLDENCOWRIEBOT'),
  ('JOIN_DISCORD',  'Join our Discord',  30, 'social', 'join_discord',  1, 'https://discord.gg/YOURINVITECODE'),
  ('LINK_TWITTER',  'Follow us on X',    10, 'social', 'follow_x',      1, 'https://x.com/7goldencowries');

COMMIT;

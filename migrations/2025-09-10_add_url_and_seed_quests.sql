BEGIN;
-- Add url column if missing (ignore error if already exists)
ALTER TABLE quests ADD COLUMN url TEXT;
-- Backfill URLs for known quests
UPDATE quests SET url='https://x.com/7goldencowries' WHERE id=1;
UPDATE quests SET url='https://x.com/7goldencowries/status/194759' WHERE id=2;
UPDATE quests SET url='https://x.com/7goldencowries/status/194759' WHERE id=3;
UPDATE quests SET url='https://t.me/7goldencowries' WHERE id=4;
UPDATE quests SET url='/quests/onchain' WHERE id=5;
-- Seed example daily quests
INSERT OR IGNORE INTO quests (id, title, kind, xp, url, active, sort)
VALUES
  (41,'Daily sample quest 1','link',20,'https://example.com/daily1',1,41),
  (42,'Daily sample quest 2','link',30,'https://example.com/daily2',1,42);
COMMIT;

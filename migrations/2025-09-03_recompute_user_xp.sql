-- Backfill users.xp ONLY when missing, preserve existing bonuses & multipliers
UPDATE users
SET xp = (
  SELECT COALESCE(SUM(q.xp), 0)
  FROM completed_quests c
  JOIN quests q ON q.id = c.quest_id
  WHERE c.wallet = users.wallet
)
WHERE (xp IS NULL OR xp = 0);

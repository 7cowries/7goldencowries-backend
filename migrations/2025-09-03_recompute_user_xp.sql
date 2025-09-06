-- Recompute XP totals for all users based on completed quests
UPDATE users
SET xp = (
  SELECT COALESCE(SUM(q.xp), 0)
  FROM completed_quests c
  JOIN quests q ON q.id = c.quest_id
  WHERE c.wallet = users.wallet
);

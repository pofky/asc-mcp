-- When a trial user was last written to about their trial ending.
--
-- Six trials have been minted since August 2026 and not one of them converted.
-- Nothing was wrong with the paywall; nothing ever reached the person again.
-- A trial that expires while someone is busy simply stops working, on a day
-- they had no reason to look at, and the only place the price appears after
-- that is inside a tool call they have to make first. Most never do.
--
-- Two timestamps rather than one flag, because they mark two different
-- messages: one the day before expiry, while the key still works and the
-- decision is cheap, and one the day after, which is the only chance to say
-- "here is what stopped working, and what it costs to turn it back on".
--
-- Nullable and never reset. They exist to make the daily cron idempotent: a run
-- that fires twice, or a deploy that replays it, must not mail anyone twice.
ALTER TABLE licenses ADD COLUMN trial_ending_emailed_at TEXT;
ALTER TABLE licenses ADD COLUMN trial_lapsed_emailed_at TEXT;

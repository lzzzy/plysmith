CREATE TABLE live_fair_play_guard (
    guard_id INTEGER PRIMARY KEY CHECK (guard_id = 1),
    blocked INTEGER NOT NULL CHECK (blocked IN (0, 1)),
    account_id TEXT CHECK (account_id IS NULL OR length(account_id) BETWEEN 1 AND 100)
) STRICT;

INSERT INTO live_fair_play_guard(guard_id, blocked, account_id) VALUES (1, 0, NULL);

-- 0010: persist the Altana session sub-key private material on the delegation.
-- WHY: the scheduled strategy loop must reconstruct the hire's session later
-- (agent wallet has no interactive user at 3am). The key only ever allows
-- calls to the GuardRouter (session permissions), capped by the hire's spend
-- cap, and is held server-side only — never sent to any client.
ALTER TABLE delegations ADD COLUMN IF NOT EXISTS session_private_key text;

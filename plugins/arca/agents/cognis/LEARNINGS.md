
## 2026-04-15 — Telegram Plugin 409 Restart Loop

**What happened:** Telegram plugin died 3x in an hour, triggering heartbeat CC restarts. Each restart caused the new plugin instance to get a 409 conflict from Telegram's API (previous getUpdates connection still active). grammy crashed silently with "shutting down". Heartbeat detected dead → restarted again. Loop ran for ~4.5 hours.

**Root cause:** Telegram's Bot API holds getUpdates long-poll connections open for several minutes after a bot instance dies. grammy's default behavior is to crash on 409 rather than wait and retry.

**Evidence:** `/tmp/telegram-plugin.log` shows only "telegram channel: shutting down" — clean exit from ppid monitor, not a crash. But 409 conflict prevents the new instance from establishing polling.

**Fix needed:** In plugin `server.ts`, either:
1. Set `bot.start({ drop_pending_updates: true })` — clears stale update queue
2. Add a 30–60s startup delay before grammy begins polling (lets old connection expire)
3. Catch 409 errors and retry with backoff rather than exiting

**Do not restart CC more than once per Telegram death** — the 409 will keep killing the new instance until the old connection expires naturally (5–15 min).

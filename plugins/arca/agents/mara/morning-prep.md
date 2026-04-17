# Mara — Morning Prep Procedure

Run at the first heartbeat after 8 AM EST. Creates state files and verifies readiness for the day.

## Quick Start

```bash
python3 scripts/morning_prep.py
```

This creates all missing state files and checks readiness in one command.

## Manual Verification (if morning_prep.py misses something)

### Create today's state files if they don't exist:
- `workspace/blitz_state_YYYY-MM-DD.md`
- `workspace/kpi_tracker_YYYY-MM-DD.md`
- `workspace/angle_tracker_YYYY-MM-DD.md`
- `workspace/quote_tweet_tracker_YYYY-MM-DD.md`
- `workspace/thread_cadence.md`
- `workspace/circle_engagement_log.md`
- `workspace/cold_follow_log.md`

### Verify supplies:
1. **Discovery pool** — `data/discovery_YYYY-MM-DD.json` exists and created today? If stale: `python3 scripts/trending_discovery.py --core`
2. **Content drafts** — DB needs 3 QTs, 1 thread, 3 tweets. If short: `python3 scripts/content_pipeline.py all`
3. **Reply pool** — blitz_state shows NO_POOL? Run discovery immediately.
4. **Likers engine** — `likers_snapshot.json` `last_pull_date` older than 2 days? `python3 scripts/likers_engine.py run`
5. **Follow-back** — Under 15 today? `python3 scripts/follow_back.py`
6. **Cold follow** — Under 30 today? `python3 scripts/cold_follow.py`
7. **Thread overdue** — >2 days since last thread? MANDATORY today. Post during 8-9 AM or 12-1 PM.
8. **Quote tweet windows** — 3 mandatory: 8-9 AM, 12-1 PM, 5-6 PM EST
9. **API budget** — `api_budget.json` any bank < $0.10? Be conservative.

## Run Once Per Morning Only

Subsequent heartbeats skip to Step 1 of the main heartbeat runtime.
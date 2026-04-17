# Mara — Nightly Review Procedure

Complete off-hours procedure (8 PM - 8 AM EST). No posting. Strategy and planning only.

## Step 1: End-of-Day Wrap (first heartbeat after 8 PM)

1. Write daily note to Obsidian: `/root/obsidian-vault/Hermes/Mara/workspace/YYYY-MM-DD.md`
2. **Run daily snapshot:** `python3 scripts/daily_snapshot.py`
   - Pulls follower count ($0.01/day)
   - Logs engagement stats
   - Ranks top 5 performing tweets
   - Appends to `follower_tracking.csv`
3. Pull analytics:
   - `python3 scripts/likers_engine.py run` (if 2-day interval met)
   - `python3 scripts/likers_engine.py check` for budget
   - Check `likers_snapshot.json` for metrics on today's posts
   - Rank top 5 by likes, top 5 by replies. Note which angles performed best.
4. **Run follow-back:** `python3 scripts/follow_back.py` (up to 15/day, free)
5. Check follower delta. If 3+ days zero/negative growth, flag to Mal with hypothesis.

## Step 2: Strategy + Content Planning (once per day, after 8 PM)

1. Check trending topics on X (new model drops, viral AI/agents threads)
2. Check Reddit (r/LocalLLaMA, r/singularity, r/ChatGPT) for developments
3. Review Obsidian vault for new features/infrastructure changes
4. **Run content pipeline for tomorrow:** `python3 scripts/content_pipeline.py all`
   - `--dry-run` first to preview, then without flag to save
5. Draft next day's content plan:
   - At least 1 thread
   - 2-3 quote tweets
   - 3-4 original tweets across pillars
   - Save all drafts to content_suggestions DB (status: pending)

## Step 3: Skill Improvement + Analytics

- Review what replies got the most engagement today
- Run `python3 scripts/likers_engine.py run` for last likers
- Check which content pillar performed best
- Form hypothesis: "angle X got more replies, try more tomorrow"
- Patch skills if any issues (EPIPE, voice violations, dedup failures)

## Step 3.5: Reply Engagement Analysis (9 PM — MANDATORY)

Every night at 9 PM, run structured analysis of today's replies.

**What to analyze:**
1. Pull today's replies from `reply_log.md` (filter by date)
2. Categorize by structural move: question, contrarian, number-led, 1-liner, observation, experience
3. Cross-reference with mentions received (check `bird mentions`)
4. Cross-reference with likes received (check `likers_snapshot.json`)

**Output (write to `workspace/engagement_analysis_YYYY-MM-DD.md`):**
- Top 5 replies by engagement
- Bottom 5 replies by engagement
- Category breakdown: count + response rate per category
- Winner/loser categories
- 3 specific adjustments for tomorrow

**Known insights (update as data changes):**
- Questions outperform statements. 1-liners (29% of mix) got zero. Target: questions 40%+.
- Contrarian + number = highest conversion. Target: number-led contrarians 20%+.
- 1-liners are volume, not engagement. Cap at 15% max.
- Experience stories underused in replies (2%). Shift some observations to experience.

## Step 4: Self-Improvement

- Review x-engage, x-reply-blitz, x-tweet-draft skills for gaps
- Read Mal's feedback from the day (Obsidian feedback notes)
- If voice violations flagged, patch voice skill immediately
- Prepare improvements for tomorrow

## Step 5: 7 AM Pre-Market Prep (7:00-7:59 AM EST only)

Bridge between off-hours and posting hours. No posting. Just production.

1. Kick off async Grok discovery: `nohup python3 scripts/trending_discovery.py --grok > workspace/data/grok_output.log 2>&1 &`
2. Check overnight discovery files (15+ targets = good)
3. Kick off content pipeline if drafts are low
4. Verify session health: `bird about`. If auth error, message Mal immediately.
5. Pre-draft first batch (5-8 replies into draft_buffer). DO NOT POST.
6. Check state files. If missing, run `python3 scripts/morning_prep.py`.
7. Identify mentions for 8 AM. DON'T reply yet. Just log them.
8. Report to Mal: "Pre-market prep done. Pool: X targets. Drafts: Y staged. Session: healthy/broken. Ready for 8 AM."

## Step 6: Mark Off-Hours Work Done

Update daily note, mark heartbeat complete with summary of what was planned. Go quiet until next heartbeat or 8 AM.

## Follower Tracking

- Attribution snapshots: `python3 scripts/attribution.py snapshot` ($0.01 each). Run every 2 hours during posting hours.
- Attribution report: `python3 scripts/attribution.py report`
- Attribution spikes: `python3 scripts/attribution.py spikes`
- Check `follower_tracking.csv` for current count (never hardcode)
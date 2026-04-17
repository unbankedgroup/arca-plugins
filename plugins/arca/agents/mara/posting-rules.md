# Mara — Posting Rules

Content mix, voice constraints, and content type rules.

## Content Mix Per Day

| Pillar | Share | Count |
|--------|-------|-------|
| Builder's Journey | 40% | 1-2 posts |
| AI Agent Insights | 30% | 1 post |
| Consultant Pain | 20% | 1 post or thread |
| Contrarian Takes | 10% | 1 post |

Plus: 1 thread/day (or every 2 days), 2-3 quote tweets, 120-150 replies.

## Quote Tweets (3/day, MANDATORY)

- Appear in BOTH the original thread AND your timeline. Double exposure.
- Mandatory windows: 8-9 AM, 12-1 PM, 5-6 PM EST.
- If no pipeline drafts, use QUOTE_TEMPLATES from content_pipeline.py.
- Zero quote tweets in a day = failure.

## Threads (1 every 2 days minimum)

- Get bookmarked, shared, retweeted. This is how small accounts break out.
- Post during prime windows: 8-9 AM or 12-1 PM EST.
- Thread = first tweet + reply-to-self for each subsequent tweet.
- If no draft: `python3 scripts/content_pipeline.py threads`

## Original Tweets (3-4/day)

- Check DB: `SELECT type, COUNT(*) FROM content_suggestions WHERE status='pending' GROUP BY type`
- Spread across content pillars.
- Don't post more than 1-2 per heartbeat.

## Voice (read before EVERY draft session)

Read `workspace/voice/TRAINED_VOICE_PROMPT.md` first. It's the source of truth (0.877 voice judge, 40+ experiments).

- First person. Short sentences. Punchy.
- No emojis, hashtags, @mentions, em dashes.
- DIGITS NOT WORDS. Never prescribe. Mal observes, he doesn't advise.

**BANNED words:** unlock, game-changer, dive deep, leverage, revolutionize, hustle, grind, synergy, harness, neat, folks.
**BANNED patterns:** "X is a Y, not a Z", "What people miss is...", "It's not about X, it's about Y".

## Angle Rotation

Every reply gets an angle tag: obs/q/con/num/meta/1lin/exp/ref

- Before drafting ANY reply, check `python3 scripts/draft_buffer.py stats` for today's distribution.
- If any angle has 8+ uses today, skip it.
- Never draft 3+ replies with the same angle in a row.
- Target: no angle above 25% of daily total. Spread across 4+ angles.

## A/B Testing

On high-volume days, pick 2 reply angles and track which gets more engagement. Log results in daily note. Winning angle gets more volume next day.

## Content Expiry

Content drafts older than 7 days: review. If topic is stale, mark status='expired'. Never post stale content just to fill quota.

## Reciprocity Tracking

Log every action to `workspace/reciprocity_log.md`:
`DATE | @handle | liked their post | replied to their post | outcome`

Check outcomes in next heartbeat. If a reciprocity action led to a follow, double down on that pattern.
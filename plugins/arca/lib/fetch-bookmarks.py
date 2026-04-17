#!/usr/bin/env python3
"""
X Bookmarks → KB Pipeline

Pulls Mal's X/Twitter bookmarks, filters for AI/vibe-coding topics,
and writes matching bookmarks into the Arca knowledge base.

Auth: OAuth 2.0 PKCE flow (required by Twitter's bookmarks endpoint).
First run: opens browser for authorization, then full backfill.
Subsequent runs: incremental, uses saved refresh token.

State file: $ARCA_HOME/ops/agents/cognis/bookmark-state.json
Token file: $ARCA_HOME/ops/agents/cognis/twitter-oauth2-token.json
"""

import json
import os
import re
import sys
import time
import requests
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────
SECRETS_FILE = "/root/.openclaw/secrets.json"
ARCA_HOME = os.environ.get("ARCA_HOME", "/root/arca")
STATE_FILE = os.path.join(ARCA_HOME, "ops/agents/cognis/bookmark-state.json")
VAULT_PATH = os.environ.get("KB_VAULT_PATH", "/root/obsidian-vault")
WORKSPACE = "arca"

TOPIC_FILTERS = {
    "ai": re.compile(
        r"\b(AI|artificial intelligence|LLM|GPT|Claude|Gemini|Cursor|Copilot|agents?|automation|OpenClaw|Codex)\b",
        re.IGNORECASE,
    ),
    "vibe-coding": re.compile(
        r"\b(vibe.?coding|vibecoding|vibecoded)\b",
        re.IGNORECASE,
    ),
}

# OAuth 2.0
TOKEN_URL = "https://api.twitter.com/2/oauth2/token"

# ── Auth ────────────────────────────────────────────────────────
def load_twitter_config():
    with open(SECRETS_FILE) as f:
        secrets = json.load(f)
    tw = secrets.get("twitter", {})
    return {
        "client_id": tw.get("clientId", ""),
        "client_secret": tw.get("clientSecret", ""),
        "access_token": tw.get("oauth2_access_token", ""),
        "refresh_token": tw.get("oauth2_refresh_token", ""),
        "expires_at": tw.get("oauth2_expires_at", ""),
    }
def refresh_access_token(config):
    """Refresh the OAuth 2.0 access token using the refresh token. Updates secrets.json."""
    if not config.get("refresh_token"):
        return None
    token_data = {
        "refresh_token": config["refresh_token"],
        "grant_type": "refresh_token",
        "client_id": config["client_id"],
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    r = requests.post(TOKEN_URL, data=token_data, headers=headers)
    if r.status_code != 200:
        print(f"  Token refresh failed: {r.status_code} {r.text[:200]}")
        return None
    tokens = r.json()
    # Update secrets.json
    with open(SECRETS_FILE) as f:
        secrets = json.load(f)
    tw = secrets.get("twitter", {})
    tw["oauth2_access_token"] = tokens.get("access_token", "")
    tw["oauth2_refresh_token"] = tokens.get("refresh_token", tw.get("oauth2_refresh_token", ""))
    tw["oauth2_expires_at"] = new_date(tokens.get("expires_in", 7200))
    secrets["twitter"] = tw
    with open(SECRETS_FILE, "w") as f:
        json.dump(secrets, f, indent=2)
    print("  Access token refreshed and saved.")
    return tokens["access_token"]


def new_date(expires_in):
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()


def get_access_token(config):
    """Get a valid OAuth 2.0 access token. Refresh if expired. Exit if no token."""
    access_token = config.get("access_token")
    expires_at = config.get("expires_at")
    if not access_token:
        print("ERROR: No OAuth 2.0 access token in secrets.json.")
        print("  Run the auth flow first: visit the URL in twitter-auth-url.txt")
        sys.exit(1)
    # Check expiry
    if expires_at:
        try:
            from datetime import datetime, timezone
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) >= exp:
                print("  Access token expired — refreshing...")
                new_token = refresh_access_token(config)
                if new_token:
                    return new_token
                print("ERROR: Token refresh failed. Re-authorize via twitter-auth-url.txt")
                sys.exit(1)
        except Exception:
            pass  # If we can't parse the date, just try the token
    return access_token


# ── Fetch bookmarks ─────────────────────────────────────────────
def fetch_all_bookmarks(access_token, stop_at_id=None):
    """Page through ALL bookmarks using OAuth 2.0."""
    url = "https://api.twitter.com/2/users/me"
    headers = {"Authorization": f"Bearer {access_token}"}

    # Get user ID first
    r = requests.get(url, headers=headers)
    if r.status_code == 401:
        print("ERROR: Access token invalid. Delete token file and re-run.")
        sys.exit(1)
    r.raise_for_status()
    user_id = r.json()["data"]["id"]

    # Fetch bookmarks
    bm_url = f"https://api.twitter.com/2/users/{user_id}/bookmarks"
    params = {
        "max_results": 100,
        "tweet.fields": "created_at,author_id,text,entities,note_tweet,referenced_tweets",
        "expansions": "author_id",
        "user.fields": "username,name",
    }

    all_tweets = []
    authors = {}

    while True:
        r = requests.get(bm_url, headers=headers, params=params)
        if r.status_code == 429:
            reset = int(r.headers.get("x-rate-limit-reset", time.time() + 900))
            wait = max(reset - time.time(), 60)
            print(f"  Rate limited. Waiting {int(wait)}s...")
            time.sleep(wait + 5)
            continue
        if r.status_code == 401:
            print("ERROR: Token expired mid-fetch. Re-run to refresh.")
            sys.exit(1)
        if r.status_code != 200:
            print(f"  API error {r.status_code}: {r.text[:200]}")
            break

        data = r.json()
        tweets = data.get("data", [])
        includes = data.get("includes", {})

        for user in includes.get("users", []):
            authors[user["id"]] = user

        for tweet in tweets:
            if stop_at_id and tweet["id"] == stop_at_id:
                print(f"  Reached previously processed bookmark {stop_at_id}, stopping.")
                return all_tweets, authors
            all_tweets.append(tweet)

        meta = data.get("meta", {})
        next_token = meta.get("next_token")
        if not next_token or not tweets:
            break

        params["pagination_token"] = next_token
        remaining = int(r.headers.get("x-rate-limit-remaining", 15))
        if remaining <= 1:
            reset = int(r.headers.get("x-rate-limit-reset", time.time() + 900))
            wait = max(reset - time.time(), 60)
            print(f"  Approaching rate limit. Waiting {int(wait)}s...")
            time.sleep(wait + 5)
        else:
            time.sleep(1)

    return all_tweets, authors


# ── Filter ──────────────────────────────────────────────────────
def filter_tweets(tweets):
    filtered = []
    tags = {}
    for tweet in tweets:
        text = tweet.get("note_tweet", {}).get("text") or tweet.get("text", "")
        matched_tags = []
        for tag, pattern in TOPIC_FILTERS.items():
            if pattern.search(text):
                matched_tags.append(tag)
        if matched_tags:
            filtered.append(tweet)
            tags[tweet["id"]] = matched_tags
    return filtered, tags


# ── Enrichment ──────────────────────────────────────────────────
def fetch_url_content(url, timeout=10):
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"}, allow_redirects=True)
        if r.status_code != 200:
            return None
        text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", r.text, flags=re.IGNORECASE)
        text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        title_match = re.search(r"<title[^>]*>(.*?)</title>", r.text, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else ""
        return {"title": title[:200], "snippet": text[:500]}
    except Exception:
        return None


def extract_urls(tweet):
    urls = []
    entities = tweet.get("entities", {})
    for url_obj in entities.get("urls", []):
        expanded = url_obj.get("expanded_url", url_obj.get("url", ""))
        if expanded and not expanded.startswith("https://x.com/"):
            urls.append(expanded)
    return urls


# ── KB Write ────────────────────────────────────────────────────
def write_to_kb(tweet, authors, matched_tags, enrichment=None):
    text = tweet.get("note_tweet", {}).get("text") or tweet.get("text", "")
    tweet_url = f"https://x.com/i/web/status/{tweet['id']}"
    author = authors.get(tweet.get("author_id", ""), {})
    author_name = author.get("username", "unknown")

    content = f"Tweet by @{author_name} ({tweet.get('created_at', '')}):\n\n{text}"
    if enrichment:
        content += f"\n\n---\nLinked article: {enrichment['title']}\n{enrichment['snippet']}"
    content += f"\n\nSource: {tweet_url}"

    tag_list = ["x-bookmark"] + matched_tags

    try:
        out_dir = Path(VAULT_PATH) / "x-bookmark"
        out_dir.mkdir(parents=True, exist_ok=True)

        safe_title = re.sub(r"[^\w\s-]", "", text[:50]).strip().replace(" ", "-")
        filename = f"{tweet['id']}_{safe_title}.md"
        filepath = out_dir / filename

        frontmatter = {
            "title": text[:100].replace("\n", " ").strip(),
            "tags": tag_list,
            "source": tweet_url,
            "tweet_id": tweet["id"],
            "author": author_name,
            "bookmarked_at": tweet.get("created_at", ""),
            "type": "capture",
            "project": "arca",
        }
        with open(filepath, "w") as f:
            f.write("---\n")
            for k, v in frontmatter.items():
                if isinstance(v, list):
                    f.write(f"{k}:\n")
                    for item in v:
                        f.write(f"  - {item}\n")
                else:
                    f.write(f"{k}: {v}\n")
            f.write("---\n\n")
            f.write(content + "\n")

        return True
    except Exception as e:
        print(f"  KB write error for {tweet['id']}: {e}")
        return False


# ── State ────────────────────────────────────────────────────────
def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"last_bookmark_id": None, "processed_ids": []}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ── Main ────────────────────────────────────────────────────────
def main():
    print("X Bookmarks → KB Pipeline")
    print("=" * 50)

    config = load_twitter_config()
    if not config["client_id"]:
        print("ERROR: Missing Twitter OAuth 2.0 client ID in secrets.json")
        sys.exit(1)

    access_token = get_access_token(config)
    print(f"  Access token obtained ({len(access_token)} chars)")

    # Load state
    state = load_state()
    stop_at_id = state.get("last_bookmark_id")
    if stop_at_id:
        print(f"  Incremental mode — stopping at bookmark {stop_at_id}")
    else:
        print("  Full backfill mode — fetching ALL bookmarks")

    # Fetch
    print(f"\nFetching bookmarks...")
    tweets, authors = fetch_all_bookmarks(access_token, stop_at_id)
    print(f"  Fetched {len(tweets)} bookmarks")

    if not tweets:
        print("No new bookmarks found.")
        return

    # Filter
    print("\nFiltering for AI/vibe-coding topics...")
    filtered, tags_map = filter_tweets(tweets)
    print(f"  {len(filtered)} bookmarks matched filters")

    if not filtered:
        state["last_bookmark_id"] = tweets[0]["id"]
        save_state(state)
        print("No matching bookmarks. State updated.")
        return

    # Process
    print(f"\nProcessing {len(filtered)} filtered bookmarks...")
    written = 0
    enriched = 0
    for i, tweet in enumerate(filtered):
        text_preview = (tweet.get("note_tweet", {}).get("text") or tweet.get("text", ""))[:60]
        print(f"  [{i+1}/{len(filtered)}] {tweet['id']}: {text_preview}...")

        enrichment = None
        urls = extract_urls(tweet)
        if urls:
            enrichment = fetch_url_content(urls[0])
            if enrichment:
                enriched += 1

        matched_tags = tags_map.get(tweet["id"], ["ai"])
        ok = write_to_kb(tweet, authors, matched_tags, enrichment)
        if ok:
            written += 1

    # Update state
    state["last_bookmark_id"] = tweets[0]["id"]
    processed = state.get("processed_ids", [])
    for tweet in filtered:
        if tweet["id"] not in processed:
            processed.append(tweet["id"])
    state["processed_ids"] = processed[-5000:]
    save_state(state)

    # Summary
    print("\n" + "=" * 50)
    print("SUMMARY")
    print(f"  Total bookmarks fetched: {len(tweets)}")
    print(f"  Matched filters:         {len(filtered)}")
    print(f"  Enriched with URL:       {enriched}")
    print(f"  Written to KB:          {written}")
    print(f"  State saved:            last_bookmark_id = {state['last_bookmark_id']}")


if __name__ == "__main__":
    main()
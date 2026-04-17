"""Arca usage-budget scraper — reads Claude (and eventually Ollama) utilization
and writes a snapshot to usage-snapshot.json.

Invoked by the heartbeat. Hard-stop at 95% of 7-day Max quota.

Requires: curl_cffi (`pip install --break-system-packages curl_cffi`)
"""
import json, sys, os, datetime
from curl_cffi import requests

SECRETS = '/root/.openclaw/secrets.json'
SNAPSHOT = os.path.join(os.environ.get('ARCA_HOME', '/root/arca'), 'ops/agents/cognis/usage-snapshot.json')

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def fetch_claude(sk: str) -> dict:
    s = requests.Session(impersonate="chrome120")
    s.cookies.set('sessionKey', sk, domain='.claude.ai')
    orgs = s.get('https://claude.ai/api/organizations').json()
    if not orgs:
        return {'error': 'no organizations'}
    org_uuid = orgs[0]['uuid']
    usage = s.get(f'https://claude.ai/api/organizations/{org_uuid}/usage').json()
    return {
        'fetched_at': now_iso(),
        'org_uuid': org_uuid,
        'five_hour_pct': usage.get('five_hour', {}).get('utilization'),
        'five_hour_resets_at': usage.get('five_hour', {}).get('resets_at'),
        'seven_day_pct': usage.get('seven_day', {}).get('utilization'),
        'seven_day_resets_at': usage.get('seven_day', {}).get('resets_at'),
        'seven_day_opus_pct': (usage.get('seven_day_opus') or {}).get('utilization'),
        'seven_day_sonnet_pct': (usage.get('seven_day_sonnet') or {}).get('utilization'),
        'extra_credits_used': (usage.get('extra_usage') or {}).get('used_credits'),
        'extra_credits_monthly_limit': (usage.get('extra_usage') or {}).get('monthly_limit'),
        'extra_credits_pct': (usage.get('extra_usage') or {}).get('utilization'),
        'raw': usage,
    }

def fetch_ops_cost() -> dict:
    """Fetch per-agent cost breakdown from the ops board usage API."""
    try:
        r = requests.get('https://ops.runarca.xyz/api/usage?ws=arca', timeout=10)
        if r.status_code != 200:
            return {'error': f'HTTP {r.status_code}'}
        data = r.json()
        return {
            'total_tasks': data.get('total_tasks_completed', 0),
            'total_cost_usd': data.get('total_estimated_cost_usd', 0),
            'total_tokens_in': data.get('total_tokens_in', 0),
            'total_tokens_out': data.get('total_tokens_out', 0),
            'by_agent': data.get('by_agent', {}),
            'top_expensive': data.get('top_expensive_tasks', []),
        }
    except Exception as e:
        return {'error': str(e)}

def fetch_ollama(key: str) -> dict:
    import re
    s = requests.Session(impersonate="chrome120")
    s.cookies.set('__Secure-session', key, domain='ollama.com')
    try:
        r = s.get('https://ollama.com/settings', timeout=15)
        if r.status_code != 200:
            return {'fetched_at': now_iso(), 'error': f'HTTP {r.status_code}'}
        text = re.sub(r'<style[^>]*>.*?</style>', '', r.text, flags=re.DOTALL)
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', '\n', text)
        result = {'fetched_at': now_iso()}
        session_match = re.search(r'Session usage\s*([\d.]+)%\s*used\s*Resets in\s*(\d+\s*\w+)', text)
        weekly_match = re.search(r'Weekly usage\s*([\d.]+)%\s*used\s*Resets in\s*(\d+\s*\w+)', text)
        if session_match:
            result['session_pct'] = float(session_match.group(1))
            result['session_resets_in'] = session_match.group(2)
        if weekly_match:
            result['weekly_pct'] = float(weekly_match.group(1))
            result['weekly_resets_in'] = weekly_match.group(2)
        return result
    except Exception as e:
        return {'fetched_at': now_iso(), 'error': str(e)}

def time_until(iso_str: str) -> str:
    """Return human-readable time until an ISO timestamp, e.g. '6d 16h'."""
    try:
        target = datetime.datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        now = datetime.datetime.now(datetime.timezone.utc)
        delta = target - now
        if delta.total_seconds() <= 0:
            return 'now'
        total_hours = int(delta.total_seconds() // 3600)
        days = total_hours // 24
        hours = total_hours % 24
        if days > 0:
            return f"{days}d {hours}h"
        return f"{hours}h"
    except Exception:
        return '?'


def daily_target_info() -> dict:
    """Return working day number (Mon=1..Sat=6) and daily target % for today (EDT).
    Mon-Sat = 6 working days, target = day_num * 100/6 rounded.
    Sunday = rest day."""
    edt = datetime.timezone(datetime.timedelta(hours=-4))
    now = datetime.datetime.now(edt)
    wd = now.weekday()  # 0=Mon, 5=Sat, 6=Sun
    if wd == 6:
        return {'day': 0, 'total': 6, 'target_pct': None, 'rest': True}
    day_num = wd + 1  # Mon=1 ... Sat=6
    target = round(day_num * 100 / 6)
    return {'day': day_num, 'total': 6, 'target_pct': target, 'rest': False}


def print_short(snap: dict):
    """Compact format with daily target tracking: X% used | target Y% | Z% under | day N/6"""
    info = daily_target_info()
    c = snap['claude']
    if 'error' not in c:
        pct = c['seven_day_pct']
        if info['rest']:
            print(f"Claude: {pct}% used | rest day")
        else:
            target = info['target_pct']
            diff = round(pct - target)
            diff_str = f"+{abs(diff)}% over" if diff > 0 else f"{abs(diff)}% under"
            print(f"Claude: {pct}% used | target {target}% | {diff_str} | day {info['day']}/6")
    else:
        print("Claude: ERROR")
    o = snap['ollama']
    if 'error' not in o:
        pct = o.get('weekly_pct', 0)
        resets_in = o.get('weekly_resets_in', '?')
        if info['rest']:
            print(f"Ollama: {pct}% used | rest day | resets in {resets_in}")
        else:
            target = info['target_pct']
            diff = round(pct - target)
            diff_str = f"+{abs(diff)}% over" if diff > 0 else f"{abs(diff)}% under"
            print(f"Ollama: {pct}% used | target {target}% | {diff_str} | day {info['day']}/6")
    else:
        print("Ollama: ERROR")


def print_full(snap: dict):
    c = snap['claude']
    if 'error' not in c:
        print(f"Claude: 5h {c['five_hour_pct']}% · 7d {c['seven_day_pct']}% "
              f"(sonnet {c['seven_day_sonnet_pct']}%) · credits "
              f"{c['extra_credits_used']}/{c['extra_credits_monthly_limit']} "
              f"({c['extra_credits_pct']}%)")
        print(f"  5h resets: {c['five_hour_resets_at']}")
        print(f"  7d resets: {c['seven_day_resets_at']}")
    else:
        print('Claude: ERROR —', c['error'])
    o = snap['ollama']
    if 'error' not in o:
        print(f"Ollama: session {o.get('session_pct','?')}% · weekly {o.get('weekly_pct','?')}% "
              f"(resets in {o.get('weekly_resets_in','?')})")
    else:
        print(f"Ollama: ERROR — {o['error']}")
    c = snap.get('ops_board_cost', {})
    if 'error' not in c:
        print(f"Ops Board: {c.get('total_tasks', 0)} tasks this month · "
              f"${c.get('total_cost_usd', 0):.2f} estimated cost · "
              f"{c.get('total_tokens_in', 0):,} tokens in · "
              f"{c.get('total_tokens_out', 0):,} tokens out")
        for agent, info in c.get('by_agent', {}).items():
            print(f"  {agent}: {info.get('tasks', 0)} tasks · ${info.get('cost', 0):.4f} · "
                  f"models: {', '.join(info.get('models', [])) or 'none'}")
    else:
        print(f"Ops Board: ERROR — {c['error']}")


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--short', action='store_true', help='Compact one-line-per-service output for Telegram')
    args = parser.parse_args()

    secrets = json.load(open(SECRETS))
    snap = {
        'generated_at': now_iso(),
        'claude': fetch_claude(secrets['claudeSessionKey']),
        'ollama': fetch_ollama(secrets.get('ollamaSessionKey', '')),
        'ops_board_cost': fetch_ops_cost(),
    }
    os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
    with open(SNAPSHOT, 'w') as f:
        json.dump(snap, f, indent=2)

    if args.short:
        print_short(snap)
    else:
        print_full(snap)

if __name__ == '__main__':
    main()

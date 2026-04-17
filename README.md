# Arca Plugins

Official Claude Code plugin marketplace for [Arca](https://runarca.xyz) — AI ops platform for SMBs.

## Install

```bash
claude plugin add https://github.com/unbankedgroup/arca-plugins
```

## What's included

- **Ops Board MCP** — task management, command center, scheduling
- **Session hooks** — auto-boot, Telegram reconnect, prompt dispatch
- **Skills** — arca-ops, arca-worker, usage, watch-agent
- **Agent templates** — Cognis, Mara, and a generic _template for new agents

## Configuration

After install, set these environment variables (or provide them at enable time):

- `ARCA_WORKSPACE` — ops board workspace (e.g. `arca`, `reignite`)
- `ARCA_AGENT_NAME` — agent name for routing (e.g. `Cognis`, `Donna`)
- `ARCA_WEBHOOK_PORT` — webhook port (e.g. `8798`)
- `ARCA_LICENSE_KEY` — license key (sensitive)

## License

MIT
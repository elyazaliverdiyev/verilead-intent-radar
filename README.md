# VeriLead Intent Radar (Open Agent Skill)

Zero-dependency real-time B2B buying intent radar skill for **Claude Code**, **Antigravity**, **Cursor**, and **Codex**.

Finds funded founders and tech teams hiring agencies, posting paid GitHub bounties, or asking for competitor alternatives within the last 14 days. Zero paid API keys. Zero scraped cold email lists.

## Install as an Agent Skill

```bash
npx skills add elyazaliverdiyev/verilead-intent-radar
```

Or clone directly into your agent skills directory:

```bash
git clone https://github.com/elyazaliverdiyev/verilead-intent-radar.git .agents/skills/verilead-intent-radar
```

## Quick Run (10 Seconds, Node 18+, Zero Dependencies)

```bash
# Scan fresh B2B buyers (HN Who Is Hiring + Switchers + GitHub Issues + Tech Hiring)
node scripts/radar.mjs --kw "AI agent,workflow automation" --comp "Zapier,Make.com" --days 14 --limit 15

# Enrich any Hacker News or GitHub author profile in 1 free request
node scripts/radar.mjs --enrich-hn tanvesh01
node scripts/radar.mjs --enrich-gh xnorpx

# Export verified fresh leads straight to CSV
node scripts/radar.mjs --kw "Next.js,MVP build" --comp "Upwork" --days 14 --csv leads.csv
```

## What It Blocks Automatically
- Self-promo sellers (`Show HN:`, `[For Hire]`, `Who wants to be hired?`, `SEEKING WORK`, `SEEKING FREELANCE`, resumes)
- Low-wage support noise (`Customer Service`, `Content Reviewer`, `Call Center`, hourly rates under `$25/hr`)
- Stale threads older than your `--days` window (default `<= 14` days)

## Hosted 24/7 Edge Version (Cloudflare Workers + KV + Telegram Alerts)

Need hourly automatic scanning, isolated private client workspaces (`agiera.fyi/app?ws=...`), built-in CRM pipeline, Gemini 4 Hydrogen reply drafts, and instant Telegram alerts without running scripts locally?

- **Live Demo (real signals right now):** https://agiera.fyi/app
- **Free 7-Day Private Pilot:** https://agiera.fyi

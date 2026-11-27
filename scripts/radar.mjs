#!/usr/bin/env node
/**
 * VeriLead Intent Radar CLI (Zero Dependencies, Node 18+)
 * Open-source companion to https://agiera.fyi
 *
 * Usage:
 *   node scripts/radar.mjs --kw "AI agent" --comp "Zapier" --days 14 --limit 15
 *   node scripts/radar.mjs --kw "Next.js" --comp "Upwork" --csv leads.csv
 *   node scripts/radar.mjs --enrich-hn tanvesh01
 *   node scripts/radar.mjs --enrich-gh xnorpx
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
function getArg(flag, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const HARD_SELLER_PATTERNS = [
  /who wants to be hired/i,
  /^\s*show hn\b/i,
  /^\s*\[for hire\]/i,
  /\b(seeking work|seeking freelance\b|for hire|available for hire|open to work|looking for (a )?(job|role|full[- ]time|work|clients|gigs)|offering (my|our) services|willing to relocate|résumé|resume:|happy to shift my hours)\b/i
];

const LOW_VALUE_NOISE_PATTERNS = [
  /\b(customer service|customer support rep|content reviewer|call center|cold caller|appointment setter|data entry|virtual assistant|receptionist|chat moderator|transcriptionist)\b/i
];

const SOFT_SELLER_PATTERNS = [
  /\b(we open[- ]sourced|i open[- ]sourced|i built a|we built a|i just launched|we just launched|introducing our|check out my (new |free )?(tool|app|saas|platform))\b/i
];

const INTENT_RULES = [
  { rx: /\b(willing to pay|ready to pay|paid gig|budget|retainer|\$\d[\d,]*k?)\b/i, w: 22, tag: 'budget-signal' },
  { rx: /\b(\[hiring\]|who is hiring|looking to hire|need a developer|need an agency|looking for an? (agency|studio|developer|freelancer|contractor|consultant|expert|team|engineer))\b/i, w: 26, tag: 'active-hiring' },
  { rx: /\b(alternative to|alternatives to|switching from|migrating from|replace|tired of|frustrated with|too expensive|ditching)\b/i, w: 24, tag: 'competitor-switch' },
  { rx: /\b(ask hn|looking for|recommend|recommendations|anyone know a|what tool|best tool|suggestions for)\b/i, w: 15, tag: 'seeking-solution' },
  { rx: /\b(need help|struggling with|bottleneck|pain point|broken|manual process|wasting hours)\b/i, w: 14, tag: 'acute-pain' },
  { rx: /\b(bounty|rfp|quote|proposal|dm me|reach out|contract)\b/i, w: 18, tag: 'ready-to-talk' }
];

function stripHtml(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ').trim();
}

function isBlockedNoise(title, body) {
  const head = `${stripHtml(title)} ${stripHtml(body).slice(0, 240)}`;
  if (HARD_SELLER_PATTERNS.some((rx) => rx.test(head))) return true;
  if (LOW_VALUE_NOISE_PATTERNS.some((rx) => rx.test(head))) return true;
  const hourly = head.match(/\$\s?(\d{1,2})\s*(?:-\s*\$?\d{1,2})?\s*\/\s*(?:hr|hour)\b/i);
  if (hourly && Number(hourly[1]) < 25) return true;
  if (/\b(\[hiring\]|who is hiring|looking to hire|need an? agency|alternative to|recommend)\b/i.test(head)) return false;
  return SOFT_SELLER_PATTERNS.some((rx) => rx.test(head));
}

function scorePost(title, body, postedIso, keywords, competitors) {
  const combined = `${stripHtml(title)} ${stripHtml(body)}`;
  const lower = combined.toLowerCase();
  let score = 26;
  const triggers = [];

  for (const r of INTENT_RULES) {
    if (r.rx.test(combined)) { score += r.w; triggers.push(r.tag); }
  }
  let kwHits = 0;
  for (const kw of keywords) {
    if (kw && lower.includes(kw.toLowerCase())) { kwHits++; if (kwHits <= 2) score += 11; }
  }
  if (kwHits) triggers.push(`kw(${kwHits})`);
  for (const comp of competitors) {
    if (comp && lower.includes(comp.toLowerCase())) { score += 18; triggers.push(`comp:${comp}`); break; }
  }

  const ageHours = postedIso ? (Date.now() - new Date(postedIso).getTime()) / 3600000 : 999;
  if (ageHours <= 24) { score += 16; triggers.push('fresh-24h'); }
  else if (ageHours <= 72) { score += 11; triggers.push('fresh-72h'); }
  else if (ageHours <= 168) score += 6;
  else if (ageHours > 336) score -= 15;

  let budget = 'Intent Only';
  const dm = combined.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?(?:\s?-\s?\$?\d[\d,]*[kKmM]?)?(?:\s?\/\s?(?:mo|month|hr|hour))?/);
  if (dm) { budget = `Explicit (${dm[0].trim()})`; score += 10; }
  else if (/\b(willing to pay|paid|bounty|retainer|budget|hiring|contract|funded)\b/i.test(combined)) budget = 'Commercial';

  const finalScore = Math.max(25, Math.min(99, Math.round(score)));
  const ageDays = Math.max(0, Math.round(ageHours / 24));
  return { score: finalScore, tier: finalScore >= 80 ? 'CRITICAL' : finalScore >= 60 ? 'HIGH' : 'WARM', budget, ageDays, triggers: triggers.slice(0, 4) };
}

async function fetchJson(url, headers = {}) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'VeriLead-Skill/5.0 (+https://agiera.fyi)', ...headers } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

async function enrichHN(user) {
  const u = await fetchJson(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(user)}.json`);
  if (!u) return console.log(`HN user "${user}" not found.`);
  const about = stripHtml(u.about || '');
  const email = (about.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || '';
  const site = (about.match(/https?:\/\/[^\s"'<>)]+/i) || [])[0] || '';
  console.log(JSON.stringify({ source: 'Hacker News', user: u.id, karma: u.karma, profile: `https://news.ycombinator.com/user?id=${u.id}`, email, site, about: about.slice(0, 280) }, null, 2));
}

async function enrichGH(login) {
  const clean = login.replace(/^@/, '');
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const u = await fetchJson(`https://api.github.com/users/${encodeURIComponent(clean)}`, headers);
  console.log(JSON.stringify({ source: 'GitHub', login: u.login, name: u.name, company: u.company, location: u.location, blog: u.blog, twitter: u.twitter_username ? `https://x.com/${u.twitter_username}` : '', email: u.email, bio: u.bio, profile: u.html_url }, null, 2));
}

async function main() {
  const hnUser = getArg('--enrich-hn');
  if (hnUser) return enrichHN(hnUser);
  const ghUser = getArg('--enrich-gh');
  if (ghUser) return enrichGH(ghUser);

  const keywords = getArg('--kw', 'AI agent,workflow automation').split(',').map((s) => s.trim()).filter(Boolean);
  const competitors = getArg('--comp', 'Zapier,Make.com').split(',').map((s) => s.trim()).filter(Boolean);
  const maxDays = Math.max(1, Number(getArg('--days', '14')) || 14);
  const limit = Math.max(1, Number(getArg('--limit', '15')) || 15);
  const csvPath = getArg('--csv');

  const primaryKw = keywords[0] || 'AI agent';
  const comp = competitors[0] || 'Zapier';
  const cutoffSec = Math.floor((Date.now() - maxDays * 86400 * 1000) / 1000);
  const sinceDate = new Date(Date.now() - maxDays * 86400 * 1000).toISOString().slice(0, 10);
  const results = [];
  const seen = new Set();
  let filteredNoise = 0;

  // 1. HN Who Is Hiring + Competitor Switchers
  try {
    const kw0 = primaryKw.split(' ')[0] || 'AI';
    const story = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('Who is hiring')}&tags=story,author_whoishiring&hitsPerPage=1`);
    const sid = story.hits?.[0]?.objectID;
    if (sid) {
      const cm = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(kw0)}&tags=comment,story_${sid}&numericFilters=created_at_i>${cutoffSec}&hitsPerPage=12`);
      for (const h of cm.hits || []) {
        const txt = stripHtml(h.comment_text || '');
        if (txt.length < 30) continue;
        const title = `[Hiring HN] ${txt.slice(0, 130)}`;
        if (isBlockedNoise(title, txt)) { filteredNoise++; continue; }
        const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
        if (seen.has(url)) continue;
        seen.add(url);
        results.push({ source: 'HN', author: h.author, title, url, postedAt: h.created_at, ...scorePost(`Who is hiring ${title}`, txt, h.created_at, keywords, competitors) });
      }
    }
    const sw = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`${comp} alternative`)}&tags=(ask_hn,story,comment)&numericFilters=created_at_i>${cutoffSec}&hitsPerPage=8`);
    for (const h of sw.hits || []) {
      const txt = stripHtml(h.comment_text || h.story_text || '');
      const title = stripHtml(h.title || txt.slice(0, 130));
      if (title.length < 18) continue;
      if (isBlockedNoise(title, txt)) { filteredNoise++; continue; }
      const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const sc = scorePost(title, txt, h.created_at, keywords, competitors);
      if (sc.score >= 50) results.push({ source: 'HN', author: h.author, title, url, postedAt: h.created_at, ...sc });
    }
  } catch {}

  // 2. GitHub Open Issues & Bounties
  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const gh = await fetchJson(`https://api.github.com/search/issues?q=${encodeURIComponent(`("bounty" OR "hiring" OR "looking for" OR "alternative") ${primaryKw} is:issue is:open created:>=${sinceDate}`)}&sort=created&order=desc&per_page=10`, headers);
    for (const it of gh.items || []) {
      const body = stripHtml(it.body || '').slice(0, 320);
      if (isBlockedNoise(it.title, body)) { filteredNoise++; continue; }
      if (seen.has(it.html_url)) continue;
      seen.add(it.html_url);
      results.push({ source: 'GitHub', author: `@${it.user?.login || 'gh'}`, title: stripHtml(it.title), url: it.html_url, postedAt: it.created_at, ...scorePost(it.title, body, it.created_at, keywords, competitors) });
    }
  } catch {}

  // 3. Remotive Software-Dev Only
  try {
    const kw0 = primaryKw.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || 'AI';
    const rem = await fetchJson(`https://remotive.com/api/remote-jobs?category=software-dev&search=${encodeURIComponent(kw0)}&limit=12`);
    for (const job of rem.jobs || []) {
      const ageDays = (Date.now() - new Date(job.publication_date).getTime()) / 86400000;
      if (ageDays > maxDays) continue;
      const title = `[Hiring] ${job.company_name}: ${job.title}${job.salary ? ` (${job.salary})` : ''}`;
      const body = stripHtml(job.description || '').slice(0, 320);
      if (isBlockedNoise(title, body)) { filteredNoise++; continue; }
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      results.push({ source: 'TechHiring', author: job.company_name, title, url: job.url, postedAt: job.publication_date, ...scorePost(title, `${body} hiring ${job.salary || ''}`, job.publication_date, keywords, competitors) });
    }
  } catch {}

  results.sort((a, b) => b.score - a.score || a.ageDays - b.ageDays);
  const top = results.slice(0, limit);

  console.log(`\nVeriLead Open Radar | Keywords: ${keywords.join(', ')} | Window: <=${maxDays}d`);
  console.log(`Found: ${results.length} fresh leads | Noise/sellers blocked: ${filteredNoise}\n`);
  top.forEach((l, i) => {
    console.log(`${String(i + 1).padStart(2, '0')}. [${l.score} ${l.tier}] (${l.source}, ${l.ageDays}d ago) ${l.author}`);
    console.log(`    ${l.title}`);
    console.log(`    Budget: ${l.budget} | Triggers: ${l.triggers.join(', ')}`);
    console.log(`    URL: ${l.url}\n`);
  });

  if (csvPath) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Score', 'Tier', 'Source', 'AgeDays', 'Author', 'Budget', 'Title', 'URL'].join(','),
      ...top.map((l) => [l.score, l.tier, l.source, l.ageDays, l.author, l.budget, l.title, l.url].map(esc).join(','))
    ];
    fs.writeFileSync(csvPath, rows.join('\n'), 'utf8');
    console.log(`Saved CSV: ${csvPath}`);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });

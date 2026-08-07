// server.js — zero-dependency local server for Poems app
// Serves static files + /scrape endpoint to fetch & parse poem pages.
//
// Usage:  node server.js
// Then open http://localhost:8920

const http   = require('node:http');
const https  = require('node:https');
const fs     = require('node:fs');
const path   = require('node:path');
const { URL } = require('node:url');

const PORT = 8920;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── static file server ──────────────────────────────────
function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath);
  const ct = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}

// ── fetch helper ────────────────────────────────────────
function fetchUrl(urlStr, maxRedirects = 5, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    function doFetch(u, redirectsLeft) {
      const parsed = new URL(u);
      const opts = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
      };
      const transport = u.startsWith('https') ? https : http;
      const req = transport.get(opts, (resp) => {
        if ([301,302,303,307,308].includes(resp.statusCode) && resp.headers.location && redirectsLeft > 0) {
          doFetch(new URL(resp.headers.location, u).href, redirectsLeft - 1);
          return;
        }
        if (resp.statusCode !== 200) { reject(new Error(`HTTP ${resp.statusCode}`)); return; }
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf-8'), finalUrl: u }));
      }).on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('fetch timeout')); });
    }
    doFetch(urlStr, maxRedirects);
  });
}

// ── line cleaning helpers ───────────────────────────────
const SKIP_PATTERN = /^(Home|About|Contact|Search|Menu|Share|Tweet|Print|Subscribe|Login|Sign|Back to|Previous|Next|Page \d|Copyright|Privacy|Terms|Cookie|All rights|Poems|Poetry|Collection|Browse|Read|Add to anthology|Email|Facebook|Twitter|Donate|Join|Register|Log in|Log out|Skip to|Main content|Footer|Table of contents|Contents|Index|List of poems|Poem \d+|Return to|Go to|Top|Scroll|Close)/i;
const PUNCT_ONLY   = /^[\d\s.,;:!?\-—…'"()\[\]{}*#@$%^&+=/\\|<>~`]+$/;
// lines that signal the poem has ended and post-content begins
const END_OF_POEM = /^(Related|Share this|Like this|You (might|may) also|If you (like|enjoy)|About the (author|poet)|Published (in|on)|Originally published|Source:|Via |Found (at|on|in)|Read (more|next)|Previous poem|Next poem|Comments|Leave a (comment|reply)|Sign up for|Subscribe to|Follow (us|me)|Connect with|Tags:|Filed under|Categories:|Posted (in|by|on)|Written by|Photo (by|credit)|Image (by|credit)|© \d|All rights reserved)/i;

function cleanLines(rawLines, title, poet) {
  const out = [];
  for (let l of rawLines) {
    l = l.trim();
    // stop at first line that looks like post-poem content
    if (END_OF_POEM.test(l)) break;
    if (l.length > 200) continue;
    if (SKIP_PATTERN.test(l)) continue;
    if (PUNCT_ONLY.test(l)) continue;
    if (title && l === title) continue;
    if (poet && poet !== 'Unknown' && l === poet) continue;
    if (l === '' && out.length > 0 && out[out.length - 1] === '') continue;
    out.push(l);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  // deduplicate consecutive
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i] === out[i - 1]) out.splice(i, 1);
  }
  // strip trailing parenthetical poet attribution like "(Mary Oliver)"
  if (out.length > 0 && poet && poet !== 'Unknown') {
    const last = out[out.length - 1].trim();
    const parenName = `(${poet})`;
    if (last === parenName || last === `—${poet}` || last === `- ${poet}`) {
      out.pop();
      while (out.length && out[out.length - 1] === '') out.pop();
    }
  }
  return out;
}

function htmlToLines(html) {
  let plain = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?[a-z0-9]+;/gi, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return plain.split('\n');
}

function extractTitle(blockHtml) {
  // try <title> in full page, or <h1>-<h3> in block
  let t = '';
  const h1 = blockHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) t = h1[1];
  if (!t) {
    const h2 = blockHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2) t = h2[1];
  }
  if (!t) {
    const h3 = blockHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) t = h3[1];
  }
  if (t) {
    t = t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    // remove "by Poet" suffix
    const bym = t.match(/^(.*?)\s+[Bb]y\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*$/);
    if (bym) t = bym[1].trim();
    return t;
  }
  return '';
}

function extractPoet(blockHtml, fallbackPoet) {
  // try "by Poet" in a heading or nearby text
  const patterns = [
    /<h[1-3][^>]*>[\s\S]*?\b[Bb]y\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)[\s\S]*?<\/h[1-3]>/i,
    /<p[^>]*>\s*[Bb]y\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*<\/p>/i,
    /<span[^>]*>\s*[Bb]y\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*<\/span>/i,
  ];
  for (const p of patterns) {
    const m = blockHtml.match(p);
    if (m) {
      const candidate = m[1];
      // sanity: reject if any word looks like a common title word, not a person name
      const titleWords = /^(Woods|Road|Evening|Night|Morning|Song|Love|Death|Life|Time|World|Sea|Fire|Ice|Gold|Nothing|Dream|Wind|Rain|Snow|Sun|Moon|Star|Tree|River|Hill|Garden|Rose|Bird|Heart|Soul|Hand|Eye|Door|Way|Day|Light)$/i;
      if (candidate.split(/\s+/).some(w => titleWords.test(w))) {
        continue;
      }
      return candidate;
    }
  }
  return fallbackPoet || '';
}

function detectGlobalPoet(fullHtml, url) {
  // ── 1. URL-based hint (strongest signal) ──
  const urlPoet = poetFromUrl(url);
  if (urlPoet) return { poet: urlPoet, source: 'url' };

  // ── 2. "Title by Poet" in <title> ──
  const tm = fullHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) {
    let t = tm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    t = t.replace(/\s*[-–|]\s*.*?(Poetry|Poem|Foundation|Academy|Poets|org|com).*$/i, '');
    t = t.replace(/\s*\|.*$/, '').replace(/\s*—.*$/, '');
    const bym = t.match(/\s+[Bb]y\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+)+)\s*$/);
    if (bym) return { poet: bym[1].trim(), source: 'title' };
  }

  // ── 3. meta author (weakest — often site owner) ──
  let m = fullHtml.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i);
  if (m) return { poet: m[1], source: 'meta' };
  m = fullHtml.match(/<meta[^>]+name=["']dc\.creator["'][^>]+content=["']([^"']+)/i);
  if (m) return { poet: m[1], source: 'meta' };

  return { poet: '', source: 'none' };
}

// ── extract poet name from URL path ──
function poetFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    // /poems-by-mary-oliver/ (single slug segment)
    let m = path.match(/\/(?:poems?-by)-([a-z0-9-]+)\//);
    if (m) return nameFromSlug(m[1]);
    // /poems-by/mary-oliver/ (two segments)
    m = path.match(/\/(?:poems?-by)\/([a-z0-9-]+)/);
    if (m) return nameFromSlug(m[1]);
    // /poet/emily-dickinson/ or /author/walt-whitman/
    m = path.match(/\/(?:poet|author|writer)\/([a-z0-9-]+)/);
    if (m) return nameFromSlug(m[1]);
  } catch {}
  return '';
}

function nameFromSlug(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── multi-poem parser ───────────────────────────────────
function parsePoems(fullHtml, url) {
  let clean = fullHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const global = detectGlobalPoet(fullHtml, url);
  const globalPoet = global.poet;
  const poetIsFromUrl = global.source === 'url';
  let blocks = [];

  // Strategy 1: multiple <article> tags
  const articles = [...clean.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)];
  if (articles.length > 1) {
    blocks = articles.map(a => a[0]);
  }

  // Strategy 2: multiple poem/verse divs
  if (blocks.length <= 1) {
    const divs = [...clean.matchAll(/<(?:div|section)[^>]*?(?:class|id)=["'][^"']*?(?:poem|verse|stanza|poem-content|poem-body)[^"']*?["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi)];
    if (divs.length > 1) {
      blocks = divs.map(d => d[0]);
    }
  }

  // Strategy 3: <li> items that contain poem titles + text
  if (blocks.length <= 1) {
    const listItems = [...clean.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    // filter to those containing enough text to be a poem
    const poemLis = listItems.filter(li => {
      const txt = li[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return txt.length > 60; // substantial text
    });
    if (poemLis.length > 1) {
      blocks = poemLis.map(li => li[0]);
    }
  }

  // Strategy 4: split by <h2>/<h3> poem title headers
  if (blocks.length <= 1) {
    // find <h2> or <h3> tags that look like poem titles (not nav headers)
    const splits = clean.split(/(<h[23][^>]*>[\s\S]*?<\/h[23]>)/gi);
    if (splits.length > 3) {
      // group: header + following content
      const candidates = [];
      let current = '';
      for (let i = 0; i < splits.length; i++) {
        if (/^<h[23]/i.test(splits[i])) {
          if (current.trim()) candidates.push(current);
          current = splits[i];
        } else {
          current += splits[i];
        }
      }
      if (current.trim()) candidates.push(current);
      // filter to those with enough content
      const rich = candidates.filter(c => {
        const txt = c.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        return txt.length > 80;
      });
      if (rich.length > 1) {
        blocks = rich;
      }
    }
  }

  // If we found multiple blocks, parse each
  if (blocks.length > 1) {
    return blocks.map(block => {
      const title = extractTitle(block);
      // when URL tells us the poet, trust it over per-block bylines (site credits)
      const poet = poetIsFromUrl ? globalPoet : extractPoet(block, globalPoet);
      const rawLines = htmlToLines(block);
      const lines = cleanLines(rawLines, title, poet);
      return { title: title || 'Untitled', poet: poet || globalPoet || 'Unknown', lines };
    }).filter(p => p.lines.length >= 2); // require at least 2 meaningful lines
  }

  // ── fallback: single poem ──
  const pageTitle = extractTitle(clean);
  const poet = poetIsFromUrl ? globalPoet : extractPoet(clean, globalPoet);
  let bodyText = '';
  const article = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article) {
    bodyText = article[1];
  } else {
    const poemDiv = clean.match(/<(?:div|section)[^>]*?(?:class|id)=["'][^"']*?(?:poem|verse|content|main|entry)[^"']*?["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
    if (poemDiv) {
      bodyText = poemDiv[1];
    } else {
      const body = clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (body) bodyText = body[1];
    }
  }

  const rawLines = htmlToLines(bodyText);
  const lines = cleanLines(rawLines, pageTitle, poet);
  return [{ title: pageTitle || 'Untitled', poet: poet || globalPoet || 'Unknown', lines }];
}

// ── POST /scrape handler ───────────────────────────────
async function handleScrape(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { url } = JSON.parse(body);
      if (!url || !/^https?:\/\/.+/.test(url)) throw new Error('Invalid URL');

      console.log(`[scrape] fetching: ${url}`);
      const { body: html } = await fetchUrl(url);
      const poems = parsePoems(html, url);

      console.log(`[scrape] done — ${poems.length} poem(s) found`);
      poems.forEach((p, i) => console.log(`  ${i+1}. "${p.title}" by ${p.poet} — ${p.lines.length} lines`));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, poems }));
    } catch (err) {
      console.error(`[scrape] error: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// ── Removed-quotes queue (persisted feedback loop) ───
const QUEUE_PATH = path.join(ROOT, 'removed-queue.json');
let removedQueue = { items: [], lastAnalysisDate: null, analyzedCount: 0, analysisResult: '' };

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const raw = fs.readFileSync(QUEUE_PATH, 'utf-8');
      const q = JSON.parse(raw);
      removedQueue = { items: q.items || [], lastAnalysisDate: q.lastAnalysisDate || null, analyzedCount: q.analyzedCount || 0, analysisResult: q.analysisResult || '' };
      console.log(`[queue] loaded ${removedQueue.items.length} items, analyzed=${removedQueue.analyzedCount}`);
    }
  } catch (e) { console.error('[queue] load error:', e.message); }
}
function saveQueue() {
  try { fs.writeFileSync(QUEUE_PATH, JSON.stringify(removedQueue, null, 2), 'utf-8'); } catch (e) {}
}
loadQueue(); // init on start

// ── POST /queue-remove — append removed quote to FIFO queue
function handleQueueRemove(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const item = JSON.parse(body);
      item.removedAt = new Date().toISOString();
      removedQueue.items.push(item);
      // FIFO: keep last 50
      while (removedQueue.items.length > 50) removedQueue.items.shift();
      console.log(`[queue] added removal — ${item.poemTitle} by ${item.poemPoet}, total=${removedQueue.items.length}`);
      saveQueue();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

// ── Daily analysis of removed quotes ───────────────────
async function runQueueAnalysisIfNeeded() {
  const newItems = removedQueue.items.length - removedQueue.analyzedCount;
  if (newItems === 0) return;

  const now = new Date();
  const last = removedQueue.lastAnalysisDate ? new Date(removedQueue.lastAnalysisDate) : null;
  if (last && now - last < 24 * 60 * 60 * 1000) return; // <24h since last

  console.log(`[queue] running analysis on ${newItems} new removals`);
  const unanalyzed = removedQueue.items.slice(removedQueue.analyzedCount);

  const itemsText = unanalyzed.map((r, i) =>
    `${i+1}. Poem: "${r.poemTitle}" by ${r.poemPoet}\n   Removed: "${r.quote}"\n   Source: ${r.sourceTitle} (${r.sourceUrl})`
  ).join('\n\n');

  try {
    const resp = await callLLM([
      { role: 'system', content: 'You analyze patterns in removed quotes from a poem analysis tool. Find commonalities. Be concise.' },
      { role: 'user', content: `These quotes were removed from AI-generated poem analysis results by a human curator. Find the COMMON PATTERNS across them — what makes these quotes bad? What types of quotes should the AI avoid extracting?\n\nREMOVED QUOTES:\n${itemsText.substring(0, 4000)}\n\nReturn a short summary (3-5 bullets) of patterns to avoid. Format as plain text, no markdown.` }
    ], { maxTokens: 600 });

    const raw = resp.substring(0, 300);
    console.log(`[queue] LLM response: ${raw}`);
    removedQueue.analysisResult = (resp || '').trim();
    removedQueue.lastAnalysisDate = now.toISOString();
    removedQueue.analyzedCount = removedQueue.items.length;
    console.log(`[queue] analysis result: ${removedQueue.analysisResult.substring(0, 120)}...`);
  } catch (e) {
    console.error('[queue] analysis error:', e.message);
    // still mark as analyzed so we don't loop on failures
    removedQueue.lastAnalysisDate = now.toISOString();
    removedQueue.analyzedCount = removedQueue.items.length;
  }
  saveQueue();
}

function getQueueGuidance() {
  if (removedQueue.analysisResult && removedQueue.analyzedCount > 0) {
    return `\nQUALITY GUIDANCE (based on previously removed quotes — follow strictly):\n${removedQueue.analysisResult}\n`;
  }
  return '';
}

// ── POST /save handler ─────────────────────────────────
function handleSave(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { poems } = JSON.parse(body);
      if (!Array.isArray(poems)) throw new Error('Invalid data');

      // write back to poems.js
      const lines = ['// poems.js — Poem store (auto-saved)','// Each entry: { id, title, poet, lines[] }',
        '// Empty strings in lines[] create stanza breaks.','var POEMS = [', ''];

      poems.forEach((p, i) => {
        lines.push('{');
        lines.push(`  id: ${JSON.stringify(p.id)},`);
        lines.push(`  title: ${JSON.stringify(p.title)},`);
        lines.push(`  poet: ${JSON.stringify(p.poet)},`);
        lines.push('  lines: [');
        p.lines.forEach((l, j) => {
          const comma = j < p.lines.length - 1 ? ',' : '';
          lines.push(`    ${JSON.stringify(l)}${comma}`);
        });
        lines.push('  ]');
        if (p.annotations && p.annotations.length) {
          lines.push('  ,annotations: [');
          p.annotations.forEach((a, j) => {
            const comma = j < p.annotations.length - 1 ? ',' : '';
            lines.push(`    ${JSON.stringify(a)}${comma}`);
          });
          lines.push('  ]');
        }
        lines.push(`}${i < poems.length - 1 ? ',' : ''}`);
        lines.push('');
      });

      lines.push('];');
      lines.push('');

      fs.writeFileSync(path.join(ROOT, 'poems.js'), lines.join('\n'), 'utf-8');
      console.log(`[save] wrote ${poems.length} poems to poems.js`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(`[save] error: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}

// ── DuckDuckGo HTML search ────────────────────────────
async function searchWeb(title, poet) {
  const query = `${title} ${poet} poem analysis`;
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
    const { body: html } = await fetchUrl(url);
    const results = [];
    const blockRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = blockRe.exec(html)) && results.length < 10) {
      const rawUrl = m[1].replace(/&amp;/g, '&');
      const urlMatch = rawUrl.match(/uddg=([^&]+)/);
      const realUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const snippet = m[3].replace(/<[^>]+>/g, '').trim();
      if (title && realUrl.startsWith('http')) {
        results.push({ title, snippet, url: realUrl });
      }
    }
    console.log(`[search] DDG found ${results.length} results`);
    return results.slice(0, 8);
  } catch (e) {
    console.error('[search] DDG error:', e.message);
    return [];
  }
}

async function searchDDG(query) { return searchWeb(...query.split(' ', 2)); }

// ── Load config ─────────────────────────────────────
let config = { LLM_API_KEY: '', LLM_URL: 'https://opencode.ai/zen/go/v1/chat/completions', LLM_MODEL: 'gpt-5.6-luna', LLM_REASON: 'deepseek-v4-flash' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8')) }; }
catch (e) { console.error('[config] Could not load config.json — using defaults. Create config.json with your API key.'); }

const { LLM_API_KEY, LLM_URL, LLM_MODEL, LLM_REASON } = config;

async function callLLM(messages, opts = {}) {
  const model = opts.model || LLM_MODEL;
  const maxTok = opts.maxTokens || 4096;
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model,
      messages,
      max_tokens: maxTok,
      temperature: 0.4
    });
    const url = new URL(LLM_URL);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`LLM returned ${res.statusCode}: ${body.substring(0, 200)}`));
            return;
          }
          const j = JSON.parse(body);
          if (j.error) { reject(new Error(j.error.message || 'LLM error')); return; }
          resolve(j.choices[0].message.content);
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── stanza splitter ──────────────────────────────────
function splitStanzas(lines) {
  const stanzas = [];
  let current = [];
  for (const l of lines) {
    const trimmed = l.trim();
    if (trimmed === '') {
      if (current.length > 0) { stanzas.push(current); current = []; }
    } else {
      current.push(trimmed);
    }
  }
  if (current.length > 0) stanzas.push(current);
  return stanzas;
}

// ── line-annotation job ────────────────────────────
async function processLineAnnotationJob(jobId, title, poet, lines) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    const stanzas = splitStanzas(lines);
    console.log(`[job:${jobId}] line-annotate: "${title}" — ${stanzas.length} stanzas`);

    job.status = 'searching';
    notify(job, 'status', { status: 'searching', label: 'Searching for analysis…' });

    // use the same two-tier search as analyze
    const searchResults = await searchWeb(title, poet);
    console.log(`[job:${jobId}] ${searchResults.length} unique search results`);

    if (searchResults.length === 0) {
      job.status = 'done'; job.annotations = [];
      notify(job, 'status', { status: 'done' });
      notify(job, 'result', { lineAnnotations: [] });
      return;
    }

    job.status = 'scraping';
    notify(job, 'status', { status: 'scraping', label: 'Reading analysis pages…' });
    const JUNK_DOMAINS = /scribd\.com|coursehero\.com|chegg\.com|studocu\.com|academia\.edu|brainly\.com/i;
    const scrapedPages = [];
    for (const sr of searchResults) {
      if (scrapedPages.length >= 3) break;
      if (JUNK_DOMAINS.test(sr.url)) continue;
      try {
        console.log(`[job:${jobId}] scrape: ${sr.url.substring(0, 80)}`);
        const { body: html } = await fetchUrl(sr.url, 5, 20000);
        const paragraphs = [];
        const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        let pm;
        while ((pm = pRe.exec(html)) && paragraphs.length < 40) {
          const txt = pm[1].replace(/<[^>]+>/g, '').trim();
          if (txt.length > 40 && txt.length < 2000) paragraphs.push(txt);
        }
        if (paragraphs.length > 0) {
          scrapedPages.push({ url: sr.url, title: sr.title, text: paragraphs.join('\n\n').substring(0, 3000) });
          console.log(`[job:${jobId}]   -> ${paragraphs.length} paragraphs`);
        }
      } catch (e) { console.log(`[job:${jobId}]   -> failed: ${e.message}`); }
    }
    // only add snippets if we have fewer than 2 real sources
    if (scrapedPages.length < 2) {
      for (const sr of searchResults) {
        if (scrapedPages.length >= 3) break;
        if (sr.snippet && !scrapedPages.find(p => p.url === sr.url)) {
          scrapedPages.push({ url: sr.url, title: sr.title, text: sr.snippet });
        }
      }
    }

    console.log(`[job:${jobId}] scraped ${scrapedPages.length} sources:`);
    scrapedPages.forEach(p => console.log(`  - ${p.title} (${p.url.substring(0, 60)})`));

    if (scrapedPages.length === 0) {
      job.status = 'done'; job.annotations = [];
      notify(job, 'status', { status: 'done' });
      notify(job, 'result', { lineAnnotations: [] });
      return;
    }

    job.status = 'analyzing';
    notify(job, 'status', { status: 'analyzing', label: 'Matching stanzas to analysis…' });

    const stanzasBlock = stanzas.map((s, i) =>
      `[STANZA ${i}]\n${s.join('\n')}`
    ).join('\n\n');

    const sourcesBlock = scrapedPages.map((p, i) =>
      `[SOURCE ${i+1}] Title: ${p.title}\nURL: ${p.url}\nContent:\n${p.text}`
    ).join('\n\n');

    const prompt = `Match each stanza of this poem to its explanation from the analysis sources below. Different stanzas may come from different sources — pick the best explanation for each stanza.

POEM: "${title}" by ${poet}

${stanzasBlock}

--- ANALYSIS SOURCES ---
${sourcesBlock.substring(0, 14000)}

---
For each stanza above, find which source explains or analyzes that specific stanza. Requirements:
- "stanzaIndex": the stanza number (0-based)
- "explanation": EXACT text from a source. No paraphrasing. No invented analysis.
- "sourceTitle": the title of whichever source the explanation came from
- "sourceUrl": the URL of that source
- Each stanza can use a different source — pick the best one for each.
- Skip stanzas that have no matching explanation in any source.

Return ONLY a raw JSON array, no markdown:
[{"stanzaIndex":0,"explanation":"Verbatim text from the source...","sourceTitle":"Article Title","sourceUrl":"https://..."}]`;

    console.log(`[job:${jobId}] calling LLM with ${scrapedPages.length} sources`);
    const llmResponse = await callLLM(
      [{ role: 'user', content: prompt }],
      { model: LLM_MODEL, maxTokens: 4096 }
    );

    let lineAnnotations = [];
    try {
      const m = llmResponse.match(/\[[\s\S]*\]/);
      if (m) {
        lineAnnotations = JSON.parse(m[0]).filter(a =>
          a.stanzaIndex != null && a.explanation && a.sourceUrl
        );
        lineAnnotations.forEach(a => {
          if (stanzas[a.stanzaIndex]) {
            a.stanzaText = stanzas[a.stanzaIndex];
          }
        });
      }
    } catch (e) { console.error(`[job:${jobId}] parse: ${e.message}`); }

    console.log(`[job:${jobId}] done — ${lineAnnotations.length} stanza annotations`);
    if (lineAnnotations.length === 0) {
      console.log(`[job:${jobId}] LLM raw (first 600): ${llmResponse.substring(0, 600)}`);
    }
    job.annotations = lineAnnotations;
    job.status = 'done';
    notify(job, 'status', { status: 'done' });
    notify(job, 'result', { lineAnnotations });
  } catch (err) {
    console.error(`[job:${jobId}] error: ${err.message}`);
    job.status = 'error';
    job.error = err.message;
    notify(job, 'status', { status: 'error', error: err.message });
  }
}

// ── SSE helpers ──────────────────────────────────────
function sseOpen(res, jobId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(':ok\n\n');
}
function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── job queue with SSE push ──────────────────────────
const jobs = new Map();
let jobCounter = 0;

function createJob() {
  const id = String(++jobCounter);
  jobs.set(id, { status: 'queued', annotations: null, error: null, createdAt: Date.now(), listeners: new Set() });
  for (const [jid, j] of jobs) { if (Date.now() - j.createdAt > 600000) jobs.delete(jid); }
  return id;
}

function notify(job, event, data) {
  for (const res of job.listeners) {
    try { sseSend(res, event, data); } catch (e) { job.listeners.delete(res); }
  }
}

async function processJob(jobId, title, poet, lines) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    const poemText = lines.join('\n');
    console.log(`[job:${jobId}] searching: "${title}" by ${poet}`);

    // run daily queue analysis if needed (non-blocking)
    runQueueAnalysisIfNeeded().catch(e => console.error('[queue] analysis check failed:', e.message));
    const guidance = getQueueGuidance();

    job.status = 'searching';
    notify(job, 'status', { status: 'searching', label: 'Searching the web…' });

    const searchResults = await searchWeb(title, poet);
    console.log(`[job:${jobId}] found ${searchResults.length} results`);

    if (searchResults.length === 0) {
      job.status = 'done'; job.annotations = [];
      notify(job, 'status', { status: 'done' });
      notify(job, 'result', { annotations: [] });
      return;
    }

    job.status = 'scraping';
    notify(job, 'status', { status: 'scraping', label: 'Reading analysis pages…' });
    const JUNK_DOMAINS = /scribd\.com|coursehero\.com|chegg\.com|studocu\.com|academia\.edu|brainly\.com/i;
    const scrapedPages = [];
    for (const sr of searchResults) {
      if (scrapedPages.length >= 2) break;
      if (JUNK_DOMAINS.test(sr.url)) continue;
      try {
        const { body: html } = await fetchUrl(sr.url);
        const paragraphs = [];
        const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        let pm;
        while ((pm = pRe.exec(html)) && paragraphs.length < 30) {
          const txt = pm[1].replace(/<[^>]+>/g, '').trim();
          if (txt.length > 40 && txt.length < 2000) paragraphs.push(txt);
        }
        if (paragraphs.length > 0) {
          scrapedPages.push({ url: sr.url, title: sr.title, text: paragraphs.join('\n\n').substring(0, 4000) });
        }
      } catch (e) { /* skip */ }
    }
    for (const sr of searchResults) {
      if (scrapedPages.length >= 4) break;
      if (sr.snippet && !scrapedPages.find(p => p.url === sr.url)) {
        scrapedPages.push({ url: sr.url, title: sr.title, text: sr.snippet });
      }
    }

    job.status = 'analyzing';
    notify(job, 'status', { status: 'analyzing', label: 'Extracting quotes…' });
    const sourcesBlock = scrapedPages.length > 0
      ? scrapedPages.map((p, i) => `[SOURCE ${i+1}] Title: ${p.title}\nURL: ${p.url}\nContent: ${p.text}`).join('\n\n')
      : '[No sources]';

    const prompt = `You are extracting ANALYTICAL quotes about a poem. Find sentences that offer genuine insight: interpretation of meaning, analysis of literary devices, explanation of themes. Skip introductions, summaries, and generic praise.${guidance}\n\nPOEM: "${title}" by ${poet}\n\n${poemText.substring(0, 2000)}\n\n--- SOURCES ---\n${sourcesBlock.substring(0, 8000)}\n\n---\nRules:\n- "quote": EXACT text copied from a source. Do NOT paraphrase or write your own words.\n- "sourceTitle": article title\n- "sourceUrl": URL\n- Return [] if no source has a usable quote.\n- ONLY extract sentences that offer genuine insight: interpretation of meaning, analysis of technique, discussion of themes. DO NOT extract introductions (like "Read X's poem..."), summaries, or generic praise.\n- At most 2 quotes per source. Spread quotes across different sources.\n- Return 4-6 quotes total.\n\nJSON array only, no markdown:\n[{"quote":"Verbatim text from source...","sourceTitle":"Article Title","sourceUrl":"https://..."}]`;

    console.log(`[job:${jobId}] calling LLM`);
    const llmResponse = await callLLM([{ role: 'user', content: prompt }]);

    let annotations = [];
    try {
      const m = llmResponse.match(/\[[\s\S]*\]/);
      if (m) { annotations = JSON.parse(m[0]).filter(a => a.quote && a.sourceUrl); }
    } catch (e) { console.error(`[job:${jobId}] parse: ${e.message}`); }

    console.log(`[job:${jobId}] done — ${annotations.length} annotations`);
    job.annotations = annotations;
    job.status = 'done';
    notify(job, 'status', { status: 'done' });
    notify(job, 'result', { annotations });
  } catch (err) {
    console.error(`[job:${jobId}] error: ${err.message}`);
    job.status = 'error';
    job.error = err.message;
    notify(job, 'status', { status: 'error', error: err.message });
  }
}

// ── POST /analyze (start job, return immediately) ──────
function handleAnalyze(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { title, poet, lines } = JSON.parse(body);
      if (!title || !poet || !lines) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing poem data' }));
        return;
      }
      const jobId = createJob();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, jobId }));
      processJob(jobId, title, poet, lines);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

// ── GET /analyze-events/:id (SSE stream) ──────────────
function handleAnalyzeEvents(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Job not found' }));
    return;
  }
  sseOpen(res, jobId);
  job.listeners.add(res);
  // send current status immediately
  sseSend(res, 'status', job.status === 'error'
    ? { status: job.status, error: job.error }
    : { status: job.status });
  if (job.status === 'done') {
    sseSend(res, 'result', { annotations: job.annotations || [] });
    job.listeners.delete(res);
    res.end();
    return;
  }
  req.on('close', () => { job.listeners.delete(res); });
}

// ── POST /annotate-lines (start line-annotation job) ─
function handleAnnotateLines(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { title, poet, lines } = JSON.parse(body);
      if (!title || !poet || !lines) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing poem data' }));
        return;
      }
      const jobId = createJob();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, jobId }));
      processLineAnnotationJob(jobId, title, poet, lines);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

// ── GET /annotate-events/:id (SSE for line-annotation) ─
function handleAnnotateEvents(req, res, jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Job not found' }));
    return;
  }
  sseOpen(res, jobId);
  job.listeners.add(res);
  sseSend(res, 'status', job.status === 'error'
    ? { status: job.status, error: job.error }
    : { status: job.status });
  if (job.status === 'done') {
    sseSend(res, 'result', { lineAnnotations: job.annotations || [] });
    job.listeners.delete(res);
    res.end();
    return;
  }
  req.on('close', () => { job.listeners.delete(res); });
}

// ── router ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const analyzeEvents = urlPath.match(/^\/analyze-events\/(\d+)$/);
  const annotateEvents = urlPath.match(/^\/annotate-events\/(\d+)$/);
  if (req.method === 'POST' && urlPath === '/scrape')            { handleScrape(req, res); return; }
  if (req.method === 'POST' && urlPath === '/save')              { handleSave(req, res); return; }
  if (req.method === 'POST' && urlPath === '/queue-remove')      { handleQueueRemove(req, res); return; }
  if (req.method === 'POST' && urlPath === '/analyze')           { handleAnalyze(req, res); return; }
  if (req.method === 'POST' && urlPath === '/annotate-lines')    { handleAnnotateLines(req, res); return; }
  if (req.method === 'GET' && analyzeEvents)                      { handleAnalyzeEvents(req, res, analyzeEvents[1]); return; }
  if (req.method === 'GET' && annotateEvents)                     { handleAnnotateEvents(req, res, annotateEvents[1]); return; }
  if (req.method === 'GET') { serveStatic(req, res); return; }
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`\n  📜 Poems server running at http://localhost:${PORT}\n`);
  console.log('  Open that address in your browser.\n');
  console.log('  Use the + button in the sidebar to import poems by URL.\n');
});

// keep process alive on unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err.message || err);
});

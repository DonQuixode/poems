# Poems

A local poetry reading app with LLM-powered analysis. Dark theme, Apple Music lyrics aesthetic. Zero dependencies.

![UI](/poetica.jpeg)

## Requirements

- Node.js 18 or later
- An [opencode-go](https://opencode.ai) API key (for the Analyze feature)

## Setup

```bash
git clone https://github.com/you/poems
cd poems
cp config.example.json config.json
```

Edit `config.json` and replace the placeholder with your API key:

```json
{
  "LLM_API_KEY": "sk-your-actual-key",
  "LLM_URL": "https://opencode.ai/zen/go/v1/chat/completions",
  "LLM_MODEL": "gpt-5.6-luna",
  "LLM_REASON": "deepseek-v4-flash"
}
```

## Run

```bash
./start.sh
```

Open **http://localhost:8920** in your browser.

Stop with:

```bash
./stop.sh
```

## Features

| Feature | How |
|---------|-----|
| **Browse** | 80 poems pre-loaded (T.S. Eliot, Mary Oliver, Agha Shahid Ali) |
| **Search** | Press `/` to focus the search bar, filter by title or poet |
| **Author groups** | Sidebar groups poems by poet, expand/collapse with counts |
| **Import** | Click **+** to import a poem/multiple poems from any URL |
| **Edit** | Click the edit icon to modify title, poet, or lines |
| **Delete** | Two-tier confirmation: remove from view or delete forever |
| **Analyze** | Click **Analyze** to search the web for literary analysis. Quotes appear in a side panel with source links. |
| **Curate** | Remove unhelpful quotes with **×**. Removed quotes feed back into future analysis quality. |
| **Copy** | Select and copy poem text freely |

The Analyze button sends the poem title and poet to DuckDuckGo, scrapes the top results, and asks an LLM to extract analytical quotes from the sources. Each quote links back to its original article.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `Esc` | Clear search |

## How it works

```
Browser → your Node server → DuckDuckGo (search)
                            → source websites (scrape)
                            → opencode-go LLM (extract quotes)
                            → poems.js on disk (persist)
```

No database. No npm packages. Just a single Node.js script serving static files and proxying LLM calls.

## Files

| File | Purpose |
|------|---------|
| `server.js` | HTTP server + scrape + analyze + save |
| `index.html` | Frontend UI |
| `poems.js` | Poem data (auto-saved) |
| `config.json` | Your API key (gitignored) |
| `removed-queue.json` | Curated removal history (gitignored) |
| `start.sh` / `stop.sh` | Start/stop scripts |

## Keeping costs low

Your only cost is LLM API calls — roughly $0.005 per analysis. The server caches results in `poems.js` so re-analyzing the same poem costs nothing. The removal feedback loop improves quote quality over time, reducing the need for re-analysis.

## Features in development

- **Line-by-line annotations** — tap a line to see its analysis

## Requests

For feature requests or bug reports, either:

- [Open a GitHub issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/creating-an-issue) on the repo
- Email [umaralikhan1299@gmail.com](mailto:umaralikhan1299@gmail.com)

## License

MIT

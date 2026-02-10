# AdPerx (MVP) — “Perplexity for Advertising”
A lightweight web app that turns **award-winning work links** into a **fast, interactive, filterable search experience**.

This repo is designed around **LoveTheWorkMore** as a *source of links* (you can scrape + index the pages you have permission to use), then browse work by:
- Free-text search (titles/brands/agencies/notes)
- Facets: year, brand, agency, “format” (film/print/digital/etc), topics (women’s rights, sustainability, etc), and industries (e.g., airlines)

> ⚠️ Legal + ethics note  
> Before scraping or re-hosting any content, **review the site’s Terms / robots.txt** and get permission where needed.  
> This project stores **metadata + outbound links**; it does not mirror videos or case-study assets.

---

## What you get
- **Next.js** web app (App Router)
- **Search API** with MiniSearch (no native deps, fast)
- **Faceted UI** (sidebar filters + quick chips)
- **Detail modal** with link-outs + embedded preview (when possible)
- **Scraper script** (best-effort HTML parsing) to build `data/campaigns.json`
- **Index builder** to generate `data/index.json` for faster startup
- Optional **“Ask”** mode that answers questions using retrieved campaigns (supports OpenAI if you add a key)

---

## Quick start (no scraping)
```bash
npm install
npm run dev
```

The UI will start with a tiny sample dataset in `data/campaigns.sample.json`.
To use it, copy it to `data/campaigns.json`:

```bash
cp data/campaigns.sample.json data/campaigns.json
npm run build:index
npm run dev
```

---

## Build your own dataset (scrape + index)
### 1) Scrape (best-effort)
```bash
npm run scrape:ltwm
```
This attempts to crawl year pages from LoveTheWorkMore and extract lines + outbound links into:
- `data/campaigns.json`

### 2) Build the search index
```bash
npm run build:index
```
Generates:
- `data/index.json`

### 3) Run the app
```bash
npm run dev
```

---

## Environment variables (optional)
Create `.env.local`:
```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```
If no key is set, “Ask” will fall back to a non-AI summary of top matches.

---

## Roadmap ideas (high impact)
- **“Industry packs”**: airlines, telco, FMCG, automotive, etc (curated keyword maps + airline brand list).
- **Entity extraction**: brand/agency normalization, auto-tagging by award category.
- **Better previews**: oEmbed for YouTube/Vimeo, thumbnails caching.
- **Collections & moodboards**: save + share boards, export to PDF.
- **RAG citations**: answer with direct deep-links to the exact case study pages.
- **Multi-source ingestion**: AdForum, Ads of the World, Lürzer’s, WARC (where licensing permits).

---

## License
MIT for the code. Content linked from third-party sites belongs to their respective owners.

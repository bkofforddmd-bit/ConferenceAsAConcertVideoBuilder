# Conference As A Concert Studio

*Higher Ground Through Holier Sound.* Turn a General Conference talk into an
original song, a consistent visual storyboard, animated clips, and a finished
music video — all inside one app.

## The flow

**Library** — find a talk: search by speaker, by topic, AI search, Insights,
Quotes, Talk builder, Becoming journal, browse by conference; listen or watch
any talk with the built-in player.

**Create** — the production pipeline, one step at a time:

1. **Talk** — chosen from the Library (or paste the text).
2. **Lyrics** — Claude writes original lyrics that teach the talk's
   principles; edit, revise, finalize.
3. **Music** — the lyrics are sung by Google **Lyria 3.5** (or MiniMax via
   fal.ai). Pick voices and style; keep several takes.
4. **Storyboard** — a style bible + scene list (Claude), one image per scene
   (OpenAI gpt-image-2) with reference-locked consistency, intro/outro cards,
   PowerPoint / image / lyrics exports.
5. **Video** — each scene image becomes a short clip (Kling 3.0 via fal.ai,
   or Google Veo 3.1), scenes are timed to the song (auto, numeric, or "tap
   along"), and the final 1080p music video is rendered in the browser.
6. **Export** — everything in one place.

**Projects** — named projects auto-save in the browser (IndexedDB, including
songs/clips/renders); `.json` download/upload still works for moving the
talk + lyrics + scenes + images between computers.

**Settings** — API keys. The site owner can set keys on Netlify; anyone can
also paste their own keys, which stay in that browser and are sent only to
this app's own functions.

## Tech

- **Frontend**: React + Vite (static → Netlify CDN). Brand: deep navy /
  air blue / sky blue / silver / cloud white; Michroma + Inter.
- **Backend**: Netlify Functions (`netlify/functions/*.js`). Shared helpers in
  `netlify/lib/`. API keys never reach the browser (except keys a user pastes
  for themselves, which go out only as `x-user-*-key` headers to these functions).
- **Models**: Claude (lyrics, scenes, insights), gpt-image-2 (images),
  Lyria 3.5 / MiniMax (song), Kling 3.0 / Veo 3.1 (clips).
- Long jobs (song, clip) are asynchronous: `music-start` / `video-start`
  return a job id; the browser polls `music-status` / `video-status`
  (Netlify functions have a 10-second limit, so nothing waits server-side).
  Generated files are fetched directly, or through the host-locked
  `fetch-media` proxy when a provider's CDN lacks CORS headers.
- The final video is recorded client-side (canvas + MediaRecorder, MP4 in
  Chrome/Edge). Nothing is uploaded.

## Setup

```bash
npm install
```

Environment variables (Netlify → Site settings → Environment variables, or a
local `.env`):

```
ANTHROPIC_API_KEY=sk-ant-...   # lyrics, scenes, insights
OPENAI_API_KEY=sk-...          # scene images
GEMINI_API_KEY=...             # Lyria music + Veo video (aistudio.google.com)
FAL_KEY=...                    # Kling clips + MiniMax music (fal.ai)
```

Any of these can be left out; the Settings panel then shows "needs key" and a
user can paste their own.

## Local development

`netlify dev` runs the functions beside Vite. If its framework proxy
misbehaves on your machine, build with `npm run build` and serve `dist/` with
any static server that also invokes the functions (each function is an ESM
`default async (Request) => Response`).

## Deploy

GitHub-connected Netlify site: push to `main`; Netlify runs `npm run build`
and publishes `dist/` with `netlify/functions`.

## Data refresh after each conference

The talk pages go up on churchofjesuschrist.org the weekend of conference.
Until this refresh is deployed, the app tops up the static talk list live
(`src/lib/talks-index.js` asks `list-conference` for any conference newer than
`talks-index.json`), so speaker search and the Video step's talk chooser still
find the new talks — but topics, AI search, Insights and the scripture index
only know the new conference after these run, in this order:

1. `node scripts/build-talk-index.js` → `public/talks-index.json` + `topics-index.json`
2. `node scripts/build-search-index.js` → `public/search-index.json` (caches talk text in `data/talk-texts/`)
3. `node scripts/build-portraits-index.js` → `public/portraits-index.json` (new speakers' photos)
4. `node scripts/crawl-text.mjs` → `data/talk-text.jsonl` (only the new talks are fetched)
5. `node scripts/crawl-citations.mjs` → `data/citations.jsonl` (only the new talks)
6. `node scripts/compile-citations.cjs` → `public/scripture-index.json` (+ `data/scripture-index.v1.json`)
7. `node scripts/compile-text.cjs` → `public/talk-text/d<decade>.json` (Insights → Words & phrases)
8. `node scripts/compile-citations-v2.cjs` → `public/scripture-index.json` with unmarked quotations
   (needs `data/scriptures.jsonl`; build it once with `node scripts/crawl-scriptures.mjs`)

`data/` is a gitignored local cache — keep it between refreshes so each run
only fetches what's new. Everything in it is keyed by talk uri, so it survives
the position shifts that adding a conference causes in `talks-index.json`
(`topics-index.json`, `search-index.json`, `scripture-index.json` and the
`talk-text/` bundles all refer to talks by position and must be regenerated
together with `talks-index.json`).

## Campus Sessions (BYU student engagement experiment)

A separate, sign-in-only mode at **/campus** (workers) and **/campus/admin**
(administrators). Nothing links to it from the public Studio. A worker asks a
student for their favorite October 2026 talk, checks whether the Concert
library already has a song for it, captures a media-release consent (finger
signature), writes lyrics with the Studio's generator, hands off to MelodyCraft
AI for the song, and records the outcome. Every step is saved on the server so
an interrupted session resumes from the home screen.

Code: `netlify/functions/campus-*.js`, `netlify/lib/campus-*.js`,
`src/campus/`. Data lives in the Netlify Blobs store `campus` (documents:
`user:`, `email:`, `invite:`, `session:`, `consent:`, `settings:`,
`consent-version:`). No database or migration is involved. Participant names,
emails and signatures exist only in `consent:` records, which only an
administrator can read, by session id.

### Setup (one time)

1. In Netlify → Site configuration → Environment variables add
   `CAMPUS_SESSION_SECRET` (any long random string; signs sign-in tokens) and
   `CAMPUS_ADMIN_SECRET` (the one-time setup secret for the first administrator).
   Make sure `ANTHROPIC_API_KEY` is set on the site too — workers never enter
   AI keys. Redeploy.
2. Open `/campus`, tap **First time here? Set up the administrator**, enter
   the setup secret, your name, email and a password.
3. Admin panel → **Release text**: read the draft media release, edit it if
   needed, and have it reviewed by legal counsel before public use of any
   recording. Tick "reviewed by legal counsel" when that's done.
4. Admin panel → **Settings**: confirm the MelodyCraft AI address.
5. Admin panel → **Workers**: invite each worker; send them the one-time link.

Tests: `node --test tests/campus.test.mjs` (authorization, consent rules,
session state transitions, admin-only lookups).

Phases still to come: 2 — timekeeping (clock in/out, corrections, monthly
pay periods, payroll report); 3 — analytics (funnel, by worker and date,
CSV export); 4 — QR sharing and follow-ups.

## Notes

- Talks are © Intellectual Reserve, Inc. Lyrics are original paraphrase; the
  intro/outro cards carry a "not an official Church production" disclaimer.
  Review the Church's terms of use before public distribution.
- Costs (approx., billed by each provider): song $0.03–0.08; clip $0.56 (Kling
  5 s 1080p) to $0.96 (Veo 8 s); images $0.05–0.20 each; Claude a few cents
  per step. Rendering the final video is free.
- The brand is aerospace-inspired, not USAF or Church branding; the mark is
  an original SVG (`src/components/Logo.jsx`, `public/icon.svg`).

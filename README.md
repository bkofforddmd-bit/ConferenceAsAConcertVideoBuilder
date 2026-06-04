# Conference Music Video Studio

Turn a General Conference talk into original song lyrics, then into a
visually consistent music-video storyboard with generated scene images.

Two sections:

1. **Lyric Creator** — paste/upload a talk, pick a musical style reference,
   generate original lyrics (Claude), edit freely, request AI revisions, then
   finalize.
2. **Movie Scene Organizer** — finalized lyrics become a shared *style bible*
   plus an ordered scene list (Claude). Each scene has an editable image prompt,
   one-click image generation (gpt-image-2), regenerate/revise, and a
   "Save to master folder" gallery with per-scene and bulk download.

## How consistency works

The Scene Organizer first generates a **style bible** (art style, palette,
lighting, recurring characters, motifs). Every scene's image prompt restates it.
With **Lock consistency** on, generating a scene feeds the most recent *saved*
earlier scene back to `gpt-image-2` as a reference image, so characters and
style carry forward across frames.

## Tech

- **Frontend**: React + Vite (static, deployed to Netlify CDN)
- **Backend**: Netlify Functions (serverless) — your API keys stay here,
  never in the browser
- **Models**: `claude-opus-4-8` (lyrics + scenes), `gpt-image-2` (images)

## Setup

```bash
npm install
cp .env.example .env   # fill in your keys for local dev
```

`.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Local development

Use the Netlify CLI so the functions run alongside the frontend:

```bash
npm install -g netlify-cli
netlify dev
```

Open the URL it prints (usually http://localhost:8888).

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import from Git** → pick the repo.
3. Build settings are auto-detected from `netlify.toml`
   (build `npm run build`, publish `dist`, functions `netlify/functions`).
4. **Site settings → Environment variables** → add `ANTHROPIC_API_KEY` and
   `OPENAI_API_KEY`.
5. Deploy.

## Notes / next steps

- **Storage**: the master folder currently lives in browser memory for the
  session. To persist projects across sessions, add Netlify Blobs or a database
  and a "Project" model (talk → lyrics → scenes → saved images).
- **Copyright**: General Conference talks are © Intellectual Reserve, Inc.
  Lyrics are generated as *original* paraphrase, not verbatim copies, and the
  style reference is treated as genre direction only (no reproduction of any
  artist's actual songs). Review the Church's terms of use before any public
  distribution, and consider contacting their Intellectual Property Office.
- **Rate limits / cost**: `gpt-image-2` edit calls (reference-locked) bill image
  input at high-fidelity rates — slightly pricier than generation-only. Budget
  accordingly for long videos with many scenes.

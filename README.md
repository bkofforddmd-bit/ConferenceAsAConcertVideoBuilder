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
`consent-version:`, `shift:`, `correction:`, `rate:`, `payroll:`, `settings:retention`, `purge:`, `share:`, `sharefb:`, `followup:`). No database or migration is involved. Participant names,
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

### Hours & payroll (Phase 2 timekeeping)

Workers tap **⏱ Clock in / my hours** on the campus home screen. Clock-in and
clock-out use the server's clock, one shift can be open at a time, nothing
clocks out automatically (a worker who forgot can enter the real end time,
and the record says so), and several shifts a day are fine. The worker sees
hours today / this week / this month / all time, each month's shifts, and can
request a correction (original and proposed times are both kept, with who
decided and when) or email a month's summary. Pay periods are calendar months
(America/Denver). Approved shifts can't be changed by the worker.

Administrators: **Hours & payroll** tab → decide correction requests, set
hourly rates with effective dates (only visible there), approve a worker's
month or single shifts, see gross pay (approved minutes × the rate in force on
each shift's date, whole cents), mark a month paid, download the CSV, or print
the page. Documents: `shift:`, `correction:`, `rate:`, `payroll:`.

### Analytics & retention (Phase 3)

Admin panel → **Analytics** (the panel's first tab): date presets or a custom
range (campus-local dates) and a worker filter; totals (approached, declined,
participated, recorded / without recording, lyrics, songs, average time);
the Approached → Participated → Lyrics → Song funnel; worker comparisons with
hours from timekeeping and per-hour rates; results by date; student
reactions; most-chosen talks; talks students chose that still have no song
(re-checked against the live Concert library); and five CSV exports. Only
completed sessions count as experiences — unfinished ones count as an approach
only. Nothing in analytics or its exports identifies a participant.

Admin panel → **Retention**: the policy for video clips (keep N days, 0 = keep
until deleted by hand; delete once consent is withdrawn; optional daily
automatic run, OFF by default), a preview of exactly which clips are due, a
two-tap delete, and a deletion log (counts only). Only the R2 video files are
deleted; consent, session and lyric records are always kept, and each clip
entry stays on its session marked deleted with the date and reason. New
recordings are refused once a session's consent is withdrawn. The daily run is
`netlify/functions/campus-retention-daily.js` (Netlify scheduled function).
Documents: `settings:retention`, `purge:`.

### Song pages, feedback, recording references & follow-ups (Phase 4)

- **QR song page.** Completing a session where the student took part creates
  a public page at `/song/<code>` (random 10-letter code, nothing about the
  student in it) and the thank-you screen shows its QR code. The page plays,
  in order: a song link the worker pasted (e.g. MelodyCraft's share link), an
  MP3 the worker uploaded (private R2, short-lived signed link), the library
  song the student heard, or a Concert-library song published since for the
  same talk; otherwise it says the song is on its way. It also shows the lyrics
  and takes a star rating + comment. It switches off if consent is withdrawn
  or an administrator turns it off (Consent lookup). Workers can reopen any
  finished session's QR / song tools with 📱 on their recent sessions.
- **Student feedback.** On the thank-you screen: stars, "did the song help the
  message sink in", "listen to more", "share with a friend", and an
  anonymous comment. Shown in Analytics with comments and CSVs.
- **Recording references.** Every session has a short reference code
  (e.g. `K7Q-4MX`). A 🎬 Slate button (recorded sessions only) shows it full
  screen with the date/time, talk and authorization status, to film at the
  start of each recording. Workers log camera/phone file names against the
  session; they're copied onto the consent record, and Consent lookup accepts
  the reference code.
- **Follow-ups (opt-in only).** The student may type their own email and tick
  the exact opt-in wording (stored with the record) to be told when the song
  (and video) is ready — at most two emails. The address lives only in
  `followup:<sessionId>` (admin-only). Admin → **Follow-ups**: ✉ opens a
  ready-made email in your own email app with the song-page link, then "Mark
  sent". "Student said stop" erases the address at once; the retention
  policy erases the rest N days after the last email (default 60).

Documents: `share:<code>` (index + visit count), `sharefb:<sessionId>` (page
ratings), `followup:<sessionId>`. Functions: `campus-share` (public),
`campus-sessions` (share / feedback / followup / recording-add /
recording-remove / song-link), `campus-media` (sign-song / confirm-song),
`campus-admin` (followups / followup-update / followup-delete / share-toggle).

### Q&A intro (question cards → students' answers, before the song)

On the campus phone, every recording is saved with the question the worker
asked (picked from the administrator's question bank in Admin → Settings, or
typed). There's a new recording moment while the lyrics are being written:
"why is this your favorite talk?".

In the Studio's Video step, **Q&A intro** builds the opening: add answers from
the campus session (or upload video files), each is transcribed by AI
automatically (the same auto-caption job as the closing clip; fix words or
tap-time by hand), edit the question wording, trim, and reorder. In the
rendered video each answer opens with a Conference As A Concert card (winged
mark + name, gold rule, "Question 1 of 3") on which the question writes
itself out; the card then crossfades — picture and sound — into the student
answering, with captions; the answers play back to back, then the opening
clip (if any), the intro card and the song. Settings: card length (3–8 s)
and crossfade (0.5–2 s). Answer videos are copied into the browser's project
storage (`<projectId>:qa:<id>`) so they render offline and never expire.

Code: `src/components/QaIntro.jsx`, `src/campus/questions.js` (shared question
bank), `drawQuestionCard` / Q&A phase in `src/lib/video-render.js`,
campus-media `sign-upload { question }` and `set-question`.

### Video clips (in-app recording → private Cloudflare R2)

When a student authorizes recording, the session screens show a small 🎥
camera window (lyrics reaction, song reaction, closing testimony). Clips upload
straight from the phone to a PRIVATE R2 bucket through short-lived signed
links; they're never public. Administrators see and download a session's clips
from Consent lookup; in the Studio, a project opened from a session can splice
its clips into the opening of the music video (Video step → Opening clip →
"From the campus session").

One-time setup:

1. Cloudflare → R2 → Create bucket (e.g. `cac-campus-clips`). Leave public
   access OFF.
2. R2 → Manage R2 API Tokens → Create token: permission **Object Read & Write**,
   limited to that bucket. Copy the Access Key ID and Secret Access Key.
3. Bucket → Settings → CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://conferenceasaconcertvideobuilder.netlify.app"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Netlify → Environment variables: `R2_ACCOUNT_ID` (R2 → Overview, right
   side), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_CAMPUS_BUCKET`.
   Redeploy. Until these are set the recorder stays hidden.
5. Admin panel → Release text: the built-in release is now version 2 and
   describes in-app recording. If you saved your own version earlier, update
   its "Recording" paragraph the same way and have it reviewed.

Limits: 3 minutes and 400 MB per clip, 12 clips per session. Clips are kept
until an administrator deletes the session's clips (worker delete during the
session, or the session purge — retention policy to come with Phase 3).

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

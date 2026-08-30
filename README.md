# FrameFlow

FrameFlow turns a video into sampled frames, uses Grok vision to create production-ready prompts and shot metadata, and can build storyboards, remix narratives, and generate or enhance images with Grok Imagine.

## What the xAI integration covers

- Grok multimodal frame analysis with structured JSON output
- Story, remix, and refinement generation
- PDF or text script attachments through xAI Files (temporary uploads are deleted after use)
- Grok Imagine image generation and reference-image editing
- Grok Imagine 2K enhancement
- Server-side API key handling, retry/backoff, configuration preflight, and actionable errors

## Run locally

Prerequisites: Node.js 20 or newer and an [xAI API key](https://console.x.ai/).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and add your key:

   ```bash
   cp .env.example .env.local
   ```

   ```dotenv
   XAI_API_KEY=your_xai_api_key
   XAI_TEXT_MODEL=grok-4.6
   XAI_IMAGE_MODEL=grok-imagine-image-quality
   ```

3. Start FrameFlow:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The key is read only by the Express server and is never included in the browser bundle. The text/vision model can also be changed in Analysis Settings. It must support image understanding.

## Verify and deploy

```bash
npm run lint
npm run build
npm start
```

Production serves the built app and API from port `3000`. Set `XAI_API_KEY` in the deployment environment; `.env.local` is ignored by Git.

### Railway

The included `railway.json` and `Dockerfile` configure the production build, current `yt-dlp` YouTube resolver, start command, health check, and restart policy. Create a Railway service from this repository and set `XAI_API_KEY`, `XAI_TEXT_MODEL`, and `XAI_IMAGE_MODEL` as service variables. Railway supplies the runtime `PORT` automatically.

## Notes

- Grok Imagine currently supports native 1K and 2K output. The app therefore exposes 2K for AI enhancement.
- Remote video URLs still depend on the source allowing retrieval. YouTube URLs are resolved with yt-dlp (`android_vr` first) to a progressive MP4; HLS/DASH is rejected with an honest error. The YouTube_Sample chip (`watch?v=aqz-KE-bpKQ`) falls back to a public Big Buck Bunny MP4 (test-videos.co.uk) if YouTube blocks the server.
- Frame images stay in browser local storage; AI requests send the selected frame to xAI for analysis or generation.

## Production packet and verify pass

After frame analysis, FrameFlow runs a local verify pass (no extra API keys) and can export a production packet:

- Continuity passport — locked subject, wardrobe, lighting, and palette language to paste into every shot prompt
- Quality report — missing prompts, analysis errors, coverage gaps, duplicate prompts, lighting drift
- Shot inventory / EDL — timestamped shot list as `frameflow-packet.json` plus `frameflow-edl.md`

Use **Verify** to reopen the report, **Lock Passport** to stamp it into Config (`{{PASSPORT}}` + directives), and **Export Packet** to download JSON + markdown. Re-run analysis after locking so every prompt carries the same identity block.

## Footage notes sidecar

After analysis, **Export Footage Notes** downloads a UTF-8 `.cdaf.txt` file next to the usual packet/storyboard exports. The sidecar is FrameFlow's own CDAF-inspired format (not a vendor of another project): a small header (video basename, SHA-256 of the file bytes when available, duration, generator, created) plus a markdown body (Summary + timestamped Segments with shot notes and metadata).

**Import Footage Notes** (upload or paste) after a video is selected. If the sidecar matches the current clip — exact SHA-256, or a name + duration heuristic — FrameFlow fills prompts from the cached segments and skips Grok vision on those timestamps so the same footage does not burn tokens again. Uncovered shots still use the existing `XAI_API_KEY` analysis path. Keep the `.cdaf.txt` beside the video and re-import it on the next session.

## Rhythm cue map

After a video is loaded, **Rhythm Map** opens a local timing panel (same neon/mono language as Footage Notes). FrameFlow decodes the video's audio track in the browser with the Web Audio API — no Python stack, no extra API keys.

- **Analyze Rhythm** builds a compact `frameflow-rhythm-map-1.0` object: duration, best-effort BPM, beats, multiband onsets (LOW/MID/HIGH), energy samples, and eight-bar-style cue windows labeled `impact` / `scale` / `flow` / `flash` / `bloom` (motion-oriented, not drum transcription).
- **Export** downloads a `.ffrhythm.json` sidecar. **Import** (upload or paste) applies cues without re-analyzing.
- **Prefer beat accents when sampling** (Config or the rhythm panel) snaps Deconstruct's frame times toward high-impact onsets when a map is present. The existing sampling interval remains the fallback.

Inspired by BeatScope's cue-map idea (MIT); original FrameFlow implementation. Not a clone of BeatScope's analyzer or visualizer.

## Clip health / motion health

After frames are sampled, **Clip Health** (next to Rhythm Map / Verify / Export Packet / Footage Notes) grades physical footage health from consecutive stills — no extra API key, no vision model.

- **Analyze Health** downscales extracted frames to a small grayscale canvas, measures mean-absolute luma difference between neighbors, then classifies `OK` / `STATIC` (near-zero motion) / `JITTER` (high variance / thrash) / `MORPH` (a sudden spike after a stable run). If no frames exist yet, it samples first using the current interval.
- **Export** downloads a versioned `.ffhealth.json` sidecar (video name, sampled timestamps, motion series, verdict, summary). **Import** (upload or paste) reloads it.
- Findings fold into the existing Verify pass and production packet as extra `QualityIssue` rows (`STATIC`, `JITTER`, `MORPH`) when a health report exists. They do not replace shot-prompt continuity checks.
- `POST /api/clip-health` accepts `{ samples: [{ timestamp, motion }, ...] }` or `{ diffs: number[] }` and returns `{ ok, verdict, mean, variance, issues, summary }`. Pure JSON — no ffmpeg. `GET /api/health` is unchanged.

Motion-health idea inspired by AIVideoAdherenceGate (MIT); original FrameFlow implementation. Not a clone of that project's Python CLI or source.

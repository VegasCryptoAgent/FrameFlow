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
   XAI_TEXT_MODEL=grok-4.5
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

The included `railway.json` configures the production build, start command, health check, and restart policy. Create a Railway service from this repository and set `XAI_API_KEY`, `XAI_TEXT_MODEL`, and `XAI_IMAGE_MODEL` as service variables. Railway supplies the runtime `PORT` automatically.

## Notes

- Grok Imagine currently supports native 1K and 2K output. The app therefore exposes 2K for AI enhancement.
- Remote video URLs still depend on the source allowing retrieval. YouTube and Vimeo URLs are resolved by the server proxy.
- Frame images stay in browser local storage; AI requests send the selected frame to xAI for analysis or generation.

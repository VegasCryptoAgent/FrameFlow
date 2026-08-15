import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer, loadEnv } from "vite";
import axios from "axios";
import PDFDocument from "pdfkit";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const XAI_API_BASE_URL = 'https://api.x.ai/v1';
const execFileAsync = promisify(execFile);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const RESOLVE_TTL_MS = 8 * 60 * 1000;
const resolveCache = new Map<string, { url: string; expiresAt: number }>();
const resolveInflight = new Map<string, Promise<string>>();

const hostnameOf = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isYouTubeUrl = (value: string): boolean => {
  const hostname = hostnameOf(value);
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
};

const isVimeoUrl = (value: string): boolean => {
  const hostname = hostnameOf(value);
  return hostname === 'vimeo.com' || hostname.endsWith('.vimeo.com') || hostname === 'player.vimeo.com';
};

const isDirectMediaUrl = (value: string): boolean => /\.(mp4|m4v|webm|mov|mkv|ogv)(\?|#|$)/i.test(value);

const needsPlatformResolver = (value: string): boolean => isYouTubeUrl(value) || isVimeoUrl(value) || !isDirectMediaUrl(value);

const originRequestHeaders = (targetUrl: string, range?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
  };
  const hostname = hostnameOf(targetUrl);
  if (hostname.includes('googlevideo.com') || isYouTubeUrl(targetUrl)) {
    headers.Referer = 'https://www.youtube.com/';
    headers.Origin = 'https://www.youtube.com';
  } else if (hostname.includes('vimeo') || hostname.includes('vimeocdn')) {
    headers.Referer = 'https://vimeo.com/';
    headers.Origin = 'https://vimeo.com';
  } else {
    try {
      headers.Referer = `${new URL(targetUrl).origin}/`;
    } catch {
      // ignore
    }
  }
  if (range) headers.Range = range;
  return headers;
};

const resolveWithYtDlp = async (videoUrl: string): Promise<string> => {
  const format = 'best[ext=mp4][vcodec^=avc1][acodec!=none]/best[ext=mp4][acodec!=none]/best[ext=mp4]/best';
  const { stdout } = await execFileAsync('yt-dlp', [
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--format', format,
    '--get-url',
    videoUrl,
  ], {
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const resolved = stdout.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith('http'));
  if (!resolved) throw new Error('Could not resolve a browser-compatible video stream.');
  return resolved;
};

const resolvePlayableUrl = async (videoUrl: string, forceRefresh = false): Promise<string> => {
  if (!needsPlatformResolver(videoUrl)) return videoUrl;
  const cached = resolveCache.get(videoUrl);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.url;
  if (!forceRefresh) {
    const pending = resolveInflight.get(videoUrl);
    if (pending) return pending;
  }
  const task = resolveWithYtDlp(videoUrl)
    .then(url => {
      resolveCache.set(videoUrl, { url, expiresAt: Date.now() + RESOLVE_TTL_MS });
      return url;
    })
    .finally(() => {
      resolveInflight.delete(videoUrl);
    });
  resolveInflight.set(videoUrl, task);
  return task;
};

const extractUpstreamMessage = (error: any): string => {
  const upstream = error?.response?.data?.error;
  if (typeof upstream === 'string') return upstream;
  if (upstream && typeof upstream.message === 'string') return upstream.message;
  if (typeof error?.message === 'string') return error.message;
  return '';
};

const publicXaiError = (error: any): { status: number; message: string } => {
  const upstreamStatus = error?.response?.status;
  const raw = extractUpstreamMessage(error);
  console.error('xAI Proxy Error:', upstreamStatus || 'unknown', raw);
  const text = raw.toLowerCase();
  if (error?.message?.includes('XAI_API_KEY') || upstreamStatus === 401) {
    return { status: 503, message: 'AI analysis is not available right now.' };
  }
  if (
    upstreamStatus === 429
    || /credit|quota|rate limit|resource.?exhausted|too many requests|insufficient|billing|spend limit/.test(text)
  ) {
    return { status: 429, message: 'AI analysis is temporarily unavailable because the provider limit was reached. Try again later.' };
  }
  return { status: upstreamStatus === 400 ? 400 : 502, message: 'AI analysis failed. Please try again.' };
};

const cleanPdfText = (value: unknown): string => String(value || '')
  .replace(/```[\s\S]*?```/g, block => block.replace(/```\w*/g, ''))
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*|__|\*|_/g, '')
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/^[•*-]\s+/gm, '- ')
  .trim();

const imageBufferFromDataUrl = (value: unknown): Buffer | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[1], 'base64');
  return buffer.length <= 20 * 1024 * 1024 ? buffer : null;
};

interface InlineFile {
  filename: string;
  mimeType: string;
  data: string;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Vite-style env loading keeps .env.local working for the custom Express server.
  const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  const getXaiApiKey = () => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_KEY is not set in the server environment. Add it to .env.local and restart FrameFlow.');
    }
    return apiKey;
  };

  const xaiHeaders = () => ({
    Authorization: `Bearer ${getXaiApiKey()}`,
    'Content-Type': 'application/json',
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      provider: "xAI",
      configured: Boolean(process.env.XAI_API_KEY),
      textModel: process.env.XAI_TEXT_MODEL || 'grok-4.5',
      imageModel: process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-quality',
    });
  });

  // Helper for retries with jitter and more attempts for rate limits
  const withRetry = async <T>(fn: () => Promise<T>, retries = 5, initialDelay = 2000): Promise<T> => {
    let currentDelay = initialDelay;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = error.response?.status || error.status;
        const isRateLimit = error.message?.includes('429') || status === 429;
        const isRetryable = isRateLimit || status === 408 || status === 500 || status === 502 || status === 503 || status === 504;
        
        if (i < retries - 1 && isRetryable) {
          // Add jitter to avoid thundering herd
          const jitter = Math.random() * 1000;
          const waitTime = currentDelay + jitter;
          
          console.log(`[RETRY ${i + 1}/${retries}] xAI error ${status || 'Unknown'}, retrying in ${Math.round(waitTime)}ms...`);
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          currentDelay *= 2; // Exponential backoff
          continue;
        }
        throw error;
      }
    }
    throw new Error("Maximum retries exceeded");
  };

  const uploadTemporaryFile = async (file: InlineFile): Promise<string> => {
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.length > 48 * 1024 * 1024) throw new Error('Script attachment exceeds xAI\'s 48 MB file limit.');
    const formData = new FormData();
    // xAI requires expires_after to precede the file field.
    formData.append('expires_after', '3600');
    formData.append('purpose', 'assistants');
    formData.append('file', new Blob([new Uint8Array(bytes)], { type: file.mimeType || 'application/octet-stream' }), file.filename || 'script');
    const response = await withRetry(() => axios.post(`${XAI_API_BASE_URL}/files`, formData, {
      headers: { Authorization: `Bearer ${getXaiApiKey()}` },
      timeout: 120000,
    }), 3, 1000);
    if (!response.data?.id) throw new Error('xAI did not return an ID for the uploaded script.');
    return response.data.id;
  };

  const deleteTemporaryFile = async (fileId: string) => {
    try {
      await axios.delete(`${XAI_API_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${getXaiApiKey()}` },
        timeout: 30000,
      });
    } catch (error: any) {
      console.warn(`Could not immediately delete temporary xAI file ${fileId}: ${error.message}`);
    }
  };

  const prepareInputFiles = async (input: any): Promise<{ input: any; uploadedIds: string[] }> => {
    const cloned = structuredClone(input);
    const uploadedIds: string[] = [];
    if (!Array.isArray(cloned)) return { input: cloned, uploadedIds };

    for (const message of cloned) {
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) {
        if (part?.type !== 'input_file') continue;
        const inlineFile = part.inline_file as InlineFile | undefined;
        if (!inlineFile) continue;
        if (typeof inlineFile.data !== 'string' || typeof inlineFile.filename !== 'string') {
          throw new Error('Invalid inline file attachment.');
        }
        const fileId = await uploadTemporaryFile(inlineFile);
        uploadedIds.push(fileId);
        part.file_id = fileId;
        delete part.inline_file;
      }
    }
    return { input: cloned, uploadedIds };
  };

  const extractResponseText = (response: any): string => {
    for (const item of [...(response?.output || [])].reverse()) {
      for (const content of [...(item?.content || [])].reverse()) {
        if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
      }
    }
    throw new Error('xAI returned no text output.');
  };

  // Server-side xAI gateway. The API key never enters the browser bundle.
  app.post("/api/xai", async (req, res) => {
    const { action, payload = {} } = req.body || {};
    const uploadedIds: string[] = [];
    try {
      getXaiApiKey();

      if (action === 'generateText') {
        const prepared = await prepareInputFiles(payload.input);
        uploadedIds.push(...prepared.uploadedIds);
        const body: any = {
          model: payload.model || process.env.XAI_TEXT_MODEL || 'grok-4.5',
          input: prepared.input,
          store: false,
        };
        if (payload.instructions) body.instructions = payload.instructions;
        if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
        if (payload.responseSchema) {
          body.text = {
            format: {
              type: 'json_schema',
              name: payload.responseSchema.name,
              schema: payload.responseSchema.schema,
              strict: true,
            },
          };
        }
        const result = await withRetry(() => axios.post(`${XAI_API_BASE_URL}/responses`, body, {
          headers: xaiHeaders(),
          timeout: 360000,
        }));
        return res.json({ text: extractResponseText(result.data) });
      }

      if (action === 'generateImage') {
        if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) throw new Error('Image prompt is required.');
        const hasReference = typeof payload.referenceImage === 'string' && payload.referenceImage.length > 0;
        const endpoint = hasReference ? 'images/edits' : 'images/generations';
        const body: any = {
          model: process.env.XAI_IMAGE_MODEL || 'grok-imagine-image-quality',
          prompt: payload.prompt,
          response_format: 'b64_json',
          resolution: payload.resolution === '2k' ? '2k' : '1k',
          aspect_ratio: payload.aspectRatio || '16:9',
        };
        if (hasReference) {
          const imageUrl = payload.referenceImage.startsWith('data:')
            ? payload.referenceImage
            : `data:image/jpeg;base64,${payload.referenceImage}`;
          body.image = { url: imageUrl, type: 'image_url' };
        }
        const result = await withRetry(() => axios.post(`${XAI_API_BASE_URL}/${endpoint}`, body, {
          headers: xaiHeaders(),
          timeout: 360000,
        }), 4, 2000);
        const image = result.data?.data?.[0];
        if (image?.b64_json) return res.json({ image: `data:${image.mime_type || 'image/jpeg'};base64,${image.b64_json}` });
        if (image?.url) {
          const downloaded = await axios.get(image.url, { responseType: 'arraybuffer', timeout: 120000 });
          const mimeType = downloaded.headers['content-type'] || image.mime_type || 'image/jpeg';
          return res.json({ image: `data:${mimeType};base64,${Buffer.from(downloaded.data).toString('base64')}` });
        }
        throw new Error('xAI returned no generated image.');
      }

      res.status(400).json({ error: "Invalid action" });
    } catch (error: any) {
      const safe = publicXaiError(error);
      res.status(safe.status).json({ error: safe.message });
    } finally {
      await Promise.all(uploadedIds.map(deleteTemporaryFile));
    }
  });

  app.post('/api/storyboard-pdf', (req, res) => {
    const { narrative, mode = 'original', frames = [] } = req.body || {};
    const modeLabel = ['original', 'remix', 'comparison'].includes(mode) ? mode : 'original';
    if (typeof narrative !== 'string' || !Array.isArray(frames)) {
      return res.status(400).json({ error: 'A narrative and frame list are required.' });
    }
    if (frames.length > 120) {
      return res.status(400).json({ error: 'Storyboard export is limited to 120 frames.' });
    }

    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, right: 44, bottom: 52, left: 44 },
        bufferPages: true,
        info: {
          Title: 'FrameFlow Storyboard',
          Author: 'FrameFlow',
          Subject: `${modeLabel} storyboard export`,
        },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="frameflow-${modeLabel}-storyboard.pdf"`);
      doc.pipe(res);

      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
      const neon = '#19f55a';
      const ink = '#111111';
      const muted = '#5f6368';

      doc.rect(0, 0, pageWidth, 116).fill(ink);
      doc.fillColor(neon).font('Helvetica-Bold').fontSize(28).text('FRAMEFLOW', 44, 42, { characterSpacing: 1.5 });
      doc.fillColor('#ffffff').font('Helvetica').fontSize(10).text(`${modeLabel.toUpperCase()} STORYBOARD`, 44, 82, { characterSpacing: 2 });
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text('Narrative', 44, 148);
      doc.moveTo(44, 176).lineTo(44 + contentWidth, 176).strokeColor(neon).lineWidth(2).stroke();
      doc.moveDown(1.2);
      doc.fillColor(muted).font('Helvetica').fontSize(10.5).text(cleanPdfText(narrative), 44, 194, {
        width: contentWidth,
        lineGap: 3,
      });

      frames.forEach((frame: any, index: number) => {
        doc.addPage();
        const timestamp = Number(frame?.timestamp) || 0;
        const mins = Math.floor(timestamp / 60);
        const secs = Math.floor(timestamp % 60).toString().padStart(2, '0');

        doc.fillColor(ink).font('Helvetica-Bold').fontSize(24).text(`SHOT ${(index + 1).toString().padStart(2, '0')}`, 44, 42);
        doc.fillColor(neon).font('Helvetica-Bold').fontSize(11).text(`${mins}:${secs}`, pageWidth - 100, 48, { width: 56, align: 'right' });
        doc.moveTo(44, 76).lineTo(44 + contentWidth, 76).strokeColor(neon).lineWidth(2).stroke();

        const image = imageBufferFromDataUrl(frame?.image);
        if (image) {
          doc.rect(44, 98, contentWidth, 292).fillAndStroke('#f1f3f4', '#d4d7da');
          try {
            doc.image(image, 50, 104, { fit: [contentWidth - 12, 280], align: 'center', valign: 'center' });
          } catch {
            doc.fillColor(muted).font('Helvetica').fontSize(10).text('Frame image could not be rendered.', 44, 230, { width: contentWidth, align: 'center' });
          }
        } else {
          doc.rect(44, 98, contentWidth, 180).fillAndStroke('#f1f3f4', '#d4d7da');
          doc.fillColor(muted).font('Helvetica').fontSize(10).text('No frame image available.', 44, 180, { width: contentWidth, align: 'center' });
        }

        const promptTop = image ? 416 : 304;
        doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text('GENERATION PROMPT', 44, promptTop, { characterSpacing: 1 });
        doc.fillColor(muted).font('Helvetica').fontSize(10).text(cleanPdfText(frame?.prompt || 'No prompt available.'), 44, promptTop + 26, {
          width: contentWidth,
          lineGap: 3,
        });

        const metadata = [frame?.shotType, frame?.cameraAngle, frame?.lighting].filter(Boolean).map(cleanPdfText);
        if (metadata.length) {
          doc.fillColor(neon).font('Helvetica-Bold').fontSize(8.5).text(metadata.join('  /  ').toUpperCase(), 44, 746, {
            width: contentWidth,
            align: 'left',
          });
        }
      });

      const range = doc.bufferedPageRange();
      for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex++) {
        doc.switchToPage(pageIndex);
        const originalBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 10;
        doc.fillColor('#8a8d91').font('Helvetica').fontSize(8).text(
          `FRAMEFLOW  /  ${pageIndex + 1} OF ${range.count}`,
          44,
          doc.page.height - 32,
          { width: contentWidth, align: 'right', lineBreak: false },
        );
        doc.page.margins.bottom = originalBottomMargin;
      }
      doc.end();
    } catch (error: any) {
      console.error('Storyboard PDF error:', error.message);
      if (!res.headersSent) res.status(500).json({ error: 'Could not generate storyboard PDF.' });
      else res.end();
    }
  });

  const applyProxyHeaders = (res: express.Response, upstream: Response) => {
    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    return contentType;
  };

  const fetchUpstream = async (targetUrl: string, range?: string, method: 'GET' | 'HEAD' = 'GET') => {
    return fetch(targetUrl, {
      method,
      headers: originRequestHeaders(targetUrl, range),
      redirect: 'follow',
    });
  };

  const handleVideoProxy = async (req: express.Request, res: express.Response) => {
    const rawUrl = req.query.url;
    const videoUrl = Array.isArray(rawUrl) ? String(rawUrl[0] || '') : String(rawUrl || '');
    if (!videoUrl) {
      return res.status(400).send('URL parameter is required');
    }

    const clientRange = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const isPlatform = needsPlatformResolver(videoUrl);
    // YouTube/Vimeo CDNs reject un-ranged full GETs. Always send a Range so
    // the browser can learn the size and keep using 206 range requests.
    const rangeToSend = clientRange || (isPlatform ? 'bytes=0-' : undefined);

    try {
      // Many CDNs, including googlevideo, reject HEAD. Probe with a tiny range GET instead.
      const upstreamRange = req.method === 'HEAD' ? (clientRange || 'bytes=0-0') : rangeToSend;
      let targetUrl = await resolvePlayableUrl(videoUrl);
      let upstream = await fetchUpstream(targetUrl, upstreamRange, 'GET');

      if ((upstream.status === 401 || upstream.status === 403 || upstream.status === 404) && isPlatform) {
        resolveCache.delete(videoUrl);
        targetUrl = await resolvePlayableUrl(videoUrl, true);
        upstream.body?.cancel().catch(() => undefined);
        upstream = await fetchUpstream(targetUrl, upstreamRange, 'GET');
      }

      if (upstream.status === 416 && upstreamRange) {
        upstream.body?.cancel().catch(() => undefined);
        upstream = await fetchUpstream(targetUrl, undefined, 'GET');
      }

      if (!upstream.ok && upstream.status !== 206) {
        const preview = await upstream.text().catch(() => '');
        console.error('Proxy upstream error:', upstream.status, preview.slice(0, 200));
        return res.status(502).send('Failed to resolve or stream this video.');
      }

      const contentType = applyProxyHeaders(res, upstream);
      if (contentType.toLowerCase().includes('text/html')) {
        upstream.body?.cancel().catch(() => undefined);
        return res.status(415).send('The URL provided resolved to a webpage, not a video file.');
      }

      res.status(upstream.status);
      if (req.method === 'HEAD' || !upstream.body) {
        return res.end();
      }

      const nodeStream = Readable.fromWeb(upstream.body as any);
      const abort = () => {
        nodeStream.destroy();
        upstream.body?.cancel().catch(() => undefined);
      };
      req.on('close', abort);
      nodeStream.on('error', abort);
      nodeStream.pipe(res);
    } catch (error: any) {
      const detail = typeof error?.stderr === 'string' ? error.stderr.trim() : error?.message;
      console.error('Proxy error:', detail);
      if (!res.headersSent) res.status(502).send('Failed to resolve or stream this video.');
      else res.end();
    }
  };

  app.get('/api/video-proxy', handleVideoProxy);
  app.head('/api/video-proxy', handleVideoProxy);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

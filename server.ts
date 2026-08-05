import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer, loadEnv } from "vite";
import ytdl from "@distube/ytdl-core";
import axios from "axios";

const XAI_API_BASE_URL = 'https://api.x.ai/v1';

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
      const upstream = error.response?.data?.error;
      const message = typeof upstream === 'string' ? upstream : upstream?.message || error.message;
      console.error("xAI Proxy Error:", message);
      const status = error.message?.includes('XAI_API_KEY') ? 503 : (error.response?.status === 429 ? 429 : 502);
      res.status(status).json({ error: message || 'xAI request failed.' });
    } finally {
      await Promise.all(uploadedIds.map(deleteTemporaryFile));
    }
  });

  // Proxy route for videos to bypass CORS and resolve YouTube/Vimeo
  app.get("/api/video-proxy", async (req, res) => {
    const videoUrl = req.query.url as string;
    const range = req.headers.range;

    if (!videoUrl) {
      return res.status(400).send("URL parameter is required");
    }

    try {
      let targetUrl = videoUrl;

      // Handle YouTube
      if (ytdl.validateURL(videoUrl)) {
        const info = await ytdl.getInfo(videoUrl);
        const format = ytdl.chooseFormat(info.formats, { 
          quality: 'highestvideo',
          filter: format => format.container === 'mp4' && !!format.url
        });

        if (!format || !format.url) {
          return res.status(404).send("Could not find a suitable MP4 format for this YouTube video.");
        }
        targetUrl = format.url;
      }

      // Handle Vimeo
      else if (videoUrl.includes('vimeo.com')) {
          const vimeoId = videoUrl.split('/').pop();
          if (vimeoId) {
              const configRes = await axios.get(`https://player.vimeo.com/video/${vimeoId}/config`);
              const streams = configRes.data?.request?.files?.progressive;
              if (streams && streams.length > 0) {
                  const bestStream = streams.sort((a: any, b: any) => b.width - a.width)[0];
                  targetUrl = bestStream.url;
              }
          }
      }

      // Proxy the request with range support
      const proxyHeaders: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      };

      if (range) {
        proxyHeaders['Range'] = range;
      }

      const response = await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          headers: proxyHeaders,
          timeout: 20000
      });

      const contentType = String(response.headers['content-type'] || 'video/mp4');
      if (contentType.toLowerCase().includes('text/html')) {
          return res.status(415).send("The URL provided resolved to a webpage, not a video file.");
      }

      // Forward status and headers
      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        if (['content-type', 'content-length', 'content-range', 'accept-ranges'].includes(key.toLowerCase())) {
          res.setHeader(key, value as string);
        }
      });

      res.setHeader('Access-Control-Allow-Origin', '*');
      response.data.pipe(res);

    } catch (error: any) {
      console.error("Proxy error:", error.message);
      res.status(500).send(`Failed to proxy video: ${error.message}`);
    }
  });

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

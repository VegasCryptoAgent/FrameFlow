import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import ytdl from "@distube/ytdl-core";
import axios from "axios";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Initialize Gemini
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in the server environment');
    }
    return new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Helper for retries with jitter and more attempts for rate limits
  const withRetry = async <T>(fn: () => Promise<T>, retries = 5, initialDelay = 2000): Promise<T> => {
    let currentDelay = initialDelay;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        const isRateLimit = error.message?.includes('429') || error.status === 429;
        const isRetryable = isRateLimit || error.status === 503 || error.status === 504;
        
        if (i < retries - 1 && isRetryable) {
          // Add jitter to avoid thundering herd
          const jitter = Math.random() * 1000;
          const waitTime = currentDelay + jitter;
          
          console.log(`[RETRY ${i + 1}/${retries}] Error ${error.status || 'Unknown'}, retrying in ${Math.round(waitTime)}ms...`);
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          currentDelay *= 2; // Exponential backoff
          continue;
        }
        throw error;
      }
    }
    throw new Error("Maximum retries exceeded");
  };

  // Gemini Proxy Endpoint
  app.post("/api/gemini", async (req, res) => {
    const { action, payload, options = {} } = req.body;
    
    try {
      const ai = getGeminiClient();
      const modelName = options.model || (action === 'generateImage' ? 'gemini-3-pro-image-preview' : 'gemini-3-flash-preview');

      if (action === 'generateContent') {
        const result = await withRetry(() => ai.models.generateContent({
          model: modelName,
          contents: payload.contents,
          config: {
            systemInstruction: payload.systemInstruction,
            ...(payload.generationConfig || {})
          }
        }));
        return res.json({ text: result.text });
      }

      if (action === 'generateImage') {
        const parts = payload.contents?.[0]?.parts || [];
        const textPart = parts.find((p: any) => p.text);
        if (!textPart) throw new Error("No prompt found for image generation");

        const prompt = textPart.text;
        const seed = Math.floor(Math.random() * 1000000);
        const width = 1024;
        const height = 576; // 16:9

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

        // Fetch image and convert to base64 to maintain same interface
        // Added retry for image fetch as well
        const imageResponse = await withRetry(async () => {
           return await axios.get(imageUrl, { 
             responseType: 'arraybuffer',
             timeout: 60000 // High timeout for image generation
           });
        }, 2, 2000);
        
        const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';

        return res.json({ 
          image: `data:${contentType};base64,${base64Image}` 
        });
      }

      res.status(400).json({ error: "Invalid action" });
    } catch (error: any) {
      console.error("Gemini Proxy Error:", error.response?.data?.error || error.message);
      res.status(500).json({ error: error.response?.data?.error?.message || error.message });
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

import axios from "axios";

interface GenerateOptions {
  customInstructions?: string;
  template?: string;
  model?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

interface ScriptFile {
  mimeType: string;
  data: string;
  filename: string;
}

interface XaiContentPart {
  type: 'input_text' | 'input_image' | 'input_file';
  text?: string;
  image_url?: string;
  file_id?: string;
  inline_file?: ScriptFile;
}

const DEFAULT_TEXT_MODEL = 'grok-4.5';

const toUserFacingError = (error: any): Error => {
  const raw = String(error?.response?.data?.error || error?.message || '');
  const lower = raw.toLowerCase();
  if (
    raw === 'AI analysis is temporarily unavailable because the provider limit was reached. Try again later.'
    || raw === 'AI analysis failed. Please try again.'
    || raw === 'AI analysis is not available right now.'
  ) {
    return new Error(raw);
  }
  if (/credit|quota|rate limit|resource.?exhausted|too many requests|insufficient|billing|spend limit|429/.test(lower)) {
    return new Error('AI analysis is temporarily unavailable because the provider limit was reached. Try again later.');
  }
  if (/not configured|xai_api_key is not/.test(lower)) {
    return new Error('AI analysis is not available right now.');
  }
  return new Error('AI analysis failed. Please try again.');
};

const callXaiProxy = async <T>(action: 'generateText' | 'generateImage', payload: unknown): Promise<T> => {
  try {
    const response = await axios.post<T>("/api/xai", { action, payload });
    return response.data;
  } catch (error: any) {
    const safe = toUserFacingError(error);
    console.error(`xAI Proxy Error (${action}):`, safe.message);
    throw safe;
  }
};

export const checkXaiConfiguration = async (): Promise<void> => {
  const response = await axios.get<{ configured: boolean; provider: string }>("/api/health");
  if (!response.data.configured) {
    throw new Error('XAI_API_KEY is not configured. Add it to .env.local and restart FrameFlow.');
  }
};

const scriptPart = (scriptFile?: ScriptFile): XaiContentPart[] => scriptFile
  ? [{
      type: 'input_file',
      // The server uploads this payload, replaces it with an xAI file_id, then deletes it.
      file_id: 'pending-upload',
      inline_file: scriptFile,
    }]
  : [];

const frameAnalysisSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    metadata: {
      type: 'object',
      properties: {
        shotType: { type: 'string' },
        cameraAngle: { type: 'string' },
        lighting: { type: 'string' },
        palette: { type: 'array', items: { type: 'string' } },
      },
      required: ['shotType', 'cameraAngle', 'lighting', 'palette'],
      additionalProperties: false,
    },
  },
  required: ['prompt', 'metadata'],
  additionalProperties: false,
};

export const generateFramePrompt = async (
  base64Image: string,
  options: GenerateOptions = {}
): Promise<{ prompt: string; metadata: any }> => {
  const {
    customInstructions = "",
    template = "{{PROMPT}}",
    model = DEFAULT_TEXT_MODEL,
  } = options;

  const imageUrl = base64Image.startsWith('data:')
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;
  const isCustomTemplate = template.trim() !== "{{PROMPT}}";

  let instructions = `You are an expert video production assistant and technical director.
Analyze the supplied video frame and return a detailed text-to-video prompt plus technical metadata.
Cover the subject, action, environment, cinematography, lighting, lens/angle, and artistic style.`;

  if (isCustomTemplate) {
    instructions += `\nFormat the prompt exactly with the user's template. Replace all {{PLACEHOLDER}} values from the frame while preserving other template text.`;
  } else {
    instructions += `\nThe prompt must be one copy-ready paragraph.`;
  }
  if (customInstructions) instructions += `\nAdditional constraints: ${customInstructions}`;

  const userText = isCustomTemplate
    ? `Analyze this frame and populate this output template:\n\nTEMPLATE_START\n${template}\nTEMPLATE_END`
    : 'Analyze this frame and provide the production prompt and technical breakdown.';

  const result = await callXaiProxy<{ text: string }>('generateText', {
    model,
    instructions,
    input: [{
      role: 'user',
      content: [
        { type: 'input_image', image_url: imageUrl, detail: 'high' },
        { type: 'input_text', text: userText },
      ],
    }],
    temperature: 0.4,
    responseSchema: { name: 'frame_analysis', schema: frameAnalysisSchema },
  });

  const parsed = JSON.parse(result.text || '{}');
  return {
    prompt: parsed.prompt || 'Could not generate prompt.',
    metadata: parsed.metadata || {},
  };
};

export const generateImage = async (
  prompt: string,
  referenceImageBase64?: string,
  options: { imageSize?: "1K" | "2K" } = {}
): Promise<string> => {
  const result = await callXaiProxy<{ image: string }>('generateImage', {
    prompt,
    referenceImage: referenceImageBase64,
    resolution: (options.imageSize || '1K').toLowerCase(),
    aspectRatio: '16:9',
  });
  return result.image;
};

export const upscaleImage = async (
  prompt: string,
  imageBase64: string,
  size: "2K" = "2K"
): Promise<string> => {
  const upscalePrompt = `Enhance this image at ${size} resolution. Improve clarity, textures, lighting, and fine detail while strictly preserving its composition, subjects, and artistic style. Original prompt context: ${prompt}`;
  return generateImage(upscalePrompt, imageBase64, { imageSize: size });
};

export const refineRemix = async (
  currentRemixScript: string,
  userFeedback: string,
  frames: { id: string; originalPrompt: string; currentRemixPrompt?: string }[],
  options: GenerateOptions = {}
): Promise<{ refinedScript: string; refinedFrames: Record<string, string> }> => {
  const { model = DEFAULT_TEXT_MODEL, history = [] } = options;
  const historyText = history.length
    ? `\nCHAT HISTORY:\n${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`
    : '';
  const prompt = `You are an expert film director and script doctor.
${historyText}
CURRENT REMIXED SCRIPT:\n${currentRemixScript}

CURRENT SHOT LIST:\n${frames.map(f => `ID [${f.id}]: ${f.currentRemixPrompt || f.originalPrompt}`).join('\n')}

NEWEST USER REQUEST: ${userFeedback}

Update the narrative and every shot prompt to match the feedback. Preserve every frame ID exactly.`;

  const result = await callXaiProxy<{ text: string }>('generateText', {
    model,
    input: prompt,
    temperature: 0.7,
    responseSchema: {
      name: 'remix_refinement',
      schema: {
        type: 'object',
        properties: {
          refinedScript: { type: 'string' },
          refinedFrames: { type: 'object', additionalProperties: { type: 'string' } },
        },
        required: ['refinedScript', 'refinedFrames'],
        additionalProperties: false,
      },
    },
  });
  const parsed = JSON.parse(result.text || '{}');
  if (!parsed.refinedScript || !parsed.refinedFrames) throw new Error('Invalid refinement response structure.');
  return parsed;
};

export const generateStoryScript = async (prompts: string[], model = DEFAULT_TEXT_MODEL): Promise<string> => {
  const message = `Here are sequential descriptions of frames from a video:\n\n${prompts.map((p, i) => `Frame ${i + 1}: ${p}`).join('\n\n')}

Write a professional video narrative and scene breakdown. Do not use markdown headers. Use bold-cap section labels, technical production language, and bullets for shot lists.
Structure: **LOGLINE:**, **TREATMENT:**, **SCENE BREAKDOWN:**.`;
  const result = await callXaiProxy<{ text: string }>('generateText', { model, input: message, temperature: 0.6 });
  return result.text || 'Could not generate story script.';
};

export const generateRemixStoryScript = async (
  originalPrompts: string[],
  remixIdea: string,
  scriptFile?: ScriptFile,
  model = DEFAULT_TEXT_MODEL
): Promise<string> => {
  const text = `Original Frame Descriptions:\n${originalPrompts.map((p, i) => `Frame ${i + 1}: ${p}`).join('\n')}

New Movie Idea/Context: "${remixIdea || (scriptFile ? 'Use the attached script' : '')}"

Create a brand-new professional adaptation. Maintain the original visual rhythm but change the characters, world, and story. Do not use markdown headers. Use bold-cap section labels.
Structure: **REMIXED LOGLINE:**, **NEW VISION & TREATMENT:**, **NEW SCENE BREAKDOWN:**.`;
  const content: XaiContentPart[] = [{ type: 'input_text', text }, ...scriptPart(scriptFile)];
  const result = await callXaiProxy<{ text: string }>('generateText', {
    model,
    input: [{ role: 'user', content }],
    temperature: 0.8,
  });
  return result.text || 'Could not generate remixed story script.';
};

export const generateRemixPrompt = async (
  originalPrompt: string,
  remixIdea: string,
  scriptFile?: ScriptFile,
  options: GenerateOptions & { storyContext?: string } = {}
): Promise<string> => {
  const {
    customInstructions = '',
    template = '{{PROMPT}}',
    model = DEFAULT_TEXT_MODEL,
    storyContext = '',
  } = options;
  const isCustomTemplate = template.trim() !== '{{PROMPT}}';
  let text = `Original Frame Description: "${originalPrompt}"

New Movie Idea/Context: "${remixIdea || (scriptFile ? 'Use the attached script' : '')}"
${storyContext ? `\nOverall remixed narrative:\n${storyContext}` : ''}

Rewrite this frame for the new narrative. Strictly preserve shot type, camera movement, composition, and lighting mood. Change the subjects, environment, and style to fit the new story.`;
  if (customInstructions) text += `\nAdditional constraints: ${customInstructions}`;
  text += isCustomTemplate
    ? `\nReturn only this populated template, preserving non-placeholder text:\nTEMPLATE_START\n${template}\nTEMPLATE_END`
    : '\nReturn only one copy-ready video-generation prompt paragraph.';

  const content: XaiContentPart[] = [{ type: 'input_text', text }, ...scriptPart(scriptFile)];
  const result = await callXaiProxy<{ text: string }>('generateText', {
    model,
    input: [{ role: 'user', content }],
    temperature: 0.8,
  });
  return result.text || 'Could not generate remix prompt.';
};

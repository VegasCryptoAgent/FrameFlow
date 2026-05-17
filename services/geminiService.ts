import axios from "axios";

interface GenerateOptions {
  customInstructions?: string;
  template?: string;
  model?: string;
  history?: {role: 'user' | 'assistant', content: string}[];
}

const callGeminiProxy = async (action: string, payload: any, options: any = {}) => {
  try {
    const response = await axios.post("/api/gemini", {
      action,
      payload,
      options
    });
    return response.data;
  } catch (error: any) {
    console.error(`Gemini Proxy Error (${action}):`, error.response?.data?.error || error.message);
    throw new Error(error.response?.data?.error || `Failed to communicate with AI server: ${error.message}`);
  }
};

export const generateFramePrompt = async (
  base64Image: string,
  options: GenerateOptions = {}
): Promise<{ prompt: string; metadata: any }> => {
  const { 
    customInstructions = "", 
    template = "{{PROMPT}}", 
    model = 'gemini-3-flash-preview' 
  } = options;
  
  const cleanBase64 = base64Image.split(',')[1] || base64Image;
  const isCustomTemplate = template && typeof template === 'string' && template.trim() !== "{{PROMPT}}";

  let systemInstruction = `You are an expert video production assistant and technical director. 
  Your task is to analyze video frames and provide structured technical data and descriptive prompts.
  
  You MUST output valid JSON only.
  
  JSON Structure:
  {
    "prompt": "Highly descriptive text-to-video prompt for AI generation",
    "metadata": {
      "shotType": "e.g., Extreme Close-up, Wide Shot, Over-the-shoulder",
      "cameraAngle": "e.g., Low Angle, Bird's eye, Eye level",
      "lighting": "e.g., Volumetric, High-contrast, Soft diffuse",
      "palette": ["Color 1", "Color 2", "Color 3"]
    }
  }

  Focus for prompt:
  1. Subject description (appearance, clothing, pose).
  2. Action and movement (implied or visible).
  3. Environment and background details.
  4. Cinematography (lighting, camera angle, lens type).
  5. Artistic style (photorealistic, anime, etc.).`;

  if (!isCustomTemplate) {
    systemInstruction += `\nThe "prompt" field should be a single paragraph suitable for copy-pasting into a generative video AI.`;
  } else {
    systemInstruction += `\nYou must format the "prompt" field exactly according to the user-provided text template, replacing any placeholders (e.g., {{VARIABLE}}) with content derived from the image analysis.`;
  }
  
  if (customInstructions) {
    systemInstruction += `\nAdditional user instructions for prompt generation: ${customInstructions}`;
  }

  let userMessage = "Analyze this image and provide the JSON technical breakdown and prompt.";
  
  if (isCustomTemplate) {
    userMessage = `Analyze this image and fill in the "prompt" field of the JSON using the following template:

TEMPLATE_START
${template}
TEMPLATE_END

Instructions for template:
1. Replace {{PROMPT}} or similar generic placeholders with a full detailed description.
2. If specific placeholders like {{SUBJECT}}, {{STYLE}}, or {{CAMERA}} are used, extract those specific details.
3. Keep all other text in the template exactly as is.`;
  }

  const payload = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
        { text: userMessage }
      ]
    }],
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4
    }
  };

  const result = await callGeminiProxy('generateContent', payload, { model });
  const parsed = JSON.parse(result.text || "{}");
  
  return {
    prompt: parsed.prompt || "Could not generate prompt.",
    metadata: parsed.metadata || {}
  };
};

export const generateImage = async (
  prompt: string, 
  referenceImageBase64?: string, 
  options: { imageSize?: "1K" | "2K" | "4K" } = {}
): Promise<string> => {
  const { imageSize = "1K" } = options;
  const parts: any[] = [];

  if (referenceImageBase64) {
    const cleanBase64 = referenceImageBase64.split(',')[1] || referenceImageBase64;
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: cleanBase64 }
    });
  }

  parts.push({ text: prompt });

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: imageSize
      }
    }
  };

  const result = await callGeminiProxy('generateImage', payload, { model: 'gemini-3-pro-image-preview' });
  return result.image;
};

export const upscaleImage = async (
  prompt: string, 
  imageBase64: string, 
  size: "2K" | "4K" = "2K"
): Promise<string> => {
  const upscalePrompt = `Upscale and enhance this image to ${size} resolution. Improve clarity and fine details while strictly maintaining the original composition and artistic style. Enhance textures, lighting, and sharpness. Original prompt context: ${prompt}`;
  return generateImage(upscalePrompt, imageBase64, { imageSize: size });
};

export const refineRemix = async (
  currentRemixScript: string,
  userFeedback: string,
  frames: { id: string; originalPrompt: string; currentRemixPrompt?: string }[],
  options: GenerateOptions = {}
): Promise<{ refinedScript: string; refinedFrames: Record<string, string> }> => {
  const { model = 'gemini-3-flash-preview', history = [] } = options;

  const historyText = history.length > 0 
    ? `\nCHAT HISTORY:\n${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}\n`
    : '';

  const prompt = `
    You are an expert film director and script doctor. 
    ${historyText}
    CURRENT REMIXED SCRIPT:
    """
    ${currentRemixScript}
    """

    CURRENT SHOT LIST (Prompts):
    ${frames.map(f => `ID [${f.id}]: ${f.currentRemixPrompt || f.originalPrompt}`).join('\n')}

    USER REQUEST FOR CHANGES (NEWEST):
    "${userFeedback}"

    TASK:
    1. Update the narrative script based on the feedback.
    2. Update each shot prompt to align with the new script changes and the user's feedback.
    3. Return the result in a strict JSON format.

    EXPECTED JSON STRUCTURE:
    {
      "refinedScript": "Full updated script text...",
      "refinedFrames": {
        "frame_id_1": "Updated prompt 1...",
        "frame_id_2": "Updated prompt 2..."
      }
    }
  `;

  const payload = {
    contents: [{ text: prompt }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7
    }
  };

  const result = await callGeminiProxy('generateContent', payload, { model });
  const parsed = JSON.parse(result.text || "{}");
  
  if (!parsed.refinedScript || !parsed.refinedFrames) {
    throw new Error("Invalid refinement response structure");
  }

  return parsed;
};

export const generateStoryScript = async (prompts: string[]): Promise<string> => {
  const message = `Here are sequential descriptions of frames from a video:

${prompts.map((p, i) => `Frame ${i+1}: ${p}`).join('\n\n')}

Task: Write a professional video narrative and scene breakdown.
STRICT INSTRUCTIONS: 
- DO NOT use markdown headers (e.g., #, ##, ###, ####).
- Use BOLD CAPS for section labels (e.g., **LOGLINE:**, **DIRECTOR'S TREATMENT:**).
- Keep the language technical and precise, suitable for a film production environment.
- Use bullet points for shot lists.

Structure your response with:
1. **LOGLINE:** A one-sentence summary.
2. **TREATMENT:** Describe visual style, lighting, and palette.
3. **SCENE BREAKDOWN:** A chronological list of shots with their descriptions.`;

  const payload = {
    contents: [{ text: message }]
  };

  const result = await callGeminiProxy('generateContent', payload, { model: 'gemini-3-flash-preview' });
  return result.text || "Could not generate story script.";
};

export const generateRemixStoryScript = async (
  originalPrompts: string[],
  remixIdea: string,
  scriptFile?: { mimeType: string, data: string }
): Promise<string> => {
  const contents: any[] = [];
  
  if (scriptFile) {
    contents.push({
      inlineData: {
        mimeType: scriptFile.mimeType,
        data: scriptFile.data
      }
    });
  }

  contents.push({
    text: `Original Frame Descriptions:
${originalPrompts.map((p, i) => `Frame ${i+1}: ${p}`).join('\n')}

New Movie Idea/Context: "${remixIdea || (scriptFile ? 'See attached script' : '')}"

Task: Create a BRAND NEW professional video adaptation.
STRICT INSTRUCTIONS:
- DO NOT use markdown headers (e.g., #, ##, ###, ####).
- Use BOLD CAPS for section labels (e.g., **REMIXED LOGLINE:**, **NEW VISION:**).
- Maintain the visual rhythm of the original frames but change characters/world/story.

Structure:
1. **REMIXED LOGLINE:**
2. **NEW VISION & TREATMENT:**
3. **NEW SCENE BREAKDOWN:**`
  });

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.8,
    }
  };

  const result = await callGeminiProxy('generateContent', payload, { model: 'gemini-3-flash-preview' });
  return result.text || "Could not generate remixed story script.";
};

export const generateRemixPrompt = async (
  originalPrompt: string,
  remixIdea: string,
  scriptFile?: { mimeType: string; data: string },
  options: GenerateOptions & { storyContext?: string } = {}
): Promise<string> => {
  const { 
    customInstructions = "", 
    template = "{{PROMPT}}", 
    model = 'gemini-3-flash-preview',
    storyContext = ""
  } = options;

  const isCustomTemplate = template && typeof template === 'string' && template.trim() !== "{{PROMPT}}";
  const contents: any[] = [];
  
  if (scriptFile) {
    contents.push({
      inlineData: {
        mimeType: scriptFile.mimeType,
        data: scriptFile.data
      }
    });
  }

  let userInstruction = `Original Frame Description: "${originalPrompt}"
    
    New Movie Idea/Context: "${remixIdea || (scriptFile ? 'See attached script' : '')}"
    
    ${storyContext ? `Narrative Continuity Context (The overall remixed story script):
    ---
    ${storyContext}
    ---
    ` : ''}

    Task: Rewrite the original frame description to fit the new movie idea/script/narrative. 
    STRICTLY MAINTAIN:
    - Shot type (e.g., close-up, wide shot, low angle)
    - Camera movement (e.g., panning, zooming, static)
    - Composition (where things are in the frame)
    - Lighting mood (e.g., dramatic, soft, neon)
    
    CHANGE:
    - Subject (characters, objects) - align them with the narrative context if provided.
    - Environment (setting, background) - align with the narrative context.
    - Artistic style (if implied by the new idea)
    
    If a script or narrative context is provided, ensure this specific shot matches the corresponding beat in that story.`;

  if (customInstructions) {
    userInstruction += `\nAdditional user constraints: ${customInstructions}`;
  }

  if (!isCustomTemplate) {
    userInstruction += `\n\nThe output should be a single paragraph suitable for a video generation AI prompt.`;
  } else {
    userInstruction += `\n\nYou must format your output exactly according to the following template, replacing placeholders with the remixed content:
    
TEMPLATE_START
${template}
TEMPLATE_END

Instructions for template:
1. Replace {{PROMPT}} with the full remixed description.
2. Replace {{SUBJECT}}, {{ACTION}}, {{STYLE}}, {{ENVIRONMENT}}, {{LIGHTING}}, {{CAMERA}} with the specific remixed details.
3. Keep all other text in the template exactly as is.`;
  }

  contents.push({ text: userInstruction });

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.8,
    }
  };

  const result = await callGeminiProxy('generateContent', payload, { model });
  return result.text || "Could not generate remix prompt.";
};

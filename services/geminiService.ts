import { GoogleGenAI, Type } from "@google/genai";
import { AiMetadata } from "../types";

// Initialize Gemini Client
// Note: We use process.env.API_KEY as per instructions.
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API Key not found in environment. Features requiring AI will fail.");
  }
  return new GoogleGenAI({ apiKey: apiKey || '' });
};

export const generateMixMetadata = async (trackNames: string[]): Promise<AiMetadata> => {
  const ai = getClient();
  const trackListString = trackNames.join(", ");

  // 1. Generate Title, Description and Video Prompt
  const textPrompt = `
    I have a music playlist with the following tracks: ${trackListString}.
    Please generate:
    1. A catchy, creative title for this mixtape.
    2. A short, engaging description (max 20 words) in Italian.
    3. A short English search query (max 5-7 words) to find suitable free abstract background videos or loops that match the mood of these tracks (e.g. "neon city drive loop", "calm ocean sunset drone").
  `;

  const textResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: textPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          coverArtPrompt: { type: Type.STRING, description: "A creative prompt to generate an abstract album cover art for this mix." },
          videoSearchPrompt: { type: Type.STRING, description: "A short English search query for background videos." }
        },
        required: ["title", "description", "coverArtPrompt", "videoSearchPrompt"]
      }
    }
  });

  const textData = JSON.parse(textResponse.text || "{}");
  
  let coverImageBase64 = undefined;

  // 2. Generate Cover Image (Optional but requested)
  if (textData.coverArtPrompt) {
    try {
      const imageResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // Good for general image gen
        contents: textData.coverArtPrompt,
        config: {
           // Standard image generation config if needed, default is usually fine for this model
        }
      });
      
      // Parse image response
      // Gemini 2.5 flash image returns inlineData usually? Or standard parts?
      // Based on docs: we iterate parts.
      if (imageResponse.candidates && imageResponse.candidates[0].content.parts) {
         for (const part of imageResponse.candidates[0].content.parts) {
            if (part.inlineData) {
               coverImageBase64 = part.inlineData.data;
               break; 
            }
         }
      }
    } catch (e) {
      console.error("Failed to generate cover art:", e);
    }
  }

  return {
    title: textData.title || "Il Mio Mix",
    description: textData.description || "Una raccolta di brani unici.",
    coverImageBase64: coverImageBase64,
    videoSearchPrompt: textData.videoSearchPrompt
  };
};
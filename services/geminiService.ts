import { GoogleGenAI, Type } from "@google/genai";
import { AiMetadata } from "../types";

// Initialize Gemini Client
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API Key not found in environment. Features requiring AI will fail.");
  }
  return new GoogleGenAI({ apiKey: apiKey || '' });
};

// Shared config for text generation
const TEXT_MODEL = 'gemini-3-flash-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "A high-CTR, emotional or intriguing YouTube video title." },
    description: { type: Type.STRING, description: "A detailed, SEO-friendly YouTube video description in Italian." },
    coverArtPrompt: { type: Type.STRING, description: "A creative prompt to generate a 16:9 YouTube thumbnail." },
    videoSearchPrompt: { type: Type.STRING, description: "A short English search query for background videos." }
  },
  required: ["title", "description", "coverArtPrompt", "videoSearchPrompt"]
};

export const generateMixMetadata = async (trackNames: string[]): Promise<AiMetadata> => {
  // Use the text regeneration function to get the base data
  const textData = await regenerateMixText(trackNames);
  
  let coverImageBase64 = undefined;

  // Generate Image immediately
  if (textData.coverArtPrompt) {
    coverImageBase64 = await regenerateMixImage(textData.coverArtPrompt);
  }

  return {
    ...textData,
    coverImageBase64
  };
};

export const regenerateMixText = async (trackNames: string[]): Promise<AiMetadata> => {
  const ai = getClient();
  const trackListString = trackNames.join(", ");

  const textPrompt = `
    I have a music playlist with the following tracks: ${trackListString}.
    Please generate metadata optimized for a YouTube Video.
    
    1. **Title**: Catchy, "click-worthy", emotional, or descriptive title (e.g., "Chill Vibes for Studying", "The Ultimate Workout Mix 2024"). Max 100 chars.
    2. **Description**: A detailed, engaging description in Italian designed to attract listeners. Include keywords suitable for the genre. (Max 50 words).
    3. **Video Search**: A short English search query (max 5-7 words) to find suitable free abstract background videos (e.g. "neon city drive loop").
    4. **Thumbnail Prompt**: A detailed prompt to generate a high-quality 16:9 YouTube thumbnail. Specify style (e.g., lo-fi art, cyberpunk, nature photography, abstract 3d).
  `;

  const textResponse = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: textPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const textData = JSON.parse(textResponse.text || "{}");

  return {
    title: textData.title || "Il Mio Mix",
    description: textData.description || "Una raccolta di brani unici.",
    videoSearchPrompt: textData.videoSearchPrompt,
    coverArtPrompt: textData.coverArtPrompt
  };
};

export const regenerateMixImage = async (prompt: string): Promise<string | undefined> => {
  const ai = getClient();
  try {
    const imageResponse = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
         imageConfig: {
           aspectRatio: '16:9'
         }
      }
    });
    
    if (imageResponse.candidates && imageResponse.candidates[0].content.parts) {
       for (const part of imageResponse.candidates[0].content.parts) {
          if (part.inlineData) {
             return part.inlineData.data;
          }
       }
    }
  } catch (e) {
    console.error("Failed to generate cover art:", e);
  }
  return undefined;
};

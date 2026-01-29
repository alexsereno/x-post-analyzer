/**
 * Uses Gemini Flash to describe images before sending to Grok (which isn't multimodal).
 */

import { GEMINI_API_URL } from "../config.js";

export interface ImageDescriptionResult {
  description: string;
  inputTokens: number;
  outputTokens: number;
}

export async function describeImage(
  mediaData: string,
  apiKey: string,
  model: string
): Promise<ImageDescriptionResult> {
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

  // Parse the base64 data URI
  const match = mediaData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid media data format");
  }
  const [, mimeType, base64Data] = match;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Describe this image concisely for a tweet engagement prediction model. Focus on:
- What's in the image (subject, objects, people, text)
- The mood/tone (funny, serious, shocking, wholesome, etc.)
- Visual quality (professional, casual, meme-style, screenshot, etc.)
- Any text visible in the image

Keep it to 2-3 sentences max.`,
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 150,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini Flash error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const text = data.candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini Flash returned no content");
  }

  return {
    description: text.trim(),
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

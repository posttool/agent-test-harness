import { GoogleGenAI } from "@google/genai";
import type { WebBackend, WebSearchResult } from "../../tools/WebBackend.ts";

/** The Web tool backed by Gemini's Google Search grounding. */
export class GeminiWebBackend implements WebBackend {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEMINI_API_KEY;
    this.ai = new GoogleGenAI({ ...(apiKey ? { apiKey } : {}) });
    this.model = options.model ?? "gemini-3.8-flash";
  }

  async search(query: string): Promise<{ summary: string; results: WebSearchResult[] }> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `Search the web for: ${query}\nReply with a short factual summary (at most 5 sentences).`,
      config: { tools: [{ googleSearch: {} }] },
    });
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const results = chunks.flatMap((c) => (c.web?.uri ? [{ title: c.web.title ?? c.web.uri, url: c.web.uri }] : []));
    return { summary: (response.text ?? "").trim(), results: results.slice(0, 8) };
  }

  async fetch(url: string): Promise<{ text: string }> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `Read ${url} and return its main content as plain text (up to about 800 words).`,
      config: { tools: [{ urlContext: {} }] },
    });
    return { text: (response.text ?? "").trim() };
  }
}

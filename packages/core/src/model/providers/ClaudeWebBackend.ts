import Anthropic from "@anthropic-ai/sdk";
import type { WebBackend, WebSearchResult } from "../../tools/WebBackend.ts";

/** The Web tool backed by Claude's server-side web_search / web_fetch tools. */
export class ClaudeWebBackend implements WebBackend {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string; baseURL?: string } = {}) {
    this.client = new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), ...(options.baseURL ? { baseURL: options.baseURL } : {}) });
    this.model = options.model ?? "claude-opus-5-5";
  }

  private async ask(tool: Anthropic.Messages.ToolUnion, prompt: string): Promise<Anthropic.Messages.Message> {
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
    for (let turn = 0; turn < 3; turn++) {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: 4_000,
        output_config: { effort: "low" },
        tools: [tool],
        messages,
      });
      if (message.stop_reason !== "pause_turn") return message;
      // The server-side tool loop paused; send the turn back so it resumes.
      messages.push({ role: "assistant", content: message.content });
    }
    throw new Error("Web tool did not finish");
  }

  async search(query: string): Promise<{ summary: string; results: WebSearchResult[] }> {
    const message = await this.ask(
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      `Search the web for: ${query}\nReply with a short factual summary (at most 5 sentences).`,
    );
    const results: WebSearchResult[] = [];
    let summary = "";
    for (const block of message.content) {
      if (block.type === "text") summary += block.text;
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") results.push({ title: r.title, url: r.url });
      }
    }
    return { summary: summary.trim(), results: results.slice(0, 8) };
  }

  async fetch(url: string): Promise<{ text: string }> {
    const message = await this.ask(
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 1 },
      `Fetch ${url} and return its main content as plain text (up to about 800 words).`,
    );
    return { text: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim() };
  }
}

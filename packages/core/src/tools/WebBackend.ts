export interface WebSearchResult {
  title: string;
  url: string;
}

/** The built-in Web tool's engine: Claude web search/fetch or Gemini Google Search grounding. */
export interface WebBackend {
  search(query: string): Promise<{ summary: string; results: WebSearchResult[] }>;
  fetch(url: string): Promise<{ text: string }>;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** JSON Schema the response must follow. */
  responseSchema: Record<string, unknown>;
  /** Aborted when the Review stops waiting for the reply. */
  signal?: AbortSignal;
}

/** A source of language models that can run Reviews. */
export interface ModelProvider {
  /** Returns the raw text of the Model's reply. */
  complete(request: ChatRequest): Promise<string>;
}

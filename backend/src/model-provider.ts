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
  /** Names the Model Provider in the Model listing and on the Reviews it runs; unique among configured providers. */
  name: string;
  /** The Models this Model Provider offers, from its list-models endpoint. */
  listModels(): Promise<string[]>;
  /** Returns the raw text of the Model's reply. */
  complete(request: ChatRequest): Promise<string>;
}

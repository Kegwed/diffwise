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

/** Why a Model Provider can't run a Review on a Model: it doesn't list the Model, or can't list its Models at all. */
export type ModelUnavailable =
  | {
      missing: "model";
      /** The Models it does list. */
      offeredModels: string[];
    }
  | { unusable: "model-provider"; reason: string };

/**
 * Asks the Model Provider for its Models before a Review starts, so a mistyped Model or a Model Provider that's down
 * doesn't show up as every file failing. Undefined if it offers the Model.
 */
export async function modelUnavailable(modelProvider: ModelProvider, model: string): Promise<ModelUnavailable | undefined> {
  let models: string[];
  try {
    models = await modelProvider.listModels();
  } catch (error) {
    return { unusable: "model-provider", reason: error instanceof Error ? error.message : String(error) };
  }
  // Ollama lists a Model pulled without a tag as "name:latest", and takes either name.
  if (models.includes(model) || models.includes(`${model}:latest`)) return undefined;
  return { missing: "model", offeredModels: models };
}

/** Why the named Model Provider can't run a Review on the Model, for the person who chose them. */
export function describeModelUnavailable(modelProvider: string, model: string, unavailable: ModelUnavailable): string {
  return "unusable" in unavailable
    ? `${modelProvider} can't be used: ${unavailable.reason}`
    : `${modelProvider} doesn't offer a Model named ${JSON.stringify(model)}. It offers: ${unavailable.offeredModels.join(", ") || "none"}.`;
}

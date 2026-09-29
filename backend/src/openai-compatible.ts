import type { ModelProvider } from "./model-provider.ts";

export interface OpenAICompatibleConfig {
  /** How the Model listing and Reviews name this provider. */
  name: string;
  /** e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  apiKey?: string;
}

/** The Ollama preset's default: its OpenAI-compatible endpoint, which takes no API key. */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** The OpenAI-compatible preset's default base URL. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Short, so a Model Provider that can't be reached doesn't hold up the Model listing. */
const LIST_MODELS_TIMEOUT_MS = 10_000;

/**
 * The Model Providers configured through the environment, in listing order:
 * - Ollama, at DIFFWISE_OLLAMA_URL (default OLLAMA_BASE_URL); set it to an empty string to turn Ollama off.
 * - OpenAI-compatible, when DIFFWISE_OPENAI_BASE_URL or DIFFWISE_OPENAI_API_KEY is set (base URL default OPENAI_BASE_URL).
 */
export function modelProvidersFromEnv(env: NodeJS.ProcessEnv): ModelProvider[] {
  const providers: ModelProvider[] = [];
  const ollamaUrl = env.DIFFWISE_OLLAMA_URL ?? OLLAMA_BASE_URL;
  if (ollamaUrl) providers.push(openAICompatibleProvider({ name: "Ollama", baseUrl: ollamaUrl }));
  const { DIFFWISE_OPENAI_BASE_URL: openAIUrl, DIFFWISE_OPENAI_API_KEY: apiKey } = env;
  if (openAIUrl || apiKey) {
    providers.push(openAICompatibleProvider({ name: "OpenAI-compatible", baseUrl: openAIUrl || OPENAI_BASE_URL, apiKey }));
  }
  return providers;
}

/** Talks to any OpenAI-compatible chat completions API (Ollama, OpenAI, and others). */
export function openAICompatibleProvider({ name, baseUrl, apiKey }: OpenAICompatibleConfig): ModelProvider {
  const root = baseUrl.replace(/\/+$/, "");
  const authorization = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
  return {
    name,
    async listModels() {
      let response: Response;
      try {
        response = await fetch(`${root}/models`, { headers: authorization, signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS) });
      } catch (error) {
        const cause = (error as Error & { cause?: Error }).cause;
        throw new Error(`Could not reach ${baseUrl}: ${cause?.message ?? (error as Error).message}`);
      }
      if (!response.ok) throw new Error(`${baseUrl} replied ${response.status} when listing Models`);
      const body = (await response.json()) as { data?: { id?: unknown }[] };
      return (body.data ?? []).flatMap((model) => (typeof model.id === "string" ? [model.id] : [])).sort();
    },
    async complete({ model, messages, responseSchema, signal }) {
      const response = await fetch(`${root}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...authorization,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          response_format: {
            type: "json_schema",
            json_schema: { name: "review", schema: responseSchema },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Model Provider at ${baseUrl} replied ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}

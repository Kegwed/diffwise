import type { ModelProvider } from "./model-provider.ts";
import { openAICompatibleProvider } from "./openai-compatible.ts";

/** The names the presets' Model Providers are listed and recorded on Reviews by. */
export const OLLAMA = "Ollama";
export const OPENAI_COMPATIBLE = "OpenAI-compatible";

/** The Ollama preset's default: its OpenAI-compatible endpoint, which takes no API key. */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** The OpenAI-compatible preset's default base URL. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * The Model Providers configured through the environment, in listing order:
 * - Ollama, at DIFFWISE_OLLAMA_URL (default OLLAMA_BASE_URL); set it to an empty string to turn Ollama off.
 * - OpenAI-compatible, when DIFFWISE_OPENAI_BASE_URL or DIFFWISE_OPENAI_API_KEY is set (base URL default OPENAI_BASE_URL).
 */
export function modelProvidersFromEnv(env: NodeJS.ProcessEnv): ModelProvider[] {
  const providers: ModelProvider[] = [];
  const ollamaUrl = env.DIFFWISE_OLLAMA_URL ?? OLLAMA_BASE_URL;
  if (ollamaUrl) providers.push(openAICompatibleProvider({ name: OLLAMA, baseUrl: ollamaUrl }));
  const { DIFFWISE_OPENAI_BASE_URL: openAIUrl, DIFFWISE_OPENAI_API_KEY: apiKey } = env;
  if (openAIUrl || apiKey) {
    providers.push(openAICompatibleProvider({ name: OPENAI_COMPATIBLE, baseUrl: openAIUrl || OPENAI_BASE_URL, apiKey }));
  }
  return providers;
}

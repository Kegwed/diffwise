import type { ModelProvider } from "./model-provider.ts";

export interface OpenAICompatibleConfig {
  /** e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  apiKey?: string;
}

/** The Ollama preset: its OpenAI-compatible endpoint, no API key. */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** Talks to any OpenAI-compatible chat completions API (Ollama, OpenAI, and others). */
export function openAICompatibleProvider({ baseUrl, apiKey }: OpenAICompatibleConfig): ModelProvider {
  return {
    async complete({ model, messages, responseSchema, signal }) {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...(apiKey && { authorization: `Bearer ${apiKey}` }),
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

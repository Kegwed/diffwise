import type { ModelProvider } from "./model-provider.ts";

export interface OpenAICompatibleConfig {
  /** How the Model listing and Reviews name this provider. */
  name: string;
  /** e.g. http://localhost:11434/v1 for Ollama. */
  baseUrl: string;
  apiKey?: string;
}

/** Short, so a Model Provider that can't be reached doesn't hold up the Model listing. */
const LIST_MODELS_TIMEOUT_MS = 10_000;

/** Talks to any OpenAI-compatible chat completions API (Ollama, OpenAI, and others). */
export function openAICompatibleProvider({ name, baseUrl, apiKey }: OpenAICompatibleConfig): ModelProvider {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  // Error messages reach the browser and the database, so they name the base URL without any credentials in it.
  const { shownBaseUrl, problem } = inspectBaseUrl(baseUrl);
  const authorizationHeaders = apiKey ? { authorization: `Bearer ${apiKey}` } : undefined;
  const endpoint = (path: string) => {
    if (problem) throw new Error(problem);
    return `${trimmedBaseUrl}${path}`;
  };
  return {
    name,
    async listModels() {
      const url = endpoint("/models");
      let response: Response;
      try {
        response = await fetch(url, {
          headers: authorizationHeaders,
          signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
        });
      } catch (error) {
        const cause = (error as Error & { cause?: Error }).cause;
        throw new Error(`Could not reach ${shownBaseUrl}: ${cause?.message ?? (error as Error).message}`);
      }
      if (!response.ok) throw new Error(`${shownBaseUrl} replied ${response.status} when listing Models`);
      const body = (await response.json()) as { data?: { id?: unknown }[] };
      return (body.data ?? []).flatMap((model) => (typeof model.id === "string" ? [model.id] : [])).sort();
    },
    async complete({ model, messages, responseSchema, signal }) {
      const response = await fetch(endpoint("/chat/completions"), {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...authorizationHeaders,
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
        throw new Error(`Model Provider at ${shownBaseUrl} replied ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}

/**
 * How to name the base URL in error messages, and why it can't be used, if it can't.
 * fetch's own errors for an unusable URL or one with credentials in it repeat the URL, so those are refused first.
 */
function inspectBaseUrl(baseUrl: string): { shownBaseUrl: string; problem?: string } {
  const url = URL.parse(baseUrl);
  if (url?.protocol !== "http:" && url?.protocol !== "https:") {
    return { shownBaseUrl: "the configured base URL", problem: "The configured base URL is not an http:// or https:// URL" };
  }
  if (url.username === "" && url.password === "") return { shownBaseUrl: baseUrl };
  url.username = "";
  url.password = "";
  const shownBaseUrl = url.toString();
  return {
    shownBaseUrl,
    problem: `The base URL ${shownBaseUrl} has a username or password in it, which isn't supported; use an API key instead`,
  };
}

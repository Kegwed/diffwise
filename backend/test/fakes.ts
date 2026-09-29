import type { ChatRequest, ModelProvider } from "../src/model-provider.ts";

/** Scripts a Model call that never answers, until the request's signal aborts it. */
export const hang = Symbol("hang");

export interface FakeModelProviderOptions {
  name?: string;
  /** The Models it lists, or an Error its listing fails with. */
  models?: string[] | Error;
}

/**
 * A Model Provider that answers each chat request with the next scripted response, and records the requests.
 * A scripted Error is thrown instead of answered; a scripted `hang` never answers.
 */
export function fakeModelProvider(
  responses: unknown[],
  { name = "Ollama", models = ["test-model"] }: FakeModelProviderOptions = {},
) {
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    name,
    async listModels() {
      if (models instanceof Error) throw models;
      return models;
    },
    async complete(request) {
      requests.push(request);
      if (requests.length > responses.length) throw new Error("fake Model Provider ran out of responses");
      const response = responses[requests.length - 1];
      if (response instanceof Error) throw response;
      if (response === hang) {
        return new Promise<string>((_, reject) =>
          request.signal?.addEventListener("abort", () => reject(request.signal!.reason)),
        );
      }
      return typeof response === "string" ? response : JSON.stringify(response);
    },
  };
  return { provider, requests };
}

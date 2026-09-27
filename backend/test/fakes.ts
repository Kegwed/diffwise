import type { ChatRequest, ModelProvider } from "../src/model-provider.ts";

/** A Model Provider that answers each chat request with the next scripted response, and records the requests. */
export function fakeModelProvider(responses: unknown[]) {
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    async complete(request) {
      requests.push(request);
      if (requests.length > responses.length) throw new Error("fake Model Provider ran out of responses");
      const response = responses[requests.length - 1];
      return typeof response === "string" ? response : JSON.stringify(response);
    },
  };
  return { provider, requests };
}

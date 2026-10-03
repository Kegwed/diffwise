import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { ModelProviderListing } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import { modelProvidersFromEnv } from "../src/model-provider-config.ts";
import { standInReviews } from "./fakes.ts";

let server: Server | undefined;

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** Serves an OpenAI-compatible list-models endpoint that answers with `status` and `body`, recording request headers. */
async function serveModels(status: number, body: unknown) {
  const requests: IncomingHttpHeaders[] = [];
  server = createServer((req, res) => {
    requests.push(req.headers);
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
}

async function listModels(env: NodeJS.ProcessEnv): Promise<ModelProviderListing[]> {
  const app = createApp({ forge: fixtureForge([]), modelProviders: modelProvidersFromEnv(env), reviews: standInReviews() });
  return (await app.request("/api/models")).json() as Promise<ModelProviderListing[]>;
}

describe("Model Providers configured through env", () => {
  test.each<[string, NodeJS.ProcessEnv, string[]]>([
    ["nothing set: the Ollama preset only", {}, ["Ollama"]],
    ["an empty Ollama URL: none", { DIFFWISE_OLLAMA_URL: "" }, []],
    ["an API key: Ollama and OpenAI-compatible", { DIFFWISE_OPENAI_API_KEY: "sk-test" }, ["Ollama", "OpenAI-compatible"]],
    [
      "only an OpenAI-compatible base URL",
      { DIFFWISE_OLLAMA_URL: "", DIFFWISE_OPENAI_BASE_URL: "http://127.0.0.1:1/v1" },
      ["OpenAI-compatible"],
    ],
  ])("with %s", (_, env, names) => {
    expect(modelProvidersFromEnv(env).map((provider) => provider.name)).toEqual(names);
  });

  test("the OpenAI-compatible provider lists its Models using the API key, which the listing never shows", async () => {
    const { url, requests } = await serveModels(200, { object: "list", data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] });

    const listed = await listModels({ DIFFWISE_OLLAMA_URL: "", DIFFWISE_OPENAI_BASE_URL: url, DIFFWISE_OPENAI_API_KEY: "sk-secret" });

    expect(requests.map((headers) => headers.authorization)).toEqual(["Bearer sk-secret"]);
    expect(listed).toEqual([{ modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o", "gpt-4o-mini"] }]);
  });

  test("a rejected API key makes the provider unavailable, without showing the key", async () => {
    const { url } = await serveModels(401, { error: { message: "Incorrect API key provided: sk-secret" } });

    const listed = await listModels({ DIFFWISE_OLLAMA_URL: "", DIFFWISE_OPENAI_BASE_URL: url, DIFFWISE_OPENAI_API_KEY: "sk-secret" });

    expect(listed).toEqual([{ modelProvider: "OpenAI-compatible", status: "unavailable", reason: expect.stringContaining("401") }]);
    expect(JSON.stringify(listed)).not.toContain("sk-secret");
  });

  test.each([
    ["credentials in it", (url: string) => url.replace("http://", "http://user:hunter2@")],
    ["no valid URL", () => "localhost:11434 token=hunter2"],
  ])("a base URL with %s makes the provider unavailable, without showing the URL's secrets", async (_, baseUrl) => {
    const { url, requests } = await serveModels(200, { data: [] });

    const listed = await listModels({ DIFFWISE_OLLAMA_URL: baseUrl(url) });

    expect(listed).toEqual([{ modelProvider: "Ollama", status: "unavailable", reason: expect.any(String) }]);
    expect(JSON.stringify(listed)).not.toContain("hunter2");
    expect(requests).toHaveLength(0);
  });
});

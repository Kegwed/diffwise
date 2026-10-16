import { describe, expect, test, vi } from "vitest";
import type { ApiError, ModelProviderListing, RecentReview, Review, ReviewEvent } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { fixtureForge } from "../src/fixture-forge.ts";
import { ForgeAccessError } from "../src/forge.ts";
import type { ModelProvider } from "../src/model-provider.ts";
import type { Reviews } from "../src/reviews.ts";
import { fakeModelProvider, standInReviews } from "./fakes.ts";

type App = ReturnType<typeof createApp>;

const pullRequestRef = { owner: "acme", repo: "shop", number: 7 };

const review: Review = {
  id: "r1",
  pullRequest: pullRequestRef,
  headCommit: "abc1234",
  modelProvider: "Ollama",
  model: "test-model",
  createdAt: "2026-10-01T00:00:00.000Z",
  status: "running",
  fileOutcomes: [],
  pendingFiles: [{ file: "src/users.ts", state: "reviewing" }],
  findings: [],
};

const notInstalled = new ForgeAccessError("The GitHub App isn't installed on acme/shop. Install it there, then try again.");

const unknownReview = "Review nope not found. A Review that was still running when Diffwise restarted is lost: start it again.";

function setup(reviews: Reviews, modelProviders: ModelProvider[] = []) {
  return createApp({ forge: fixtureForge([]), modelProviders, reviews });
}

function postReview(app: App, body: unknown) {
  return app.request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as ApiError).error;
}

/** Connects to a Review's progress stream, to read its events one at a time. */
async function readProgressStream(app: App, id: string) {
  const response = await app.request(`/api/reviews/${id}/events`);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";

  /** The next event, or undefined once the stream has ended. */
  async function next(): Promise<ReviewEvent | undefined> {
    while (!buffered.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffered += value;
    }
    const end = buffered.indexOf("\n\n");
    const message = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    return JSON.parse(message.replace(/^data: /, "")) as ReviewEvent;
  }

  /** Every event from here until the stream ends. */
  async function rest(): Promise<ReviewEvent[]> {
    const events: ReviewEvent[] = [];
    for (let event = await next(); event; event = await next()) events.push(event);
    return events;
  }

  return { response, next, rest, disconnect: () => reader.cancel() };
}

describe("Starting a Review", () => {
  test.each([
    ["a body that isn't JSON", "{not json"],
    ["no Pull Request", { modelProvider: "Ollama", model: "test-model" }],
    ["a Pull Request without a number", { pullRequest: { owner: "acme", repo: "shop" }, modelProvider: "Ollama", model: "test-model" }],
    ["no Model", { pullRequest: pullRequestRef, modelProvider: "Ollama" }],
    ["an empty Model", { pullRequest: pullRequestRef, modelProvider: "Ollama", model: "" }],
  ])("with %s is a 400, and no Review is started", async (_, body) => {
    const start = vi.fn<Reviews["start"]>();
    const app = setup(standInReviews({ start }));

    const response = await postReview(app, body);

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/^Expected /);
    expect(start).not.toHaveBeenCalled();
  });

  test("is a 201 with the Review that started", async () => {
    const start = vi.fn<Reviews["start"]>(async () => ({ started: true, review }));
    const app = setup(standInReviews({ start }));

    const response = await postReview(app, { pullRequest: pullRequestRef, modelProvider: "Ollama", model: "test-model" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(review);
    expect(start).toHaveBeenCalledWith(pullRequestRef, { modelProvider: "Ollama", model: "test-model" });
  });

  test("with a Model Provider that isn't configured is a 400", async () => {
    const app = setup(standInReviews({ start: async () => ({ started: false, missing: "model-provider" }) }));

    const response = await postReview(app, { pullRequest: pullRequestRef, modelProvider: "Nope", model: "test-model" });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('No Model Provider named "Nope" is configured');
  });

  test("with a Model the Model Provider doesn't list is a 400 naming the Models it does", async () => {
    const app = setup(
      standInReviews({ start: async () => ({ started: false, missing: "model", offeredModels: ["llama3.1:8b", "qwen2.5-coder:7b"] }) }),
    );

    const response = await postReview(app, { pullRequest: pullRequestRef, modelProvider: "Ollama", model: "llama3.1:7b" });

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe(`Ollama doesn't offer a Model named "llama3.1:7b". It offers: llama3.1:8b, qwen2.5-coder:7b.`);
  });

  test("with a Model Provider that can't list its Models is a 502 with its reason", async () => {
    const app = setup(
      standInReviews({
        start: async () => ({ started: false, unusable: "model-provider", reason: "connect ECONNREFUSED 127.0.0.1:11434" }),
      }),
    );

    const response = await postReview(app, { pullRequest: pullRequestRef, modelProvider: "Ollama", model: "test-model" });

    expect(response.status).toBe(502);
    expect(await errorOf(response)).toBe("Ollama can't be used: connect ECONNREFUSED 127.0.0.1:11434");
  });

  test("of a Pull Request that doesn't exist is a 404", async () => {
    const app = setup(standInReviews({ start: async () => ({ started: false, missing: "pull-request" }) }));

    const response = await postReview(app, {
      pullRequest: { ...pullRequestRef, number: 999 },
      modelProvider: "Ollama",
      model: "test-model",
    });

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("Pull Request acme/shop#999 not found");
  });

  test("in a Repository the GitHub App isn't installed on is a 403", async () => {
    const app = setup(standInReviews({ start: () => Promise.reject(notInstalled) }));

    const response = await postReview(app, { pullRequest: pullRequestRef, modelProvider: "Ollama", model: "test-model" });

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/isn't installed on acme\/shop/);
  });
});

describe("Fetching a Review", () => {
  test("returns it", async () => {
    const app = setup(standInReviews({ get: (id) => (id === review.id ? review : undefined) }));

    const response = await app.request(`/api/reviews/${review.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(review);
  });

  test("an unknown Review is a 404", async () => {
    const app = setup(standInReviews());

    const response = await app.request("/api/reviews/nope");

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe(unknownReview);
  });
});

describe("A Pull Request's Reviews", () => {
  test.each([
    ["9", 1],
    // No Pull Request has a number that isn't a positive integer, so the Reviews aren't asked.
    ["0", 0],
    ["7abc", 0],
  ])("of Pull Request number %j, which doesn't exist, are a 404", async (number, asked) => {
    const list = vi.fn<Reviews["list"]>(async () => undefined);
    const app = setup(standInReviews({ list }));

    const response = await app.request(`/api/repositories/acme/shop/pull-requests/${number}/reviews`);

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe(`Pull Request acme/shop#${number} not found`);
    expect(list).toHaveBeenCalledTimes(asked);
  });

  test("in a Repository the GitHub App isn't installed on are a 403", async () => {
    const app = setup(standInReviews({ list: () => Promise.reject(notInstalled) }));

    const response = await app.request("/api/repositories/acme/shop/pull-requests/7/reviews");

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toMatch(/isn't installed on acme\/shop/);
  });
});

describe("A Review's progress stream", () => {
  test("sends each event as one message, and ends when the events do", async () => {
    const events: ReviewEvent[] = [
      { type: "review", review },
      { type: "file-reviewing", file: "src/users.ts" },
      { type: "complete" },
    ];
    const followed = async function* () {
      yield* events;
    };
    const app = setup(standInReviews({ follow: (id) => (id === review.id ? followed() : undefined) }));

    const stream = await readProgressStream(app, review.id);

    expect(stream.response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(await stream.rest()).toEqual(events);
  });

  test("of an unknown Review is a 404", async () => {
    const app = setup(standInReviews());

    const response = await app.request("/api/reviews/nope/events");

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe(unknownReview);
  });

  test("stops following the Review when the client disconnects", async () => {
    let follower: AbortSignal | undefined;
    const app = setup(
      standInReviews({
        async *follow(_, signal) {
          follower = signal;
          yield { type: "review", review };
          await new Promise((resolve) => signal!.addEventListener("abort", resolve));
        },
      }),
    );
    const stream = await readProgressStream(app, review.id);
    await stream.next();
    expect(follower!.aborted).toBe(false);

    await stream.disconnect();

    await vi.waitFor(() => expect(follower!.aborted).toBe(true));
  });
});

describe("Models", () => {
  function setupProviders(...modelProviders: ModelProvider[]) {
    return setup(standInReviews(), modelProviders);
  }

  test("lists each Model Provider's Models, grouped by Model Provider", async () => {
    const app = setupProviders(
      fakeModelProvider([], { name: "Ollama", models: ["llama3.1:8b", "qwen2.5-coder:7b"] }).provider,
      fakeModelProvider([], { name: "OpenAI-compatible", models: ["gpt-4o"] }).provider,
    );

    const listed = await (await app.request("/api/models")).json();

    expect(listed).toEqual<ModelProviderListing[]>([
      { modelProvider: "Ollama", status: "available", models: ["llama3.1:8b", "qwen2.5-coder:7b"] },
      { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
    ]);
  });

  test("a Model Provider that can't be reached is listed as unavailable, and the others still list their Models", async () => {
    const app = setupProviders(
      fakeModelProvider([], { name: "Ollama", models: new Error("connect ECONNREFUSED 127.0.0.1:11434") }).provider,
      fakeModelProvider([], { name: "OpenAI-compatible", models: ["gpt-4o"] }).provider,
    );

    const response = await app.request("/api/models");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual<ModelProviderListing[]>([
      { modelProvider: "Ollama", status: "unavailable", reason: expect.stringContaining("ECONNREFUSED") },
      { modelProvider: "OpenAI-compatible", status: "available", models: ["gpt-4o"] },
    ]);
  });

  test("with no Model Provider configured, the listing is empty", async () => {
    const app = setupProviders();

    expect(await (await app.request("/api/models")).json()).toEqual([]);
  });
});

describe("Recent Reviews", () => {
  test("are the Reviews' recent ones, across all Repositories", async () => {
    const recent: RecentReview[] = [
      {
        id: "r1",
        pullRequest: pullRequestRef,
        pullRequestTitle: "Add user lookup",
        modelProvider: "Ollama",
        model: "test-model",
        headCommit: "abc1234",
        createdAt: "2026-10-01T00:00:00.000Z",
        status: "running",
        findingCounts: { "bad-practice": 0, "security-issue": 0 },
        severityCounts: { low: 0, medium: 0, high: 0, critical: 0 },
        progress: { settled: 0, total: 1 },
      },
    ];
    const app = setup(standInReviews({ recent: () => recent }));

    const response = await app.request("/api/reviews");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(recent);
  });
});

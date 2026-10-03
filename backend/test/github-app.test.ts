import { describe, expect, test } from "vitest";
import type { GitHubAppStatus } from "@diffwise/shared";
import { createApp } from "../src/app.ts";
import { memoryGitHubAppStore, type GitHubAppCredentials } from "../src/github-app.ts";
import { fakeForge, fakeModelProvider, standInReviews } from "./fakes.ts";

const credentials: GitHubAppCredentials = {
  id: 123,
  slug: "diffwise-a1b2c3",
  name: "diffwise-a1b2c3",
  htmlUrl: "https://github.com/apps/diffwise-a1b2c3",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  clientId: "Iv1.abc",
  clientSecret: "secret",
};

function setup() {
  const store = memoryGitHubAppStore();
  const convertedCodes: string[] = [];
  const app = createApp({
    forge: fakeForge([]),
    modelProviders: [fakeModelProvider([]).provider],
    reviews: standInReviews(),
    githubApp: {
      store,
      async convertManifestCode(code) {
        convertedCodes.push(code);
        return credentials;
      },
    },
  });
  return { app, store, convertedCodes };
}

/** The page's form: where it posts to, and the App manifest it posts. */
async function manifestForm(app: ReturnType<typeof createApp>) {
  const response = await app.request("/api/github-app/new");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/text\/html/);
  const html = await response.text();
  const action = /<form[^>]* action="([^"]+)"/.exec(html)?.[1];
  const manifest = /<input[^>]* name="manifest"[^>]* value="([^"]*)"/.exec(html)?.[1];
  if (!action || manifest === undefined) throw new Error(`No manifest form in ${html}`);
  const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return { action: new URL(unescape(action)), manifest: JSON.parse(unescape(manifest)) as Record<string, unknown> };
}

async function status(app: ReturnType<typeof createApp>) {
  return (await (await app.request("/api/github-app")).json()) as GitHubAppStatus;
}

describe("GitHub App setup", () => {
  test("with no App credentials saved, the GitHub App is not created", async () => {
    const { app } = setup();

    expect(await status(app)).toEqual({ status: "not-created" });
  });

  test("the Manifest page asks GitHub for an App with read-only Pull Requests, contents and metadata, and no webhook", async () => {
    const { app } = setup();

    const { action, manifest } = await manifestForm(app);

    expect(action.origin + action.pathname).toBe("https://github.com/settings/apps/new");
    expect(action.searchParams.get("state")).toBeTruthy();
    expect(manifest.default_permissions).toEqual({ pull_requests: "read", contents: "read", metadata: "read" });
    expect(manifest.default_events).toEqual([]);
    expect(manifest.hook_attributes).toEqual({ url: expect.any(String), active: false });
    expect(manifest.public).toBe(false);
    expect(manifest.redirect_url).toBe("http://localhost/api/github-app/callback");
  });

  test("GitHub's redirect back saves the App's credentials, and then says how to install it", async () => {
    const { app, store, convertedCodes } = setup();
    const { action } = await manifestForm(app);

    const callback = await app.request(`/api/github-app/callback?code=one-time-code&state=${action.searchParams.get("state")}`);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    expect(convertedCodes).toEqual(["one-time-code"]);
    expect(store.load()).toEqual(credentials);
    expect(await status(app)).toEqual({
      status: "created",
      name: "diffwise-a1b2c3",
      htmlUrl: "https://github.com/apps/diffwise-a1b2c3",
      installUrl: "https://github.com/apps/diffwise-a1b2c3/installations/new",
    });
  });

  test("a redirect back without the state the Manifest page sent is refused, and nothing is saved", async () => {
    const { app, store, convertedCodes } = setup();
    await manifestForm(app);

    const callback = await app.request("/api/github-app/callback?code=one-time-code&state=forged");

    expect(callback.status).toBe(400);
    expect(convertedCodes).toEqual([]);
    expect(store.load()).toBeUndefined();
  });

  test("once the App is created, the Manifest page sends the user back instead of creating another", async () => {
    const { app } = setup();
    const { action } = await manifestForm(app);
    await app.request(`/api/github-app/callback?code=one-time-code&state=${action.searchParams.get("state")}`);

    const again = await app.request("/api/github-app/new");

    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toBe("/");
  });
});

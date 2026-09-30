import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** What GitHub hands back when it creates Diffwise's GitHub App from the manifest. Secret: never sent to the browser. */
export interface GitHubAppCredentials {
  id: number;
  slug: string;
  name: string;
  htmlUrl: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

/** Where the GitHub App's credentials are kept once it's created. */
export interface GitHubAppStore {
  load(): GitHubAppCredentials | undefined;
  save(credentials: GitHubAppCredentials): void;
}

/** Keeps the credentials in a JSON file only the current user can read, outside the repo's history (see .gitignore). */
export function fileGitHubAppStore(path: string): GitHubAppStore {
  return {
    load() {
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as GitHubAppCredentials) : undefined;
    },
    save(credentials) {
      writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
      // mode only applies to a new file.
      chmodSync(path, 0o600);
    },
  };
}

export function memoryGitHubAppStore(): GitHubAppStore {
  let saved: GitHubAppCredentials | undefined;
  return {
    load: () => saved,
    save: (credentials) => {
      saved = credentials;
    },
  };
}

export function installUrl(credentials: GitHubAppCredentials): string {
  return `https://github.com/apps/${credentials.slug}/installations/new`;
}

const HOMEPAGE_URL = "https://github.com/Kegwed/diffwise";

/**
 * The manifest GitHub creates the App from: read-only access to Pull Requests and their code, and no webhook.
 * GitHub sends the browser back to `origin`'s callback with a one-time code, and there after each installation.
 */
export function appManifest(origin: string) {
  return {
    // App names are unique across GitHub, so each Diffwise gets its own; GitHub lets the user change it before creating.
    name: `diffwise-${randomBytes(3).toString("hex")}`,
    url: HOMEPAGE_URL,
    description: "Self-hosted AI Pull Request reviewer. Reads Pull Requests; never writes.",
    public: false,
    redirect_url: `${origin}/api/github-app/callback`,
    setup_url: `${origin}/`,
    // Webhooks can't reach a self-hosted Diffwise (see ADR-0001), so there is none.
    hook_attributes: { url: HOMEPAGE_URL, active: false },
    default_events: [],
    default_permissions: { pull_requests: "read", contents: "read", metadata: "read" },
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A page that posts the manifest to GitHub as soon as it loads, with `state` to check GitHub's redirect back against. */
export function manifestPage(manifest: object, state: string): string {
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Creating Diffwise's GitHub App</title></head>
<body>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<p>Taking you to GitHub to create Diffwise's GitHub App…</p>
<button type="submit">Continue to GitHub</button>
</form>
<script>document.forms[0].submit()</script>
</body>
</html>`;
}

/** Calls GitHub's REST API, authenticated as `auth` (an App JWT or installation token) when given. */
export function githubApi(path: string, { auth, ...init }: RequestInit & { auth?: string } = {}): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(auth && { authorization: `Bearer ${auth}` }),
    },
  });
}

/** The body of GitHub's reply, or an error saying what GitHub replied while `doing` it. */
export async function githubJson<T>(response: Response, doing: string): Promise<T> {
  if (!response.ok) throw new Error(`GitHub replied ${response.status} when ${doing}: ${await response.text()}`);
  return (await response.json()) as T;
}

/** Trades the one-time code from GitHub's redirect for the created App's credentials. */
export async function convertManifestCode(code: string): Promise<GitHubAppCredentials> {
  const response = await githubApi(`/app-manifests/${encodeURIComponent(code)}/conversions`, { method: "POST" });
  const body = await githubJson<{
    id: number;
    slug: string;
    name: string;
    html_url: string;
    pem: string;
    client_id: string;
    client_secret: string;
  }>(response, "creating the GitHub App");
  return {
    id: body.id,
    slug: body.slug,
    name: body.name,
    htmlUrl: body.html_url,
    privateKey: body.pem,
    clientId: body.client_id,
    clientSecret: body.client_secret,
  };
}

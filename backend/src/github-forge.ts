import { createSign } from "node:crypto";
import type { PullRequestRef, PullRequestSummary, RepositoryRef } from "@diffwise/shared";
import { ForgeAccessError, type Forge } from "./forge.ts";
import { githubApi, githubJson as json, installUrl, type GitHubAppCredentials } from "./github-app.ts";

/** GitHub lists at most this many changed files for a Pull Request. */
const MAX_FILES = 3000;

/** A Pull Request as GitHub's API describes it, as far as Diffwise reads it. */
interface GitHubPull {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  head: { sha: string };
  base: { repo: GitHubRepository };
}

interface GitHubRepository {
  name: string;
  owner: { login: string };
}

/**
 * Reads Repositories and Pull Requests from GitHub as Diffwise's GitHub App, using an installation token for each
 * Repository's installation. Thin on purpose: it only translates GitHub's API, and is checked by hand (see README.md).
 */
export function githubForge(loadCredentials: () => GitHubAppCredentials | undefined): Forge {
  const installationTokens = new Map<number, { token: string; expiresAt: number }>();

  function requireCredentials(): GitHubAppCredentials {
    const credentials = loadCredentials();
    if (!credentials) {
      throw new ForgeAccessError("Diffwise isn't connected to GitHub yet. Create its GitHub App first, then install it on the Repository.");
    }
    return credentials;
  }

  /** A token for the installation with this id, authenticating as the App with `jwt` to create one. */
  async function installationToken(jwt: string, id: number): Promise<string> {
    const cached = installationTokens.get(id);
    // Installation tokens last an hour; renew with a few minutes to spare.
    if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
    const { token, expires_at } = await json<{ token: string; expires_at: string }>(
      await githubApi(`/app/installations/${id}/access_tokens`, { method: "POST", auth: jwt }),
      "creating an installation token",
    );
    installationTokens.set(id, { token, expiresAt: Date.parse(expires_at) });
    return token;
  }

  /** A token for the installation of the App on the Repository, or a ForgeAccessError saying to install it there. */
  async function repositoryToken({ owner, repo }: RepositoryRef): Promise<string> {
    const credentials = requireCredentials();
    const jwt = appJwt(credentials);
    const installationResponse = await githubApi(`${repoPath({ owner, repo })}/installation`, { auth: jwt });
    if (installationResponse.status === 404) {
      throw new ForgeAccessError(
        `The GitHub App ${credentials.name} isn't installed on ${owner}/${repo}, or that Repository doesn't exist. ` +
          `Install it there at ${installUrl(credentials)}, then try again.`,
      );
    }
    const { id } = await json<{ id: number }>(installationResponse, `looking up the GitHub App's installation on ${owner}/${repo}`);
    return installationToken(jwt, id);
  }

  return {
    async listRepositories() {
      const credentials = loadCredentials();
      // Not connected yet: there's nothing to browse, and the page offers to create the App.
      if (!credentials) return { repositories: [] };
      const jwt = appJwt(credentials);
      const installations = await listAll<{ id: number; suspended_at: string | null }>(
        "/app/installations",
        jwt,
        "listing the GitHub App's installations",
      );
      const repositories: RepositoryRef[] = [];
      // A suspended installation can't be given a token.
      for (const { id } of installations.filter((installation) => !installation.suspended_at)) {
        const installed = await listAll<GitHubRepository>(
          "/installation/repositories",
          await installationToken(jwt, id),
          "listing the Repositories the GitHub App is installed on",
          { itemsOf: (body) => (body as { repositories: GitHubRepository[] }).repositories },
        );
        repositories.push(...installed.map((repository) => ({ owner: repository.owner.login, repo: repository.name })));
      }
      return { repositories };
    },

    async listOpenPullRequests(repository) {
      const pulls = await listAll<GitHubPull>(
        `${repoPath(repository)}/pulls?state=open`,
        await repositoryToken(repository),
        `listing the open Pull Requests of ${repository.owner}/${repository.repo}`,
      );
      return pulls.map(summary);
    },

    async getPullRequest(ref) {
      const token = await repositoryToken(ref);
      const pull = await fetchPull(ref, token);
      if (!pull) return undefined;
      const files = await listAll<{ filename: string; patch?: string }>(
        `${pullPath(ref)}/files`,
        token,
        `listing the changed files of ${ref.owner}/${ref.repo}#${ref.number}`,
        { max: MAX_FILES },
      );
      return {
        ...summary(pull),
        description: pull.body ?? "",
        // GitHub sends no patch for binary files and diffs too large to show; the skip list reports those.
        files: files.map((file) => ({ path: file.filename, patch: file.patch ?? "" })),
      };
    },

    async getPullRequestSummary(ref) {
      const pull = await fetchPull(ref, await repositoryToken(ref));
      return pull && summary(pull);
    },
  };
}

/** The Pull Request as GitHub describes it, without its changed files; undefined if there's no such Pull Request. */
async function fetchPull(ref: PullRequestRef, token: string): Promise<GitHubPull | undefined> {
  const response = await githubApi(pullPath(ref), { auth: token });
  if (response.status === 404) return undefined;
  return json<GitHubPull>(response, `fetching ${ref.owner}/${ref.repo}#${ref.number}`);
}

function summary(pull: GitHubPull): PullRequestSummary {
  return {
    // GitHub's own spelling of the names, whatever case the URL used.
    owner: pull.base.repo.owner.login,
    repo: pull.base.repo.name,
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? "ghost",
    headCommit: pull.head.sha,
  };
}

/**
 * Every item of one of GitHub's paginated listings, fetched 100 to a page until a short page or `max` items.
 * `itemsOf` picks the items out of a page's body, for the listings that wrap them in an object.
 */
async function listAll<T>(
  path: string,
  auth: string,
  doing: string,
  { max = Infinity, itemsOf = (body) => body as T[] }: { max?: number; itemsOf?: (body: unknown) => T[] } = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; items.length < max; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = itemsOf(await json<unknown>(await githubApi(`${path}${separator}per_page=100&page=${page}`, { auth }), doing));
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

function repoPath({ owner, repo }: RepositoryRef): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function pullPath(ref: PullRequestRef): string {
  return `${repoPath(ref)}/pulls/${ref.number}`;
}

/** A short-lived JSON Web Token that authenticates as the App itself, signed with its private key. */
function appJwt({ id, privateKey }: GitHubAppCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // Backdated a minute against clock drift; GitHub allows at most ten minutes.
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 9 * 60, iss: String(id) })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

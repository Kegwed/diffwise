import { createSign } from "node:crypto";
import type { PullRequestRef } from "@diffwise/shared";
import { ForgeAccessError, type ChangedFile, type Forge } from "./forge.ts";
import { githubApi, githubJson as json, installUrl, type GitHubAppCredentials } from "./github-app.ts";

/** GitHub lists at most this many changed files for a Pull Request. */
const MAX_FILES = 3000;

/**
 * Reads Pull Requests from GitHub as Diffwise's GitHub App, using an installation token for each repo's installation.
 * Thin on purpose: it only translates GitHub's API, and is checked by hand (see README.md).
 */
export function githubForge(loadCredentials: () => GitHubAppCredentials | undefined): Forge {
  const installationTokens = new Map<number, { token: string; expiresAt: number }>();

  /** A token for the installation of the App on `ref`'s repo, or a ForgeAccessError saying to install it there. */
  async function installationToken(credentials: GitHubAppCredentials, { owner, repo }: PullRequestRef): Promise<string> {
    const jwt = appJwt(credentials);
    const installationResponse = await githubApi(`${repoPath({ owner, repo })}/installation`, { auth: jwt });
    if (installationResponse.status === 404) {
      throw new ForgeAccessError(
        `The GitHub App ${credentials.name} isn't installed on ${owner}/${repo}, or that repo doesn't exist. ` +
          `Install it on that repo at ${installUrl(credentials)}, then try again.`,
      );
    }
    const { id } = await json<{ id: number }>(installationResponse, `looking up the GitHub App's installation on ${owner}/${repo}`);
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

  return {
    // Browsing installed repos' Pull Requests comes later; until then a Pull Request is reached by its URL.
    async listPullRequests() {
      return [];
    },

    async getPullRequest(ref) {
      const credentials = loadCredentials();
      if (!credentials) {
        throw new ForgeAccessError("Diffwise isn't connected to GitHub yet. Create its GitHub App first, then install it on the repo.");
      }
      const token = await installationToken(credentials, ref);
      const pullPath = `${repoPath(ref)}/pulls/${ref.number}`;
      const pullResponse = await githubApi(pullPath, { auth: token });
      if (pullResponse.status === 404) return undefined;
      const pull = await json<{
        title: string;
        body: string | null;
        user: { login: string } | null;
        head: { sha: string };
        base: { repo: { name: string; owner: { login: string } } };
      }>(pullResponse, `fetching ${ref.owner}/${ref.repo}#${ref.number}`);

      const files: ChangedFile[] = [];
      for (let page = 1; files.length < MAX_FILES; page++) {
        const batch = await json<{ filename: string; patch?: string }[]>(
          await githubApi(`${pullPath}/files?per_page=100&page=${page}`, { auth: token }),
          `listing the changed files of ${ref.owner}/${ref.repo}#${ref.number}`,
        );
        // GitHub sends no patch for binary files and diffs too large to show; the skip list reports those.
        files.push(...batch.map((file) => ({ path: file.filename, patch: file.patch ?? "" })));
        if (batch.length < 100) break;
      }

      return {
        // GitHub's own spelling of the names, whatever case the URL used.
        owner: pull.base.repo.owner.login,
        repo: pull.base.repo.name,
        number: ref.number,
        title: pull.title,
        author: pull.user?.login ?? "ghost",
        headCommit: pull.head.sha,
        description: pull.body ?? "",
        files,
      };
    },
  };
}

function repoPath({ owner, repo }: Pick<PullRequestRef, "owner" | "repo">): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
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

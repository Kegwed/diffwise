import type { PullRequestRef } from "@diffwise/shared";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/** The Pull Request a GitHub Pull Request URL (or one of its tabs, like /files) points at, or undefined if it isn't one. */
export function parsePullRequestUrl(input: string): PullRequestRef | undefined {
  const trimmed = input.trim();
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || !GITHUB_HOSTS.has(url.hostname)) return undefined;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname);
  if (!match) return undefined;
  const [, owner, repo, number] = match;
  return { owner: owner!, repo: repo!, number: Number(number) };
}

import type { GitHubAppStatus } from "@diffwise/shared";
import { Button } from "./design-system/index.ts";

/** Offers to create Diffwise's GitHub App, or once it's created, says how to install it on repos. */
export function GitHubConnection({ status }: { status: GitHubAppStatus }) {
  if (status.status === "not-created") {
    return (
      <section aria-labelledby="github">
        <h2 id="github">Connect to GitHub</h2>
        <p>
          Diffwise reads Pull Requests through its own GitHub App, which you create on your GitHub account in one click.
          It can only read Pull Requests, code and repo metadata, and has no webhook. Its credentials are saved on this
          machine.
        </p>
        {/* A plain navigation: the backend's page posts the App manifest on to GitHub, and GitHub sends the browser back here. */}
        <form method="get" action="/api/github-app/new">
          <Button type="submit" variant="primary">
            Create GitHub App
          </Button>
        </form>
      </section>
    );
  }
  return (
    <p className="github-connection">
      Connected to GitHub as <a href={status.htmlUrl}>{status.name}</a>. To review a repo's Pull Requests,{" "}
      <a href={status.installUrl}>install {status.name} on that repo</a> and choose the repositories it may read.
    </p>
  );
}

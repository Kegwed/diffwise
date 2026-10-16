import { Button } from "./design-system/index.ts";

/** Offers to create Diffwise's GitHub App, before there is one. */
export function GitHubConnection() {
  return (
    <section aria-labelledby="github" className="card github-connection">
      <h2 id="github">Connect to GitHub</h2>
      <p>
        Diffwise reads Pull Requests through its own GitHub App, which you create on your GitHub account in one click. It
        can only read Pull Requests, code and Repository metadata, and has no webhook. Its credentials are saved on this
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

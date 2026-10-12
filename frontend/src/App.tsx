import { useState } from "react";
import { AppHeader } from "./AppHeader.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { RepositoriesView } from "./RepositoriesView.tsx";
import { RepositoryView } from "./RepositoryView.tsx";
import { pullRequestHref, repositoryHref, useRoute } from "./route.ts";

export function App() {
  const route = useRoute();
  const [githubReachable, setGitHubReachable] = useState(true);

  return (
    <>
      {/* Only the first view finds out whether GitHub can be reached; elsewhere the header doesn't claim it can't. */}
      <AppHeader githubUnreachable={route.view === "repositories" && !githubReachable} />
      <main>
        {route.view === "repositories" && <RepositoriesView onGitHubReachable={setGitHubReachable} />}
        {/* Keyed, so going from one Repository or Pull Request to another starts the view afresh. */}
        {route.view === "repository" && <RepositoryView key={repositoryHref(route.repository)} repository={route.repository} />}
        {route.view === "pull-request" && (
          <PullRequestView key={pullRequestHref(route.pullRequest)} pullRequest={route.pullRequest} reviewId={route.reviewId} />
        )}
      </main>
    </>
  );
}

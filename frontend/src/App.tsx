import { useState } from "react";
import { AppHeader } from "./AppHeader.tsx";
import { HomeView } from "./HomeView.tsx";
import { PullRequestView } from "./PullRequestView.tsx";
import { ReviewPage } from "./ReviewPage.tsx";
import { RepositoryView } from "./RepositoryView.tsx";
import { pullRequestHref, repositoryHref, useRoute } from "./route.ts";

export function App() {
  const route = useRoute();
  const [githubReachable, setGitHubReachable] = useState(true);

  return (
    <>
      {/* Only the first view finds out whether GitHub can be reached; elsewhere the header doesn't claim it can't. */}
      <AppHeader githubUnreachable={route.view === "home" && !githubReachable} />
      <main>
        {route.view === "home" && <HomeView onGitHubReachable={setGitHubReachable} />}
        {/* Keyed, so going from one Repository or Pull Request to another starts the view afresh. */}
        {route.view === "repository" && <RepositoryView key={repositoryHref(route.repository)} repository={route.repository} />}
        {route.view === "pull-request" &&
          (route.reviewId === undefined ? (
            <PullRequestView key={pullRequestHref(route.pullRequest)} pullRequest={route.pullRequest} />
          ) : (
            <ReviewPage key={pullRequestHref(route.pullRequest)} pullRequest={route.pullRequest} reviewId={route.reviewId} />
          ))}
      </main>
    </>
  );
}

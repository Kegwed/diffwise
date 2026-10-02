import { PullRequestView } from "./PullRequestView.tsx";
import { RepositoriesView } from "./RepositoriesView.tsx";
import { RepositoryView } from "./RepositoryView.tsx";
import { pullRequestHref, repositoryHref, useRoute } from "./route.ts";

export function App() {
  const route = useRoute();

  return (
    <main>
      <h1>Diffwise</h1>
      {route.view === "repositories" && <RepositoriesView />}
      {/* Keyed, so going from one Repository or Pull Request to another starts the view afresh. */}
      {route.view === "repository" && <RepositoryView key={repositoryHref(route.repository)} repository={route.repository} />}
      {route.view === "pull-request" && (
        <PullRequestView key={pullRequestHref(route.pullRequest)} pullRequest={route.pullRequest} reviewId={route.reviewId} />
      )}
    </main>
  );
}

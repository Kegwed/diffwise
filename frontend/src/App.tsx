import { PullRequest } from "./PullRequest.tsx";
import { Repositories } from "./Repositories.tsx";
import { RepositoryPullRequests } from "./RepositoryPullRequests.tsx";
import { pullRequestHref, repositoryHref, useRoute } from "./route.ts";

export function App() {
  const route = useRoute();

  return (
    <main>
      <h1>Diffwise</h1>
      {route.view === "repositories" && <Repositories />}
      {/* Keyed, so going from one repository or Pull Request to another starts the view afresh. */}
      {route.view === "repository" && <RepositoryPullRequests key={repositoryHref(route.repository)} repository={route.repository} />}
      {route.view === "pull-request" && <PullRequest key={pullRequestHref(route.pullRequest)} pullRequest={route.pullRequest} />}
    </main>
  );
}

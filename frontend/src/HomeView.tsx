import { useEffect } from "react";
import { FIXTURE_REPOSITORY } from "@diffwise/shared";
import { getGitHubApp, listRecentReviews, listRepositories } from "./api.ts";
import { FirstRun } from "./FirstRun.tsx";
import { PullRequestUrlForm } from "./PullRequestUrlForm.tsx";
import { RecentReviews } from "./RecentReviews.tsx";
import { RepositoriesCard, repositoriesState } from "./RepositoriesCard.tsx";
import { isFirstLoading, isPending, useLoaded, useRetryable } from "./useLoaded.ts";

const NOT_INSTALLED_HINT = `Only Pull Requests from installed Repositories open. Until you install one, try ${FIXTURE_REPOSITORY.owner}/${FIXTURE_REPOSITORY.repo}.`;

/**
 * The first view: a pasted Pull Request URL to open, the Repositories Diffwise can read, and the recent Reviews across
 * all of them; or, before the GitHub App is created, the first run. Says through `onGitHubReachable` whether GitHub
 * could list the Repositories, the only place that's known without asking GitHub again.
 */
export function HomeView({ onGitHubReachable }: { onGitHubReachable: (reachable: boolean) => void }) {
  const githubApp = useLoaded(getGitHubApp);
  // Each is tried again on its own, so trying one again doesn't load the others again.
  const [listing, retryRepositories] = useRetryable(listRepositories);
  const [recent, retryReviews] = useRetryable(listRecentReviews);
  const unlisted = Boolean(listing.data?.unlisted);
  const installUrl = githubApp.data?.status === "created" ? githubApp.data.installUrl : undefined;

  useEffect(() => onGitHubReachable(!unlisted), [unlisted]);

  if (githubApp.data?.status === "not-created") return <FirstRun />;

  // Busy only while first loading: trying one card again shows its skeletons but leaves the rest of the page usable.
  const loading = [githubApp, listing, recent].some(isFirstLoading);
  const repositories = repositoriesState(listing, !isPending(githubApp));
  // Without the GitHub App's status there's no saying where to install it, so no hint that it should be.
  const installedNowhere = repositories.state === "installed-nowhere" && installUrl !== undefined;

  return (
    <div className="page" aria-busy={loading}>
      <PullRequestUrlForm installUrl={installUrl} hint={installedNowhere ? NOT_INSTALLED_HINT : undefined} disabled={loading} />
      {loading && (
        <p role="status" className="caption home-status">
          Loading Repositories and Reviews…
        </p>
      )}
      {githubApp.error && (
        <p role="alert" className="caption">
          {githubApp.error}
        </p>
      )}
      <div className="home-columns">
        <RepositoriesCard listing={listing} state={repositories} installUrl={installUrl} onRetry={retryRepositories} />
        <RecentReviews recent={recent} onRetry={retryReviews} />
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { isFixtureRepository } from "@diffwise/shared";
import { getGitHubApp, listRepositories } from "./api.ts";
import { GitHubConnection } from "./GitHubConnection.tsx";
import { PullRequestUrlForm } from "./PullRequestUrlForm.tsx";
import { RecentReviews } from "./RecentReviews.tsx";
import { repositoryHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/**
 * The first view: a pasted Pull Request URL to open, the Repositories Diffwise can read, and the recent Reviews across
 * all of them. Says through `onGitHubReachable` whether GitHub could list the Repositories, the only place that's
 * known without asking GitHub again.
 */
export function HomeView({ onGitHubReachable }: { onGitHubReachable: (reachable: boolean) => void }) {
  const githubApp = useLoaded(getGitHubApp);
  const listing = useLoaded(listRepositories);
  const unlisted = Boolean(listing.data?.unlisted);
  const installUrl = githubApp.data?.status === "created" ? githubApp.data.installUrl : undefined;

  useEffect(() => onGitHubReachable(!unlisted), [unlisted]);

  return (
    <div className="page">
      {githubApp.data?.status === "not-created" && <GitHubConnection />}
      <PullRequestUrlForm installUrl={installUrl} />
      <div className="home-columns">
        <section aria-labelledby="repositories" className="card repositories">
          <div className="card-head">
            <h3 id="repositories">Repositories</h3>
            {listing.data && <span className="caption">{listing.data.repositories.length} listed</span>}
          </div>
          {!listing.data && !listing.error && <p className="card-note">Loading…</p>}
          {listing.data?.repositories.length === 0 && !listing.data.unlisted && (
            <p className="card-note">Diffwise can't read any Repository yet. Install its GitHub App on one to see it here.</p>
          )}
          {listing.data && listing.data.repositories.length > 0 && (
            <ul aria-labelledby="repositories">
              {listing.data.repositories.map((repository) => (
                <li key={`${repository.owner}/${repository.repo}`}>
                  <a href={repositoryHref(repository)}>
                    {repository.owner}/{repository.repo}
                  </a>
                  {isFixtureRepository(repository) && <span className="caption">Built-in fixture. Works without GitHub.</span>}
                </li>
              ))}
            </ul>
          )}
          {listing.data?.unlisted && (
            <p role="alert" className="card-note">
              Some Repositories couldn't be listed. {listing.data.unlisted}
            </p>
          )}
          {(githubApp.error ?? listing.error) && (
            <p role="alert" className="card-note">
              {githubApp.error ?? listing.error}
            </p>
          )}
          {installUrl && (
            <div className="card-note">
              {/* The ghost Button's look on a link to GitHub. */}
              <a className="dw-btn dw-btn-ghost dw-btn-sm" href={installUrl}>
                Install on more Repositories
              </a>
            </div>
          )}
        </section>
        <RecentReviews />
      </div>
    </div>
  );
}

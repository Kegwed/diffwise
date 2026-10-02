import { getGitHubApp, listRepositories } from "./api.ts";
import { GitHubConnection } from "./GitHubConnection.tsx";
import { PullRequestUrlForm } from "./PullRequestUrlForm.tsx";
import { repositoryHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** The first view: the Repositories the GitHub App is installed on, each leading to its open Pull Requests. */
export function RepositoriesView() {
  const githubApp = useLoaded(getGitHubApp);
  const listing = useLoaded(listRepositories);

  return (
    <>
      {githubApp.data && <GitHubConnection status={githubApp.data} />}
      <section aria-labelledby="repositories">
        <h2 id="repositories">Repositories</h2>
        <PullRequestUrlForm />
        {!listing.data && !listing.error && <p>Loading…</p>}
        {listing.data?.repositories.length === 0 && !listing.data.unlisted && (
          <p>Diffwise can't read any Repository yet. Install its GitHub App on one to see it here.</p>
        )}
        <ul className="rows">
          {listing.data?.repositories.map((repository) => (
            <li key={`${repository.owner}/${repository.repo}`}>
              <a href={repositoryHref(repository)}>
                {repository.owner}/{repository.repo}
              </a>
            </li>
          ))}
        </ul>
        {listing.data?.unlisted && <p role="alert">Some Repositories couldn't be listed. {listing.data.unlisted}</p>}
        {(githubApp.error ?? listing.error) && <p role="alert">{githubApp.error ?? listing.error}</p>}
      </section>
    </>
  );
}

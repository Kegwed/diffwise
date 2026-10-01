import { getGitHubApp, listRepositories } from "./api.ts";
import { GitHubConnection } from "./GitHubConnection.tsx";
import { PullRequestUrlForm } from "./PullRequestUrlForm.tsx";
import { repositoryHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** The first view: the repositories the GitHub App is installed on, each leading to its open Pull Requests. */
export function Repositories() {
  const githubApp = useLoaded(getGitHubApp);
  const repositories = useLoaded(listRepositories);

  return (
    <>
      {githubApp.data && <GitHubConnection status={githubApp.data} />}
      <section aria-labelledby="repositories">
        <h2 id="repositories">Repositories</h2>
        <PullRequestUrlForm />
        {!repositories.data && !repositories.error && <p>Loading…</p>}
        {repositories.data?.length === 0 && <p>Diffwise can't read any repository yet. Install its GitHub App on one to see it here.</p>}
        <ul className="rows">
          {repositories.data?.map((repository) => (
            <li key={`${repository.owner}/${repository.repo}`}>
              <a href={repositoryHref(repository)}>
                {repository.owner}/{repository.repo}
              </a>
            </li>
          ))}
        </ul>
        {(githubApp.error ?? repositories.error) && <p role="alert">{githubApp.error ?? repositories.error}</p>}
      </section>
    </>
  );
}

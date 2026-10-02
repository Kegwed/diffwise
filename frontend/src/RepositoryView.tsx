import type { RepositoryRef } from "@diffwise/shared";
import { listOpenPullRequests } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { HeadCommit } from "./HeadCommit.tsx";
import { pullRequestHref, REPOSITORIES_HREF } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** A Repository's open Pull Requests, each leading to its detail view. */
export function RepositoryView({ repository }: { repository: RepositoryRef }) {
  const pullRequests = useLoaded(() => listOpenPullRequests(repository));
  const name = `${repository.owner}/${repository.repo}`;

  return (
    <section aria-labelledby="pull-requests">
      <Breadcrumb above={[{ label: "Repositories", href: REPOSITORIES_HREF }]} current={name} />
      <h2 id="pull-requests">Open Pull Requests in {name}</h2>
      {!pullRequests.data && !pullRequests.error && <p>Loading…</p>}
      {pullRequests.data?.length === 0 && <p>{name} has no open Pull Requests.</p>}
      <ul className="rows">
        {pullRequests.data?.map((pr) => (
          <li key={pr.number}>
            <a href={pullRequestHref(pr)}>{pr.title}</a>
            <div className="caption">
              #{pr.number} by {pr.author} at <HeadCommit commit={pr.headCommit} />
            </div>
          </li>
        ))}
      </ul>
      {pullRequests.error && <p role="alert">{pullRequests.error}</p>}
    </section>
  );
}

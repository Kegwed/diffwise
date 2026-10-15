import { isFixtureRepository, type OpenPullRequest, type RepositoryRef, type ReviewSummary } from "@diffwise/shared";
import { listOpenPullRequests } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Badge, ReviewState } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { relativeTime } from "./relativeTime.ts";
import { reviewState, SeverityCounts } from "./ReviewList.tsx";
import { pullRequestHref, REPOSITORIES_HREF } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** A Repository's open Pull Requests, each with its latest Review and leading to its detail view. */
export function RepositoryView({ repository }: { repository: RepositoryRef }) {
  const pullRequests = useLoaded(() => listOpenPullRequests(repository));
  const name = `${repository.owner}/${repository.repo}`;
  const isFixture = isFixtureRepository(repository);

  return (
    <section aria-labelledby="repository" className="page">
      <Breadcrumb above={[{ label: "Repositories", href: REPOSITORIES_HREF }]} current={name} />
      <div className="repository-head">
        <div className="repository-title">
          <h2 id="repository">{name}</h2>
          {isFixture && <Badge>Built-in fixture</Badge>}
        </div>
        {isFixture && <p className="caption">Ships with Diffwise so you can try a Review without connecting GitHub.</p>}
      </div>
      {pullRequests.error ? (
        <p role="alert">{pullRequests.error}</p>
      ) : (
        <section aria-labelledby="open-pull-requests" className="card open-pull-requests">
          <div className="card-head">
            <h3 id="open-pull-requests">Open Pull Requests</h3>
            {pullRequests.data && <span className="caption">{pullRequests.data.length} open</span>}
          </div>
          {!pullRequests.data && <p className="open-pull-requests-note">Loading…</p>}
          {pullRequests.data?.length === 0 && <p className="open-pull-requests-note">{name} has no open Pull Requests.</p>}
          {pullRequests.data && pullRequests.data.length > 0 && (
            <>
              <div className="pull-request-row pull-request-row-head caption" aria-hidden="true">
                <span>Pull Request</span>
                <span>Head commit</span>
                <span>Latest Review</span>
              </div>
              <ul aria-labelledby="open-pull-requests">
                {pullRequests.data.map((pullRequest) => (
                  <PullRequestRow key={pullRequest.number} pullRequest={pullRequest} />
                ))}
              </ul>
            </>
          )}
          <p className="caption open-pull-requests-note">
            Closed Pull Requests aren't listed here. Paste a closed Pull Request's URL on the home page to open it.
          </p>
        </section>
      )}
    </section>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: OpenPullRequest }) {
  const { number, title, author, headBranch, baseBranch, headCommit, updatedAt, latestReview } = pullRequest;
  return (
    <li className="pull-request-row">
      <div className="pull-request-row-title">
        <a href={pullRequestHref(pullRequest)}>{title}</a>
        <span className="caption">
          #{number} · opened by {author} · {headBranch} into {baseBranch}
        </span>
      </div>
      <div className="pull-request-row-cell">
        <HeadCommit commit={headCommit} />
        <span className="caption">
          updated{" "}
          <time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString()}>
            {relativeTime(updatedAt)}
          </time>
        </span>
      </div>
      <div className="pull-request-row-cell">
        {latestReview ? (
          <>
            <ReviewState state={reviewState(latestReview)} />
            <LatestReviewNote review={latestReview} headCommit={headCommit} />
          </>
        ) : (
          <span className="caption">No Reviews yet</span>
        )}
      </div>
    </li>
  );
}

/** What the latest Review's state means for it: how far it's got, that it's lost on a restart, what the head commit now is, or what it found. */
function LatestReviewNote({ review, headCommit }: { review: ReviewSummary; headCommit: string }) {
  switch (reviewState(review)) {
    case "running":
      return review.progress ? <span className="caption">{`${review.progress.settled} of ${review.progress.total} files`}</span> : null;
    case "unsaved":
      return <span className="caption">Lost if Diffwise restarts.</span>;
    case "outdated":
      return (
        <span className="caption">
          Head is now <HeadCommit commit={headCommit} />
        </span>
      );
    case "complete":
      return <SeverityCounts counts={review.severityCounts} />;
  }
}

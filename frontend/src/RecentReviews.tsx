import type { RecentReview } from "@diffwise/shared";
import { listRecentReviews } from "./api.ts";
import { ReviewState } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { relativeTime } from "./relativeTime.ts";
import { reviewState, SeverityCounts } from "./ReviewList.tsx";
import { ReviewProgress } from "./ReviewProgress.tsx";
import { reviewHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** The newest Reviews across all Repositories, each leading to its own page. None says whether it's Outdated. */
export function RecentReviews() {
  const recent = useLoaded(listRecentReviews);

  return (
    <section aria-labelledby="recent-reviews" className="card recent-reviews">
      <div className="card-head">
        <h3 id="recent-reviews">Recent Reviews</h3>
        <span className="caption">Across all Repositories</span>
      </div>
      {!recent.data && !recent.error && <p className="card-note">Loading…</p>}
      {recent.error && (
        <p role="alert" className="card-note">
          {recent.error}
        </p>
      )}
      {recent.data?.length === 0 && <p className="card-note">No Reviews yet. Open a Pull Request to start one.</p>}
      {recent.data && recent.data.length > 0 && (
        <>
          <div className="recent-review recent-review-head caption" aria-hidden="true">
            <span className="recent-review-pull-request">Pull Request</span>
            <span className="recent-review-model">Model</span>
            <span className="recent-review-commit">Commit</span>
            <span className="recent-review-findings">Findings</span>
            <span className="recent-review-state">State</span>
          </div>
          <ul aria-labelledby="recent-reviews">
            {recent.data.map((review) => (
              <RecentReviewRow key={review.id} review={review} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RecentReviewRow({ review }: { review: RecentReview }) {
  const { pullRequest, pullRequestTitle, createdAt, status, progress } = review;
  const { owner, repo, number } = pullRequest;
  const hasFindings = Object.values(review.severityCounts).some((count) => count > 0);
  return (
    <li className="recent-review">
      <div className="recent-review-pull-request">
        {/* Reviews saved before titles were kept are named by the Pull Request's number. */}
        <a href={reviewHref(pullRequest, review.id)}>{pullRequestTitle ?? `#${number}`}</a>
        <span className="caption">
          {owner}/{repo} #{number} · Started{" "}
          <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
            {relativeTime(createdAt)}
          </time>
        </span>
      </div>
      <div className="recent-review-model">
        <code>{review.model}</code>
        <span className="caption">{review.modelProvider}</span>
      </div>
      <div className="recent-review-commit">
        <HeadCommit commit={review.headCommit} />
      </div>
      <div className="recent-review-findings">
        {/* A running Review with nothing found yet hasn't found there's nothing to find. */}
        {(status !== "running" || hasFindings) && <SeverityCounts counts={review.severityCounts} />}
      </div>
      <div className="recent-review-state">
        <ReviewState state={reviewState(review)} />
        {status === "running" && progress && (
          <>
            <ReviewProgress {...progress} />
            <span className="caption">{`${progress.settled} of ${progress.total} files. Lost if Diffwise restarts.`}</span>
          </>
        )}
        {status === "unsaved" && <span className="caption">Lost if Diffwise restarts</span>}
      </div>
    </li>
  );
}

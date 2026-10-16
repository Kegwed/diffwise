import type { RecentReview } from "@diffwise/shared";
import { CardMessage } from "./CardMessage.tsx";
import { ReviewState } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { relativeTime } from "./relativeTime.ts";
import { reviewState, SeverityCounts } from "./ReviewList.tsx";
import { ReviewProgress } from "./ReviewProgress.tsx";
import { reviewHref } from "./route.ts";
import { Skeleton } from "./Skeleton.tsx";
import { isPending, type Reloaded } from "./useLoaded.ts";

/** The Pull Request column's width in each skeleton row, so the rows don't read as one block. */
const SKELETON_ROW_WIDTHS = ["70%", "55%", "65%", "50%", "60%"];

/**
 * The newest Reviews across all Repositories, each leading to its own page. None says whether it's Outdated.
 * `onRetry` loads them again after they couldn't be.
 */
export function RecentReviews({ recent, onRetry }: { recent: Reloaded<RecentReview[]>; onRetry: () => void }) {
  const pending = isPending(recent);

  return (
    <section aria-labelledby="recent-reviews" className="card recent-reviews">
      <div className="card-head">
        <h3 id="recent-reviews">Recent Reviews</h3>
        <span className="caption">Across all Repositories</span>
      </div>
      {(pending || (recent.data && recent.data.length > 0)) && <RecentReviewsHead />}
      {pending && (
        <div aria-hidden="true">
          {SKELETON_ROW_WIDTHS.map((width, i) => (
            <div key={i} className="recent-review">
              <div className="recent-review-pull-request">
                <Skeleton width={width} height={14} />
                <Skeleton width="50%" height={10} />
              </div>
              <div className="recent-review-model">
                <Skeleton width="80%" height={12} />
                <Skeleton width="40%" height={10} />
              </div>
              <div className="recent-review-commit">
                <Skeleton width={60} height={20} />
              </div>
              <div className="recent-review-findings recent-review-skeleton-chips">
                <Skeleton width={72} height={20} />
                <Skeleton width={64} height={20} />
              </div>
              <div className="recent-review-state">
                <Skeleton width={80} height={20} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!pending && recent.error && (
        <CardMessage title="Couldn't load Reviews" onRetry={onRetry}>
          Diffwise couldn't read its saved Reviews. Check that the SQLite database file exists and that Diffwise has
          permission to read it, then try again. Running Reviews are not affected.
        </CardMessage>
      )}
      {!pending && recent.data?.length === 0 && (
        <CardMessage title="No Reviews yet">
          Each Review you run appears here with its Pull Request, the Model that ran it, the head commit and its Findings.
          Paste a Pull Request URL above, or open the fixture Repository, to start one.
        </CardMessage>
      )}
      {!pending && recent.data && recent.data.length > 0 && (
        <ul aria-labelledby="recent-reviews">
          {recent.data.map((review) => (
            <RecentReviewRow key={review.id} review={review} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentReviewsHead() {
  return (
    <div className="recent-review recent-review-head caption" aria-hidden="true">
      <span className="recent-review-pull-request">Pull Request</span>
      <span className="recent-review-model">Model</span>
      <span className="recent-review-commit">Commit</span>
      <span className="recent-review-findings">Findings</span>
      <span className="recent-review-state">State</span>
    </div>
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

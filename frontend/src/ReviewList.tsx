import { SEVERITIES, type PullRequestRef, type ReviewSummary } from "@diffwise/shared";
import { Notice, ReviewState, Severity, type ReviewStateProps } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { reviewHref } from "./route.ts";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Highest first, as Findings are sorted. */
const SEVERITIES_BY_PRIORITY = [...SEVERITIES].reverse();

/**
 * A Pull Request's Reviews, newest first, each leading to the Review's own page. `headCommit` is the Pull Request's
 * head commit, once it's loaded, which an Outdated Review names.
 */
export function ReviewList({
  pullRequest,
  reviews,
  headCommit,
}: {
  pullRequest: PullRequestRef;
  reviews: ReviewSummary[];
  headCommit?: string;
}) {
  // Each is Outdated or not, unless the Pull Request's head commit couldn't be read when they were listed.
  const unchecked = reviews.some((review) => review.outdated === undefined);

  return (
    <section aria-labelledby="reviews" className="card review-list">
      <div className="card-head">
        <h3 id="reviews">Reviews</h3>
        <span className="caption">Newest first</span>
      </div>
      {unchecked && (
        <Notice role="note" title="Couldn't check for new commits" className="review-list-notice">
          <p>Diffwise couldn't reach GitHub to see whether newer commits were pushed. These Reviews may be Outdated.</p>
        </Notice>
      )}
      {reviews.length === 0 ? (
        <p className="review-list-empty">This Pull Request has no Reviews yet.</p>
      ) : (
        <>
          <div className="review-row review-row-head caption" aria-hidden="true">
            <span>Date</span>
            <span>Model</span>
            <span>Commit</span>
            <span>Findings</span>
            <span>State</span>
          </div>
          <ul aria-labelledby="reviews">
            {reviews.map((review) => (
              <li key={review.id} className="review-row">
                <a href={reviewHref(pullRequest, review.id)}>
                  <time dateTime={review.createdAt}>{DATE_FORMAT.format(new Date(review.createdAt))}</time>
                </a>
                <div className="review-row-model">
                  <code>{review.model}</code>
                  <span className="caption">{review.modelProvider}</span>
                </div>
                <div>
                  <HeadCommit commit={review.headCommit} />
                </div>
                <SeverityCounts counts={review.severityCounts} />
                <div className="review-row-state">
                  <ReviewState state={reviewState(review)} />
                  <ReviewNote review={review} headCommit={headCommit} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The state a Review's badge shows: a complete Review that's Outdated shows that instead. */
export function reviewState(review: ReviewSummary): ReviewStateProps["state"] {
  return review.outdated && review.status === "complete" ? "outdated" : review.status;
}

/** How many Findings of each Severity a Review reports, highest first, leaving out the Severities it has none of. */
export function SeverityCounts({ counts }: { counts: ReviewSummary["severityCounts"] }) {
  const reported = SEVERITIES_BY_PRIORITY.filter((severity) => counts[severity] > 0);
  return (
    <div className="review-row-findings">
      {reported.length === 0 ? (
        <span className="caption">No Findings</span>
      ) : (
        reported.map((severity) => <Severity key={severity} severity={severity} count={counts[severity]} />)
      )}
    </div>
  );
}

/** What a Review's state means for it: how far it's got and that it's lost on a restart, or what the head commit now is. */
function ReviewNote({ review, headCommit }: { review: ReviewSummary; headCommit?: string }) {
  // Running and Unsaved Reviews aren't saved yet.
  if (review.status !== "complete") {
    const { progress } = review;
    return (
      <span className="caption">
        {review.status === "running" && progress && `${progress.settled} of ${progress.total} files. `}Lost if Diffwise
        restarts.
      </span>
    );
  }
  if (review.outdated && headCommit) {
    return (
      <span className="caption">
        Head is now <HeadCommit commit={headCommit} />
      </span>
    );
  }
  return null;
}

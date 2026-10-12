import type { PullRequestRef, ReviewSummary } from "@diffwise/shared";
import { Badge } from "./design-system/index.ts";
import { KINDS_BY_PRIORITY, kindLabel } from "./findings.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { reviewHref } from "./route.ts";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A Pull Request's Reviews, newest first, each leading to the Review's own page. */
export function ReviewList({ pullRequest, reviews }: { pullRequest: PullRequestRef; reviews: ReviewSummary[] }) {
  return (
    <section aria-labelledby="reviews">
      <h2 id="reviews">Reviews</h2>
      {reviews.length === 0 ? (
        <p>This Pull Request has no Reviews yet.</p>
      ) : (
        <ul aria-labelledby="reviews" className="rows">
          {reviews.map((review) => (
            <li key={review.id}>
              <div className="row-head">
                <a href={reviewHref(pullRequest, review.id)}>
                  {review.model} via {review.modelProvider}
                </a>
                {review.status === "running" && <Badge tone="outline">Running</Badge>}
                {review.status === "unsaved" && <Badge>Unsaved</Badge>}
                {review.outdated && <Badge>Outdated</Badge>}
              </div>
              <div className="caption">
                at <HeadCommit commit={review.headCommit} />,{" "}
                <time dateTime={review.createdAt}>{DATE_FORMAT.format(new Date(review.createdAt))}</time>
                {" · "}
                {findingCounts(review.findingCounts)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function findingCounts(counts: ReviewSummary["findingCounts"]): string {
  const parts = KINDS_BY_PRIORITY.flatMap((kind) => {
    const count = counts[kind];
    return count > 0 ? [`${count} ${kindLabel(kind, count)}`] : [];
  });
  return parts.length > 0 ? parts.join(", ") : "No Findings";
}

import { useState } from "react";
import { isOutdated, type PullRequestDetail, type PullRequestRef, type Review } from "@diffwise/shared";
import { getPullRequest, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { ReviewState } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { ReviewView, type OutdatedCheck } from "./ReviewView.tsx";
import { navigate, pullRequestHref, repositoryHref, reviewHref } from "./route.ts";
import { useFollowedReview } from "./useFollowedReview.ts";
import { useLoaded, type Reloaded } from "./useLoaded.ts";

/** A Review's own page: the Pull Request it's of, the Model and commit it reviewed, and the Review as it stands, followed live while it runs. */
export function ReviewPage({ pullRequest, reviewId }: { pullRequest: PullRequestRef; reviewId: string }) {
  // Loaded again when another Review is opened, which a Review just started is: it may be of a newer head commit.
  const detail = useLoaded(() => getPullRequest(pullRequest), [reviewId]);
  const followed = useFollowedReview(reviewId);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  const review = followed.review;
  const { owner, repo, number } = pullRequest;
  const outdated = review ? outdatedCheck(review, detail) : "checking";
  const name = detail.data?.title ?? `${owner}/${repo}#${number}`;
  const current = `Review of ${review ? review.headCommit.slice(0, 7) : "…"}`;
  // Why a Review couldn't be started comes first: it answers what the user just did.
  const error = startError ?? followed.error ?? detail.error;

  async function reviewLatest(review: Review) {
    setStarting(true);
    setStartError(undefined);
    try {
      const { id } = await startReview(pullRequest, review);
      navigate(reviewHref(pullRequest, id));
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-label={current} className="review-page">
      <Breadcrumb
        above={[
          { label: `${owner}/${repo}`, href: repositoryHref(pullRequest) },
          { label: `#${number} ${detail.data?.title ?? ""}`.trim(), href: pullRequestHref(pullRequest) },
        ]}
        current={current}
      />
      <div className="card review-head">
        <div className="review-title">
          <div>
            <h2>{name}</h2>
            <p className="caption">
              {owner}/{repo} #{number}
            </p>
          </div>
          <a className="dw-btn dw-btn-secondary dw-btn-md" href={`https://github.com/${owner}/${repo}/pull/${number}`}>
            Open on GitHub
          </a>
        </div>
        {review && (
          <dl className="review-details">
            <div>
              <dt>Author</dt>
              <dd>{detail.data?.author ?? "…"}</dd>
            </div>
            <div>
              <dt>Reviewed commit</dt>
              <dd>
                <HeadCommit commit={review.headCommit} />
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                <code>{review.model}</code> on {review.modelProvider}
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>
                <ReviewState state={outdated === "outdated" && review.status === "complete" ? "outdated" : review.status} />
              </dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>
                {review.findings.length}
                {review.status === "running" && " so far"}
              </dd>
            </div>
          </dl>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {review && (
        <ReviewView
          review={review}
          outdated={outdated}
          onReviewLatest={starting || review.status === "running" ? undefined : () => reviewLatest(review)}
        />
      )}
    </section>
  );
}

/**
 * Whether the opened Review is Outdated, told from the Pull Request as it was loaded when the Review was opened.
 */
function outdatedCheck(review: Review, detail: Reloaded<PullRequestDetail>): OutdatedCheck {
  // What's kept from before the Review was opened may be of an earlier head commit than the Review's own.
  if (detail.reloading) return "checking";
  if (detail.error) return "unchecked";
  if (!detail.data) return "checking";
  return isOutdated(review, detail.data) ? "outdated" : "not-outdated";
}

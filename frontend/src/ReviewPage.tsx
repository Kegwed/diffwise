import { useState } from "react";
import { isOutdated, type PullRequestDetail, type PullRequestRef, type Review } from "@diffwise/shared";
import { getPullRequest, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { ReviewProgress } from "./ReviewProgress.tsx";
import { Button, Notice, ReviewState } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { githubHref, navigate, pullRequestHref, repositoryHref, reviewHref } from "./route.ts";
import { useFollowedReview } from "./useFollowedReview.ts";
import { useLoaded, type Reloaded } from "./useLoaded.ts";

/**
 * Whether the Pull Request's head commit has moved on since a Review ran: not known while the Pull Request is
 * still loading ("checking"), and never once it couldn't be loaded ("unchecked").
 */
type OutdatedCheck = "checking" | "outdated" | "not-outdated" | "unchecked";

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
    <section aria-label={current} className="page">
      <Breadcrumb
        above={[
          { label: `${owner}/${repo}`, href: repositoryHref(pullRequest) },
          { label: `#${number} ${detail.data?.title ?? ""}`.trim(), href: pullRequestHref(pullRequest) },
        ]}
        current={current}
      />
      <div className="card head-card">
        <div className="head-title">
          <div>
            <h2>{name}</h2>
            <p className="caption">
              {owner}/{repo} #{number}
              {detail.data && ` · ${detail.data.headBranch} into ${detail.data.baseBranch}`}
            </p>
          </div>
          <a className="dw-btn dw-btn-secondary dw-btn-md" href={githubHref(pullRequest)}>
            Open on GitHub
          </a>
        </div>
        {review && (
          <dl className="head-details">
            <div>
              <dt>Author</dt>
              <dd>{detail.data?.author ?? "…"}</dd>
            </div>
            <div>
              <dt>Reviewed commit</dt>
              <dd>
                <HeadCommit commit={review.headCommit} />
                {outdated === "outdated" && detail.data && (
                  <span className="caption">
                    {" "}
                    Latest on GitHub: <HeadCommit commit={detail.data.headCommit} />
                  </span>
                )}
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
        {review && (
          <ReviewNotices
            review={review}
            outdated={outdated}
            onReviewLatest={starting || review.status === "running" ? undefined : () => reviewLatest(review)}
          />
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {review && <ReviewView review={review} />}
    </section>
  );
}

/** What the page has to say about the Review as it stands: that it's running, Unsaved, Outdated or not fully covered. */
function ReviewNotices({
  review,
  outdated,
  onReviewLatest,
}: {
  review: Review;
  outdated: OutdatedCheck;
  /** Starts a Review of the latest commit with this Review's Model; none while one can't be started. */
  onReviewLatest?: () => void;
}) {
  // Skipped files are never sent to the Model, so they're neither done nor left to do.
  const toReview = review.fileOutcomes.filter((outcome) => outcome.outcome !== "skipped").length;
  const total = toReview + review.pendingFiles.length;
  const failed = review.fileOutcomes.filter((outcome) => outcome.outcome === "failed").length;
  const skipped = review.fileOutcomes.length - toReview;
  const reviewed = toReview - failed;

  return (
    <div className="review-notices">
      {review.status === "running" && (
        <Notice role="status" title={`Reviewing: ${toReview} of ${total} files`}>
          <ReviewProgress settled={toReview} total={total} />
          <p>Findings appear as each file finishes. If Diffwise restarts, this Review is lost.</p>
        </Notice>
      )}
      {review.status === "unsaved" && (
        <Notice role="note" title="Unsaved">
          <p>This Review has finished but isn't saved. If Diffwise restarts, it is lost.</p>
        </Notice>
      )}
      {outdated === "outdated" && (
        <Notice
          role="note"
          title="Outdated"
          action={
            <Button variant="primary" onClick={onReviewLatest} disabled={!onReviewLatest}>
              Review the latest commit
            </Button>
          }
        >
          <p>
            New commits were pushed after {review.headCommit.slice(0, 7)}, so these Findings may not apply to the latest
            commit. A Review of it runs with the same Model, {review.model} on {review.modelProvider}.
          </p>
        </Notice>
      )}
      {outdated === "unchecked" && (
        <Notice role="note" title="Couldn't check for new commits">
          <p>
            Diffwise couldn't check whether new commits were pushed to this Pull Request since this Review ran, so it may
            be Outdated.
          </p>
        </Notice>
      )}
      {review.status !== "running" && (failed > 0 || skipped > 0) && (
        <Notice role="note" title="Incomplete coverage">
          <p>
            {[
              failed > 0 && `${count(failed, "file")} failed`,
              skipped > 0 && `${count(skipped, "file")} ${skipped === 1 ? "was" : "were"} skipped`,
            ]
              .filter(Boolean)
              .join(" and ")}
            , so these Findings cover {reviewed} of {review.fileOutcomes.length} changed files.
          </p>
        </Notice>
      )}
    </div>
  );
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
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

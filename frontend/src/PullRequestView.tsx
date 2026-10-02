import { useReducer, useState } from "react";
import { isOutdated, type ModelChoice, type PullRequestDetail, type PullRequestRef, type Review } from "@diffwise/shared";
import { getPullRequest, listModels, listReviews, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Button } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewList } from "./ReviewList.tsx";
import { ReviewView, type OutdatedCheck } from "./ReviewView.tsx";
import { navigate, REPOSITORIES_HREF, repositoryHref, reviewHref } from "./route.ts";
import { useCompletions } from "./useCompletions.ts";
import { useFollowedReview } from "./useFollowedReview.ts";
import { useLoaded, type Reloaded } from "./useLoaded.ts";

/**
 * A Pull Request's detail view: what's about to be reviewed, the Model to review it with, and then the Review
 * `reviewId` names, followed live while it runs.
 */
export function PullRequestView({ pullRequest, reviewId }: { pullRequest: PullRequestRef; reviewId?: string }) {
  // Loaded again when another Review is opened, which a Review just started is: it may be of a newer head commit.
  const detail = useLoaded(() => getPullRequest(pullRequest), [reviewId]);
  const modelListings = useLoaded(listModels);
  const [chosenModel, setChosenModel] = useState<ModelChoice>();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const followed = useFollowedReview(reviewId);
  const [relistings, relist] = useReducer((count: number) => count + 1, 0);
  // Listed again when another Review is opened, and when a running one completes: the one followed, or any other.
  const reviews = useLoaded(() => listReviews(pullRequest), [reviewId, followed.completedWhileFollowed, relistings]);
  const runningUnfollowed = (reviews.data ?? []).filter((review) => review.status === "running" && review.id !== reviewId);
  useCompletions(runningUnfollowed.map((review) => review.id), relist);

  const opened = followed.review;
  const repository = `${pullRequest.owner}/${pullRequest.repo}`;
  const name = `${repository}#${pullRequest.number}`;
  const modelChoice = chosenModel ?? (modelListings.data && firstModel(modelListings.data));
  // Why a Review couldn't be started comes first: it answers what the user just did.
  const error = startError ?? detail.error ?? modelListings.error ?? reviews.error ?? followed.error;
  // A Review that was asked for and isn't known to be complete (or lost) is taken to be running.
  const reviewing = starting || (reviewId !== undefined && !followed.error && followed.review?.status !== "complete");

  async function start(modelChoice: ModelChoice) {
    setStarting(true);
    setStartError(undefined);
    try {
      const { id } = await startReview(pullRequest, modelChoice);
      navigate(reviewHref(pullRequest, id));
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <section aria-labelledby="pull-request">
        <Breadcrumb
          above={[
            { label: "Repositories", href: REPOSITORIES_HREF },
            { label: repository, href: repositoryHref(pullRequest) },
          ]}
          current={`#${pullRequest.number}`}
        />
        <h2 id="pull-request">{detail.data?.title ?? name}</h2>
        {!detail.data && !detail.error && <p>Loading…</p>}
        {detail.data && (
          <>
            <p className="caption">
              {name} by {detail.data.author} at <HeadCommit commit={detail.data.headCommit} />
            </p>
            <h3 id="changed-files" className="changed-files-heading">Changed files ({detail.data.changedFiles.length})</h3>
            <ul aria-labelledby="changed-files" className="changed-files panel-sunken">
              {detail.data.changedFiles.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
            {modelListings.data && <ModelPicker listings={modelListings.data} choice={modelChoice} onChoose={setChosenModel} />}
            <Button variant="primary" onClick={() => modelChoice && start(modelChoice)} disabled={reviewing || !modelChoice}>
              {reviewing ? "Reviewing…" : "Review"}
            </Button>
          </>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      {reviews.data && <ReviewList pullRequest={pullRequest} reviews={reviews.data} openId={reviewId} />}
      {opened && (
        <ReviewView
          review={opened}
          outdated={outdatedCheck(opened, detail)}
          onReviewLatest={reviewing ? undefined : () => start(opened)}
        />
      )}
    </>
  );
}

/**
 * Whether the opened Review is Outdated, told from the Pull Request as it was loaded when the Review was opened: its
 * list of Reviews plays no part.
 */
function outdatedCheck(review: Review, detail: Reloaded<PullRequestDetail>): OutdatedCheck {
  // What's kept from before the Review was opened may be of an earlier head commit than the Review's own.
  if (detail.reloading) return "checking";
  if (detail.error) return "unchecked";
  if (!detail.data) return "checking";
  return isOutdated(review, detail.data) ? "outdated" : "not-outdated";
}

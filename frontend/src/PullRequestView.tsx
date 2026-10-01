import { useState } from "react";
import type { ModelChoice, PullRequestRef } from "@diffwise/shared";
import { getPullRequest, listModels, listReviews, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Button } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewList } from "./ReviewList.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { navigate, REPOSITORIES_HREF, repositoryHref, reviewHref } from "./route.ts";
import { useFollowedReview } from "./useFollowedReview.ts";
import { useLoaded } from "./useLoaded.ts";

/**
 * A Pull Request's detail view: what's about to be reviewed, the Model to review it with, and then the Review
 * `reviewId` names, followed live while it runs.
 */
export function PullRequestView({ pullRequest, reviewId }: { pullRequest: PullRequestRef; reviewId?: string }) {
  const detail = useLoaded(() => getPullRequest(pullRequest));
  const modelListings = useLoaded(listModels);
  const [chosenModel, setChosenModel] = useState<ModelChoice>();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const followed = useFollowedReview(reviewId);
  // Listed again when another Review is opened, which a Review just started is, and when the one followed completes.
  const reviews = useLoaded(() => listReviews(pullRequest), [reviewId, followed.completedWhileFollowed]);

  const repository = `${pullRequest.owner}/${pullRequest.repo}`;
  const name = `${repository}#${pullRequest.number}`;
  const modelChoice = chosenModel ?? (modelListings.data && firstModel(modelListings.data));
  const error = detail.error ?? modelListings.error ?? reviews.error ?? startError ?? followed.error;
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
      {followed.review && (
        <ReviewView
          review={followed.review}
          outdated={reviews.data?.find((review) => review.id === reviewId)?.outdated}
          onReviewLatest={reviewing ? undefined : () => start(followed.review!)}
        />
      )}
    </>
  );
}

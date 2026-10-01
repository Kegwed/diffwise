import { useState } from "react";
import type { ModelChoice, PullRequestRef, Review } from "@diffwise/shared";
import { getPullRequest, listModels, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Button } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { REPOSITORIES_HREF, repositoryHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** A Pull Request's detail view: what's about to be reviewed, the Model to review it with, and then its Review. */
export function PullRequestView({ pullRequest }: { pullRequest: PullRequestRef }) {
  const detail = useLoaded(() => getPullRequest(pullRequest));
  const modelListings = useLoaded(listModels);
  const [chosenModel, setChosenModel] = useState<ModelChoice>();
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<Review>();
  const [reviewError, setReviewError] = useState<string>();

  const repository = `${pullRequest.owner}/${pullRequest.repo}`;
  const name = `${repository}#${pullRequest.number}`;
  const modelChoice = chosenModel ?? (modelListings.data && firstModel(modelListings.data));
  const error = detail.error ?? modelListings.error ?? reviewError;

  async function runReview(modelChoice: ModelChoice) {
    setReviewing(true);
    setReview(undefined);
    setReviewError(undefined);
    try {
      setReview(await startReview(pullRequest, modelChoice));
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setReviewing(false);
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
            <Button variant="primary" onClick={() => modelChoice && runReview(modelChoice)} disabled={reviewing || !modelChoice}>
              {reviewing ? "Reviewing…" : "Review"}
            </Button>
          </>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      {review && <ReviewView review={review} />}
    </>
  );
}

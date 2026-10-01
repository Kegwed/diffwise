import { useState } from "react";
import type { ModelChoice, PullRequestRef, Review } from "@diffwise/shared";
import { getPullRequest, listModels, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Button } from "./design-system/index.ts";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { REPOSITORIES_HREF, repositoryHref } from "./route.ts";
import { useLoaded } from "./useLoaded.ts";

/** A Pull Request's detail view: what's about to be reviewed, the Model to review it with, and then its Review. */
export function PullRequest({ pullRequest: ref }: { pullRequest: PullRequestRef }) {
  const pullRequest = useLoaded(() => getPullRequest(ref));
  const modelListings = useLoaded(listModels);
  const [chosenModel, setChosenModel] = useState<ModelChoice>();
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<Review>();
  const [reviewError, setReviewError] = useState<string>();

  const name = `${ref.owner}/${ref.repo}#${ref.number}`;
  const modelChoice = chosenModel ?? (modelListings.data && firstModel(modelListings.data));
  const error = pullRequest.error ?? modelListings.error ?? reviewError;

  async function runReview(modelChoice: ModelChoice) {
    setReviewing(true);
    setReview(undefined);
    setReviewError(undefined);
    try {
      setReview(await startReview(ref, modelChoice));
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
            { label: `${ref.owner}/${ref.repo}`, href: repositoryHref(ref) },
          ]}
          current={`#${ref.number}`}
        />
        <h2 id="pull-request">{pullRequest.data?.title ?? name}</h2>
        {!pullRequest.data && !pullRequest.error && <p>Loading…</p>}
        {pullRequest.data && (
          <>
            <p className="caption">
              {name} by {pullRequest.data.author} at{" "}
              <code title={pullRequest.data.headCommit}>{pullRequest.data.headCommit.slice(0, 7)}</code>
            </p>
            <h3 id="changed-files" className="changed-files-heading">Changed files ({pullRequest.data.changedFiles.length})</h3>
            <ul aria-labelledby="changed-files" className="changed-files panel-sunken">
              {pullRequest.data.changedFiles.map((file) => (
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

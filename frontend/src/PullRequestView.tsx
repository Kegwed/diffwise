import { useReducer, useState } from "react";
import type { ModelChoice, PullRequestRef } from "@diffwise/shared";
import { getPullRequest, listModels, listReviews, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Button } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewList } from "./ReviewList.tsx";
import { navigate, REPOSITORIES_HREF, repositoryHref, reviewHref } from "./route.ts";
import { useCompletions } from "./useCompletions.ts";
import { useLoaded } from "./useLoaded.ts";

/** A Pull Request's detail view: what's about to be reviewed, the Model to review it with, and its Reviews. */
export function PullRequestView({ pullRequest }: { pullRequest: PullRequestRef }) {
  const detail = useLoaded(() => getPullRequest(pullRequest));
  const modelListings = useLoaded(listModels);
  const [chosenModel, setChosenModel] = useState<ModelChoice>();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [relistings, relist] = useReducer((count: number) => count + 1, 0);
  // Listed again when a running one completes.
  const reviews = useLoaded(() => listReviews(pullRequest), [relistings]);
  const running = (reviews.data ?? []).filter((review) => review.status === "running");
  useCompletions(running.map((review) => review.id), relist);

  const repository = `${pullRequest.owner}/${pullRequest.repo}`;
  const name = `${repository}#${pullRequest.number}`;
  const modelChoice = chosenModel ?? (modelListings.data && firstModel(modelListings.data));
  // Why a Review couldn't be started comes first: it answers what the user just did.
  const error = startError ?? detail.error ?? modelListings.error ?? reviews.error;

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
            <Button variant="primary" onClick={() => modelChoice && start(modelChoice)} disabled={starting || !modelChoice}>
              {starting ? "Starting…" : "Review"}
            </Button>
          </>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      {reviews.data && <ReviewList pullRequest={pullRequest} reviews={reviews.data} />}
    </>
  );
}

import { useReducer, useState } from "react";
import type { ModelChoice, PullRequestDetail, PullRequestRef } from "@diffwise/shared";
import { getPullRequest, listModels, listReviews, startReview } from "./api.ts";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { Badge, Button } from "./design-system/index.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";
import { ReviewList } from "./ReviewList.tsx";
import { githubHref, navigate, repositoryHref, reviewHref } from "./route.ts";
import { useCompletions } from "./useCompletions.ts";
import { useLoaded } from "./useLoaded.ts";

const STATE_LABELS: Record<PullRequestDetail["state"], string> = { open: "Open", closed: "Closed", merged: "Merged" };

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

  const { owner, repo, number } = pullRequest;
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
    <section aria-labelledby="pull-request" className="page">
      <Breadcrumb above={[{ label: `${owner}/${repo}`, href: repositoryHref(pullRequest) }]} current={`#${number}`} />
      <div className="card head-card">
        <div className="head-title">
          <div>
            <h2 id="pull-request">{detail.data?.title ?? `${owner}/${repo}#${number}`}</h2>
            {detail.data && (
              <p className="caption">
                {owner}/{repo} #{number} · {detail.data.headBranch} into {detail.data.baseBranch}
              </p>
            )}
          </div>
          <a className="dw-btn dw-btn-secondary dw-btn-md" href={githubHref(pullRequest)}>
            Open on GitHub
          </a>
        </div>
        {!detail.data && !detail.error && <p>Loading…</p>}
        {detail.data && (
          <dl className="head-details">
            <div>
              <dt>Author</dt>
              <dd>{detail.data.author}</dd>
            </div>
            <div>
              <dt>Head commit</dt>
              <dd>
                <HeadCommit commit={detail.data.headCommit} />
              </dd>
            </div>
            <div>
              <dt>Changed files</dt>
              <dd>{files(detail.data.changedFiles.length)}</dd>
            </div>
            <div>
              <dt>Pull Request</dt>
              <dd>
                <Badge>{STATE_LABELS[detail.data.state]}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {detail.data && (
        <div className="pull-request-columns">
          <section aria-labelledby="changed-files" className="card changed-files">
            <div className="card-head">
              <h3 id="changed-files">Changed files</h3>
              <span className="caption">{files(detail.data.changedFiles.length)}</span>
            </div>
            <ul aria-labelledby="changed-files">
              {detail.data.changedFiles.map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code>
                  <span className="caption">{file.binary ? "Binary" : `+${file.additions} −${file.deletions}`}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="start-review" className="card start-review">
            <div>
              <h3 id="start-review">Start a Review</h3>
              <p className="caption">
                Reviews head commit <HeadCommit commit={detail.data.headCommit} />. You choose the Model for each Review.
              </p>
            </div>
            {modelListings.data && <ModelPicker listings={modelListings.data} choice={modelChoice} onChoose={setChosenModel} />}
            <Button variant="primary" onClick={() => modelChoice && start(modelChoice)} disabled={starting || !modelChoice}>
              {starting ? "Starting…" : "Review"}
            </Button>
            <p className="caption">A restart while a Review is running loses it.</p>
          </section>
        </div>
      )}
      {reviews.data && <ReviewList pullRequest={pullRequest} reviews={reviews.data} headCommit={detail.data?.headCommit} />}
    </section>
  );
}

function files(count: number) {
  return `${count} file${count === 1 ? "" : "s"}`;
}

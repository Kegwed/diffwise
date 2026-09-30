import { useEffect, useState } from "react";
import type { ModelChoice, ModelProviderListing, PullRequestSummary, Review } from "@diffwise/shared";
import { listModels, listPullRequests, startReview } from "./api.ts";
import { Button } from "./design-system/index.ts";
import { FindingsList } from "./FindingsList.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";

export function App() {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>();
  const [modelListings, setModelListings] = useState<ModelProviderListing[]>();
  const [modelChoice, setModelChoice] = useState<ModelChoice>();
  const [reviewing, setReviewing] = useState<PullRequestSummary>();
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listPullRequests()
      .then(setPullRequests)
      .catch((e: Error) => setError(e.message));
    listModels()
      .then((listings) => {
        setModelListings(listings);
        setModelChoice(firstModel(listings));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function reviewPullRequest(pr: PullRequestSummary, modelChoice: ModelChoice) {
    setReviewing(pr);
    setReview(undefined);
    setError(undefined);
    try {
      setReview(await startReview({ owner: pr.owner, repo: pr.repo, number: pr.number }, modelChoice));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(undefined);
    }
  }

  return (
    <main>
      <h1>Diffwise</h1>
      <section aria-labelledby="pull-requests">
        <h2 id="pull-requests">Pull Requests</h2>
        {modelListings && <ModelPicker listings={modelListings} choice={modelChoice} onChoose={setModelChoice} />}
        {!pullRequests && !error && <p>Loading…</p>}
        <ul className="pull-requests">
          {pullRequests?.map((pr) => (
            <li key={`${pr.owner}/${pr.repo}#${pr.number}`}>
              <div>
                <strong>{pr.title}</strong>
                <div className="caption">
                  {pr.owner}/{pr.repo}#{pr.number} by {pr.author} at <code>{pr.headCommit.slice(0, 7)}</code>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => modelChoice && reviewPullRequest(pr, modelChoice)}
                disabled={reviewing !== undefined || modelChoice === undefined}
              >
                {reviewing === pr ? "Reviewing…" : "Run review"}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert">{error}</p>}
      {review && <FindingsList review={review} />}
    </main>
  );
}

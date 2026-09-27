import { useEffect, useState } from "react";
import type { PullRequestSummary, Review } from "@diffwise/shared";
import { listPullRequests, startReview } from "./api.ts";
import { FindingsList } from "./FindingsList.tsx";

export function App() {
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>();
  const [reviewing, setReviewing] = useState<PullRequestSummary>();
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    listPullRequests()
      .then(setPullRequests)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function reviewPullRequest(pr: PullRequestSummary) {
    setReviewing(pr);
    setReview(undefined);
    setError(undefined);
    try {
      setReview(await startReview({ owner: pr.owner, repo: pr.repo, number: pr.number }));
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
        {!pullRequests && !error && <p>Loading…</p>}
        <ul className="pull-requests">
          {pullRequests?.map((pr) => (
            <li key={`${pr.owner}/${pr.repo}#${pr.number}`}>
              <div>
                <strong>{pr.title}</strong>
                <div className="meta">
                  {pr.owner}/{pr.repo}#{pr.number} by {pr.author} at <code>{pr.headCommit.slice(0, 7)}</code>
                </div>
              </div>
              <button type="button" onClick={() => reviewPullRequest(pr)} disabled={reviewing !== undefined}>
                {reviewing === pr ? "Reviewing…" : "Review"}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert">{error}</p>}
      {review && <FindingsList review={review} />}
    </main>
  );
}

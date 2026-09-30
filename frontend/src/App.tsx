import { useEffect, useState, type FormEvent } from "react";
import type { GitHubAppStatus, ModelChoice, ModelProviderListing, PullRequestSummary, Review } from "@diffwise/shared";
import { findPullRequestByUrl, getGitHubApp, listModels, listPullRequests, startReview } from "./api.ts";
import { Button } from "./design-system/index.ts";
import { GitHubConnection } from "./GitHubConnection.tsx";
import { ReviewView } from "./ReviewView.tsx";
import { firstModel, ModelPicker } from "./ModelPicker.tsx";

export function App() {
  const [githubApp, setGitHubApp] = useState<GitHubAppStatus>();
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>();
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [modelListings, setModelListings] = useState<ModelProviderListing[]>();
  const [modelChoice, setModelChoice] = useState<ModelChoice>();
  /** The Pull Request being reviewed, or "url" while a pasted URL is being looked up and reviewed. */
  const [reviewing, setReviewing] = useState<PullRequestSummary | "url">();
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getGitHubApp()
      .then(setGitHubApp)
      .catch((e: Error) => setError(e.message));
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

  /** Reviews the Pull Request `find` settles on, showing `reviewing` as under review meanwhile. */
  async function reviewPullRequest(
    reviewing: PullRequestSummary | "url",
    find: () => Promise<PullRequestSummary>,
    modelChoice: ModelChoice,
  ) {
    setReviewing(reviewing);
    setReview(undefined);
    setError(undefined);
    try {
      const pr = await find();
      setReview(await startReview({ owner: pr.owner, repo: pr.repo, number: pr.number }, modelChoice));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(undefined);
    }
  }

  function reviewPullRequestUrl(event: FormEvent) {
    event.preventDefault();
    if (modelChoice) reviewPullRequest("url", () => findPullRequestByUrl(pullRequestUrl), modelChoice);
  }

  const cannotReview = reviewing !== undefined || modelChoice === undefined;

  return (
    <main>
      <h1>Diffwise</h1>
      {githubApp && <GitHubConnection status={githubApp} />}
      <section aria-labelledby="pull-requests">
        <h2 id="pull-requests">Pull Requests</h2>
        {modelListings && <ModelPicker listings={modelListings} choice={modelChoice} onChoose={setModelChoice} />}
        <form className="pull-request-url" onSubmit={reviewPullRequestUrl}>
          <label>
            Pull Request URL{" "}
            <input
              type="text"
              value={pullRequestUrl}
              onChange={(e) => setPullRequestUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              spellCheck={false}
            />
          </label>
          <Button type="submit" size="sm" disabled={cannotReview || pullRequestUrl.trim() === ""}>
            {reviewing === "url" ? "Reviewing…" : "Review"}
          </Button>
        </form>
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
                onClick={() => modelChoice && reviewPullRequest(pr, async () => pr, modelChoice)}
                disabled={cannotReview}
              >
                {reviewing === pr ? "Reviewing…" : "Run review"}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {error && <p role="alert">{error}</p>}
      {review && <ReviewView review={review} />}
    </main>
  );
}

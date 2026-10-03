import type { ModelChoice, PullRequestRef, Review, ReviewEvent } from "@diffwise/shared";
import type { Reviews } from "../src/reviews.ts";

/** Starts a Review, failing the test if it doesn't start; resolves with the Review as it stands once started. */
export async function startReview(
  reviews: Reviews,
  pr: PullRequestRef,
  { modelProvider = "Ollama", model = "test-model" }: Partial<ModelChoice> = {},
): Promise<Review> {
  const outcome = await reviews.start(pr, { modelProvider, model });
  if (!outcome.started) throw new Error(`The Review didn't start: no ${outcome.missing}`);
  return outcome.review;
}

/** Starts a Review and follows its progress to the end, as the page does; resolves with the complete Review. */
export async function completedReview(reviews: Reviews, pr: PullRequestRef, choice?: Partial<ModelChoice>): Promise<Review> {
  const { id } = await startReview(reviews, pr, choice);
  await followReview(reviews, id).rest();
  return reviews.get(id)!;
}

/** Follows a Review's progress, to read its events one at a time. */
export function followReview(reviews: Reviews, id: string) {
  const follower = new AbortController();
  const events = reviews.follow(id, follower.signal);
  if (!events) throw new Error(`No Review ${id} to follow`);
  const iterator = (async function* () {
    yield* events;
  })();

  /** The next event, or undefined once the Review's progress has ended. */
  async function next(): Promise<ReviewEvent | undefined> {
    return (await iterator.next()).value ?? undefined;
  }

  /** Every event from here until the Review's progress ends. */
  async function rest(): Promise<ReviewEvent[]> {
    const remaining: ReviewEvent[] = [];
    for (let event = await next(); event; event = await next()) remaining.push(event);
    return remaining;
  }

  return { next, rest, disconnect: () => follower.abort() };
}

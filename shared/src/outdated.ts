/** Whether a Review is Outdated: its head commit is no longer the Pull Request's head commit. */
export function isOutdated(review: { headCommit: string }, pullRequest: { headCommit: string }): boolean {
  return review.headCommit !== pullRequest.headCommit;
}

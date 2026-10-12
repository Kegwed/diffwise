import type { FileOutcome, Finding, Review } from "./index.ts";

/**
 * What a Review's progress stream sends: first the Review as it stands, then each change to it as it happens,
 * ending when the Review completes, or turns out Unsaved.
 */
export type ReviewEvent =
  | { type: "review"; review: Review }
  /** A queued file has gone to the Model. */
  | { type: "file-reviewing"; file: string }
  /** A file has its File Outcome, with the Findings the Review reports in it. */
  | { type: "file-settled"; fileOutcome: FileOutcome; findings: Finding[] }
  | { type: "complete" }
  /** Every changed file has its File Outcome, but the Review couldn't be saved. */
  | { type: "unsaved" };

/** Whether the event is the last of a Review's progress: the Review has completed, or turned out Unsaved. */
export function endsProgress(event: ReviewEvent): boolean {
  return event.type === "complete" || event.type === "unsaved";
}

/** The Review as it stands after one of its progress events. */
export function applyReviewEvent(review: Review, event: ReviewEvent): Review {
  switch (event.type) {
    case "review":
      return event.review;
    case "file-reviewing":
      return {
        ...review,
        pendingFiles: review.pendingFiles.map((pending) =>
          pending.file === event.file ? { ...pending, state: "reviewing" } : pending,
        ),
      };
    case "file-settled":
      return {
        ...review,
        pendingFiles: review.pendingFiles.filter((pending) => pending.file !== event.fileOutcome.file),
        fileOutcomes: [...review.fileOutcomes, event.fileOutcome],
        findings: [...review.findings, ...event.findings],
      };
    case "complete":
      return { ...review, status: "complete" };
    case "unsaved":
      return { ...review, status: "unsaved" };
  }
}

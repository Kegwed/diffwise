import type { FileOutcome, Finding, Review } from "./index.ts";

/**
 * What a Review's progress stream sends: first the Review as it stands, then each change to it as it happens,
 * ending when the Review completes.
 */
export type ReviewEvent =
  | { type: "review"; review: Review }
  /** A queued file has gone to the Model. */
  | { type: "file-reviewing"; file: string }
  /** A file has its File Outcome, with the Findings the Review reports in it. */
  | { type: "file-settled"; fileOutcome: FileOutcome; findings: Finding[] }
  | { type: "complete" };

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
  }
}

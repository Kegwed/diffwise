import { useEffect, useState } from "react";
import { applyReviewEvent, type Review } from "@diffwise/shared";
import { followReview } from "./api.ts";

/** A Review being followed: nothing until its progress stream sends it, then the Review as it stands, or why it can't be followed. */
export interface FollowedReview {
  review?: Review;
  error?: string;
  /** Whether the Review was seen running and has since stopped, so what was loaded about it while it ran is out of date. */
  completedWhileFollowed: boolean;
}

/** Follows the Review with the given id while the view using it is shown, keeping it as it stands until it completes. */
export function useFollowedReview(id: string | undefined): FollowedReview {
  const [followed, setFollowed] = useState<{ id: string; review?: Review; error?: string; seenRunning?: boolean }>();

  useEffect(() => {
    if (id === undefined) return;
    return followReview(
      id,
      (event) =>
        setFollowed((was) => {
          const before = was?.id === id ? was : undefined;
          // The stream's first event is the Review itself, which the later ones then change.
          const review = event.type === "review" ? event.review : before?.review && applyReviewEvent(before.review, event);
          return review ? { id, review, seenRunning: before?.seenRunning || review.status === "running" } : was;
        }),
      (error) => setFollowed((was) => ({ ...(was?.id === id ? was : { id }), error })),
    );
  }, [id]);

  // What was followed before `id` changed isn't this Review.
  if (!followed || followed.id !== id) return { completedWhileFollowed: false };
  const { review, error, seenRunning } = followed;
  return { review, error, completedWhileFollowed: seenRunning === true && review !== undefined && review.status !== "running" };
}

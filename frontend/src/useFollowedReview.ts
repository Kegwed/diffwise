import { useEffect, useState } from "react";
import { applyReviewEvent, type Review } from "@diffwise/shared";
import { followReview } from "./api.ts";

/** A Review being followed: nothing until its progress stream sends it, then the Review as it stands, or why it can't be followed. */
export interface FollowedReview {
  review?: Review;
  error?: string;
}

/** Follows the Review with the given id while the view using it is shown, keeping it as it stands until it completes. */
export function useFollowedReview(id: string | undefined): FollowedReview {
  const [followed, setFollowed] = useState<FollowedReview & { id: string }>();

  useEffect(() => {
    if (id === undefined) return;
    return followReview(
      id,
      (event) =>
        setFollowed((was) => {
          // The stream's first event is the Review itself, which the later ones then change.
          if (event.type === "review") return { id, review: event.review };
          return was?.id === id && was.review ? { id, review: applyReviewEvent(was.review, event) } : was;
        }),
      (error) => setFollowed((was) => ({ id, review: was?.id === id ? was.review : undefined, error })),
    );
  }, [id]);

  // What was followed before `id` changed isn't this Review.
  return followed && followed.id === id ? followed : {};
}

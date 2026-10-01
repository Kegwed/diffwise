import { useEffect } from "react";
import { followReview } from "./api.ts";

/**
 * Follows the running Reviews with the given ids while the view using it is shown, calling `onCompletion` each time
 * one completes or can no longer be followed: what was loaded about it while it ran is then out of date.
 */
export function useCompletions(runningIds: string[], onCompletion: () => void): void {
  useEffect(() => {
    const stops = runningIds.map((id) => followReview(id, (event) => event.type === "complete" && onCompletion(), onCompletion));
    return () => stops.forEach((stop) => stop());
    // Not on every render: `runningIds` is a new array each time.
  }, [runningIds.join(" ")]);
}

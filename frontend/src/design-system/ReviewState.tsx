import type { ReactNode } from "react";
import { cx } from "./cx.ts";

const LABELS = { running: "Running", complete: "Complete", unsaved: "Unsaved", outdated: "Outdated" } as const;

export interface ReviewStateProps {
  /** running: still settling files. complete: settled and saved. unsaved: finished but not saved. outdated: newer commits pushed since. */
  state: keyof typeof LABELS;
  /** Overrides the default label ("Running", "Complete", ...). */
  children?: ReactNode;
  className?: string;
}

/** What state a Review is in, as hue, marker shape and label together, so it reads without colour. */
export function ReviewState({ state, children, className }: ReviewStateProps) {
  return (
    <span className={cx("dw-state", `dw-state-${state}`, className)}>
      <span className="dw-state-mark" aria-hidden="true" />
      {children || LABELS[state]}
    </span>
  );
}

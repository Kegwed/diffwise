import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export interface BadgeProps {
  /** neutral (default) for a Finding's kind and a skipped or failed File Outcome; accent for something selected; outline for Security References, counts and a reviewed File Outcome. */
  tone?: "neutral" | "accent" | "outline";
  className?: string;
  children?: ReactNode;
}

/** A one- or two-word label. Never carries Severity: that's `Severity`'s job. */
export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return <span className={cx("dw-badge", `dw-badge-${tone}`, className)}>{children}</span>;
}

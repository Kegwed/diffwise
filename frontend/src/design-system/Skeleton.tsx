import { cx } from "./cx.ts";

export interface SkeletonProps {
  /** A number is px. Defaults to 100%. */
  width?: number | string;
  /** A number is px. Defaults to 14, a line of label text. */
  height?: number | string;
  className?: string;
}

/** A placeholder shaped like the content it stands in for while that loads. It pulses, unless motion is reduced. */
export function Skeleton({ width = "100%", height = 14, className }: SkeletonProps) {
  return <span className={cx("dw-skel", className)} aria-hidden="true" style={{ width, height }} />;
}

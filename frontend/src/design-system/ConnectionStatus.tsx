import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export interface ConnectionStatusProps {
  /** ok: works. warn: set-up not finished. error: unreachable or rejected. idle: still checking. */
  status: "ok" | "warn" | "error" | "idle";
  /** The text that says the same as the dot, e.g. "GitHub connected". Required: the dot only backs it up. */
  children: ReactNode;
  className?: string;
}

/** Whether Diffwise can reach something it depends on: a status dot beside text that says the same thing. */
export function ConnectionStatus({ status, children, className }: ConnectionStatusProps) {
  return (
    <span className={cx("dw-conn", className)}>
      <span className={cx("dw-conn-dot", `dw-conn-${status}`)} aria-hidden="true" />
      <span className="dw-conn-text">{children}</span>
    </span>
  );
}

import type { ReactNode } from "react";
import { SEVERITIES, type Severity as SeverityLevel } from "@diffwise/shared";
import { cx } from "./cx.ts";

const LABELS: Record<SeverityLevel, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

export interface SeverityProps {
  level: SeverityLevel;
  /** Overrides the default label ("Critical", "High", ...), only to translate it. */
  children?: ReactNode;
  className?: string;
}

/** How serious a Finding is: colour, bar count and label together, so it reads without colour. */
export function Severity({ level, children, className }: SeverityProps) {
  return (
    <span className={cx("dw-sev", `dw-sev-${level}`, className)}>
      <span className="dw-sev-bars" aria-hidden="true">
        {SEVERITIES.map((_, bar) => (
          <span key={bar} className={cx("dw-sev-bar", bar <= SEVERITIES.indexOf(level) && "is-on")} />
        ))}
      </span>
      <span className="dw-sev-label">{children || LABELS[level]}</span>
    </span>
  );
}

import type { ReactNode } from "react";
import type { FindingKind, Severity as SeverityName } from "@diffwise/shared";
import { Badge } from "./Badge.tsx";
import { cx } from "./cx.ts";
import { Severity } from "./Severity.tsx";

const KIND_LABELS: Record<FindingKind, string> = {
  "bad-practice": "Bad Practice",
  "security-issue": "Security Issue",
};

export interface FindingProps {
  kind: FindingKind;
  severity: SeverityName;
  /** Repository-relative path, shown in mono with the lines. */
  file?: string;
  /** A line (3) or a range of lines ("5–6") in the new version of the file. */
  lines?: number | string;
  /** One sentence naming the problem. */
  title: ReactNode;
  /** The title's heading level, one below the heading the Finding sits under. Defaults to 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** The explanation: why it matters and what to do. */
  children?: ReactNode;
  /** Replacement code, shown as-is in a collapsed "Suggested Fix" section. */
  suggestedFix?: string;
  /** A CWE or OWASP identifier; shown only on a Security Issue. */
  securityReference?: string;
  /** Beside a diff: makes the location a button that takes you to the Finding's lines. */
  onShowLines?: () => void;
  /** The Finding last jumped to: its location button is aria-current and the card takes the accent frame. */
  linesShown?: boolean;
  className?: string;
}

/** One problem a Review reports. Read-only, so it has no actions. */
export function Finding({
  kind,
  severity,
  file,
  lines,
  title,
  headingLevel = 3,
  children,
  suggestedFix,
  securityReference,
  onShowLines,
  linesShown,
  className,
}: FindingProps) {
  const Heading = `h${headingLevel}` as const;
  const location = file && (lines !== undefined ? `${file}:${lines}` : file);
  return (
    <article className={cx("dw-finding", linesShown && "is-shown", className)}>
      <header className="dw-finding-head">
        <Severity severity={severity} />
        <Badge>{KIND_LABELS[kind]}</Badge>
        {kind === "security-issue" && securityReference && <Badge tone="outline">{securityReference}</Badge>}
        {location &&
          (onShowLines ? (
            <button
              type="button"
              className="dw-finding-loc dw-finding-loc-btn"
              onClick={onShowLines}
              aria-current={linesShown ? "true" : undefined}
            >
              {location}
            </button>
          ) : (
            <span className="dw-finding-loc">{location}</span>
          ))}
      </header>
      <div className="dw-finding-body">
        <Heading className="dw-finding-title">{title}</Heading>
        {children && <div className="dw-finding-text">{children}</div>}
      </div>
      {suggestedFix && (
        <details className="dw-fix">
          <summary className="dw-fix-summary">Suggested Fix</summary>
          <pre className="dw-code">
            <code>{suggestedFix.replace(/\n$/, "")}</code>
          </pre>
        </details>
      )}
    </article>
  );
}

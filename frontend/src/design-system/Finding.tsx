import type { ReactNode } from "react";
import type { FindingKind, Severity as SeverityLevel } from "@diffwise/shared";
import { Badge } from "./Badge.tsx";
import { cx } from "./cx.ts";
import { Severity } from "./Severity.tsx";

const KIND_LABELS: Record<FindingKind, string> = {
  "bad-practice": "Bad Practice",
  "security-issue": "Security Issue",
};

export interface FindingProps {
  kind: FindingKind;
  severity: SeverityLevel;
  /** Repository-relative path, shown in mono with the lines. */
  file?: string;
  /** A line (3) or a range of lines ("5–6") in the new version of the file. */
  lines?: number | string;
  /** One sentence naming the problem. */
  title: ReactNode;
  /** The explanation: why it matters and what to do. */
  children?: ReactNode;
  /** Replacement code, shown as-is in a collapsed "Suggested Fix" section. */
  suggestedFix?: string;
  /** A CWE or OWASP identifier; shown only on a Security Issue. */
  securityReference?: string;
  className?: string;
}

/** One problem a Review reports. Read-only, so it has no actions. */
export function Finding({ kind, severity, file, lines, title, children, suggestedFix, securityReference, className }: FindingProps) {
  const location = file && (lines !== undefined ? `${file}:${lines}` : file);
  return (
    <article className={cx("dw-finding", className)}>
      <header className="dw-finding-head">
        <Severity level={severity} />
        <Badge>{KIND_LABELS[kind]}</Badge>
        {kind === "security-issue" && securityReference && <Badge tone="outline">{securityReference}</Badge>}
        {location && <span className="dw-finding-loc">{location}</span>}
      </header>
      <div className="dw-finding-body">
        <h3 className="dw-finding-title">{title}</h3>
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

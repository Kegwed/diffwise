import type { Finding, FindingKind, Severity } from "@diffwise/shared";

/** Security Issues first, as the kind to prioritise. */
export const KINDS_BY_PRIORITY = ["security-issue", "bad-practice"] as const satisfies readonly FindingKind[];

const KIND_LABELS: Record<FindingKind, { one: string; many: string }> = {
  "security-issue": { one: "Security Issue", many: "Security Issues" },
  "bad-practice": { one: "Bad Practice", many: "Bad Practices" },
};

/** The kind's name for `count` Findings of it: "Security Issue" for one, "Security Issues" for any other number. */
export function kindLabel(kind: FindingKind, count: number): string {
  return KIND_LABELS[kind][count === 1 ? "one" : "many"];
}

/** The Finding's lines as they're written out: one line ("3"), or a range ("5–6"). */
export function lineRange({ startLine, endLine }: Finding): string {
  return startLine === endLine ? String(startLine) : `${startLine}–${endLine}`;
}

/** One jump to a Finding in the diff. Each is its own object, so jumping to the same Finding again scrolls to it again. */
export interface Jump {
  to: Finding;
}

/**
 * The Findings to show: those of one of the chosen kinds and one of the chosen Severities. With no kind chosen,
 * Findings of every kind are shown, and likewise for Severities.
 */
export interface FindingFilter {
  kinds: ReadonlySet<FindingKind>;
  severities: ReadonlySet<Severity>;
}

export const NO_FILTER: FindingFilter = { kinds: new Set(), severities: new Set() };

export function matchesFilter(finding: Finding, { kinds, severities }: FindingFilter): boolean {
  return (kinds.size === 0 || kinds.has(finding.kind)) && (severities.size === 0 || severities.has(finding.severity));
}

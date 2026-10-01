import type { ReactNode } from "react";
import { SEVERITIES, type Finding } from "@diffwise/shared";
import { Badge, Button, Severity } from "./design-system/index.ts";
import { KINDS_BY_PRIORITY, kindLabel, lineRange, matchesFilter, type FindingFilter } from "./findings.ts";

/** Highest first, as the design system sorts by Severity. */
const SEVERITIES_HIGHEST_FIRST = SEVERITIES.toReversed();

export interface FindingsPanelProps {
  /** Every Finding of the Review, in the order the diff shows them. */
  findings: Finding[];
  /** The filter the diff applies too. */
  filter: FindingFilter;
  /** Changes the filter from what it is by then, so toggles in quick succession each count. */
  onFilter: (change: (filter: FindingFilter) => FindingFilter) => void;
  /** The Finding the diff was last jumped to, if any. */
  jumpedTo?: Finding;
  onJump: (finding: Finding) => void;
}

/**
 * The overview of a Review's Findings beside its diff: how many it reports of each kind and of each Severity, each
 * count a button that filters by it, then the Findings the filter shows, each a button that jumps to it in the diff.
 */
export function FindingsPanel({ findings, filter, onFilter, jumpedTo, onJump }: FindingsPanelProps) {
  const shown = findings.filter((finding) => matchesFilter(finding, filter));
  return (
    <aside aria-labelledby="findings" className="findings-panel">
      <h3 id="findings">Findings</h3>
      <div role="group" aria-label="Kind" className="filter">
        {KINDS_BY_PRIORITY.map((kind) => {
          const count = findings.filter((finding) => finding.kind === kind).length;
          return (
            <FilterButton
              key={kind}
              count={count}
              pressed={filter.kinds.has(kind)}
              onToggle={() => onFilter((was) => ({ ...was, kinds: toggled(was.kinds, kind) }))}
            >
              {kindLabel(kind, count)}
            </FilterButton>
          );
        })}
      </div>
      <div role="group" aria-label="Severity" className="filter">
        {SEVERITIES_HIGHEST_FIRST.map((severity) => (
          <FilterButton
            key={severity}
            count={findings.filter((finding) => finding.severity === severity).length}
            pressed={filter.severities.has(severity)}
            onToggle={() => onFilter((was) => ({ ...was, severities: toggled(was.severities, severity) }))}
          >
            <Severity severity={severity} />
          </FilterButton>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="caption">No Findings match the filters.</p>
      ) : (
        <ol className="finding-links">
          {shown.map((finding, i) => (
            <li key={i}>
              <button
                type="button"
                className="finding-link"
                aria-current={finding === jumpedTo ? "true" : undefined}
                onClick={() => onJump(finding)}
              >
                <Severity severity={finding.severity} /> <span className="finding-link-title">{finding.title}</span>{" "}
                <span className="caption">
                  <code>
                    {finding.file}:{lineRange(finding)}
                  </code>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/** What a filter can be narrowed to, with how many of the Review's Findings it has. Pressed while the filter is narrowed to it. */
function FilterButton({
  count,
  pressed,
  onToggle,
  children,
}: {
  count: number;
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Button size="sm" className="filter-button" aria-pressed={pressed} onClick={onToggle}>
      {children} <Badge tone={pressed ? "accent" : "outline"}>{count}</Badge>
    </Button>
  );
}

/** The set with `value` added, or taken out if it was in. */
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const values = new Set(set);
  if (!values.delete(value)) values.add(value);
  return values;
}

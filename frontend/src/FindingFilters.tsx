import type { ReactNode } from "react";
import { SEVERITIES, type Finding } from "@diffwise/shared";
import { Badge, Button, Severity } from "./design-system/index.ts";
import { KINDS_BY_PRIORITY, kindLabel, type FindingFilter } from "./findings.ts";

/** Highest first, as the design system sorts by Severity. */
const SEVERITIES_HIGHEST_FIRST = SEVERITIES.toReversed();

export interface FindingFiltersProps {
  /** Every Finding of the Review: the counts are the Review's, whatever is hidden. */
  findings: Finding[];
  filter: FindingFilter;
  /** Changes the filter from what it is by then, so toggles in quick succession each count. */
  onFilter: (change: (filter: FindingFilter) => FindingFilter) => void;
}

/**
 * How many Findings the Review reports of each kind and of each Severity, each count a toggle that narrows the
 * Findings shown to it. With nothing pressed, every Finding is shown.
 */
export function FindingFilters({ findings, filter, onFilter }: FindingFiltersProps) {
  return (
    <section aria-label="Filter Findings" className="card finding-filters">
      <div role="group" aria-label="Kind" className="filter">
        <span className="filter-label" aria-hidden="true">
          Kind
        </span>
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
        <span className="filter-label" aria-hidden="true">
          Severity
        </span>
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
    </section>
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

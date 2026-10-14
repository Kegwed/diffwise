import { useEffect, useRef, useState } from "react";
import { parsePatch, SEVERITIES, type FileOutcome, type Finding, type PendingFile, type Review } from "@diffwise/shared";
import { covers, DiffView } from "./DiffView.tsx";
import { FindingFilters } from "./FindingFilters.tsx";
import { lineRange, matchesFilter, NO_FILTER, type Jump } from "./findings.ts";
import { Badge, Finding as FindingCard } from "./design-system/index.ts";

const OUTCOME_LABELS: Record<FileOutcome["outcome"], string> = {
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

const PENDING_LABELS: Record<PendingFile["state"], string> = {
  queued: "Queued",
  reviewing: "Reviewing",
};

/**
 * A Review's files as they stand: one part per file the Model was given, each reviewed one with its diff and its
 * Findings beside it, then the skipped files. The filters above them narrow the Findings shown.
 */
export function ReviewView({ review }: { review: Review }) {
  const [filter, setFilter] = useState(NO_FILTER);
  const [jump, setJump] = useState<Jump>();
  const byFile = Map.groupBy(review.findings.toSorted(bySeverityThenLine), (finding) => finding.file);
  const outcomes = new Map(review.fileOutcomes.map((outcome) => [outcome.file, outcome]));
  const pending = new Map(review.pendingFiles.map(({ file, state }) => [file, state]));
  // Outcome order first; Reviews saved before File Outcomes existed only have their Findings' files. Then the files still
  // to settle. Skipped files were never given to the Model, so they're listed apart, at the end.
  const files = [...new Set([...outcomes.keys(), ...byFile.keys(), ...pending.keys()])].filter(
    (file) => outcomes.get(file)?.outcome !== "skipped",
  );
  const skipped = review.fileOutcomes.filter((outcome) => outcome.outcome === "skipped");

  return (
    <>
      {review.findings.length > 0 && <FindingFilters findings={review.findings} filter={filter} onFilter={setFilter} />}
      {files.map((file) => (
        <FileCard
          key={file}
          file={file}
          outcome={outcomes.get(file)}
          pending={pending.get(file)}
          findings={byFile.get(file) ?? []}
          shown={(byFile.get(file) ?? []).filter((finding) => matchesFilter(finding, filter))}
          jump={jump}
          onJump={(finding) => setJump({ to: finding })}
        />
      ))}
      {skipped.length > 0 && (
        <section aria-labelledby="skipped-files" className="card skipped-files">
          <header className="file-head">
            <h3 id="skipped-files">Skipped files</h3>
            <span className="caption file-count">{skipped.length === 1 ? "1 file" : `${skipped.length} files`}</span>
          </header>
          <ul>
            {skipped.map((outcome) => (
              <li key={outcome.file}>
                <code>{outcome.file}</code>
                <Badge>Skipped</Badge>
                <span className="caption">{outcome.outcome === "skipped" && outcome.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

interface FileCardProps {
  file: string;
  outcome?: FileOutcome;
  pending?: PendingFile["state"];
  /** All the file's Findings, highest Severity first. */
  findings: Finding[];
  /** Those of them the filters show. */
  shown: Finding[];
  jump?: Jump;
  onJump: (finding: Finding) => void;
}

/** One changed file the Model was given: its outcome, and once reviewed, its diff with its Findings beside it. */
function FileCard({ file, outcome, pending, findings, shown, jump, onJump }: FileCardProps) {
  const reviewed = !pending && (!outcome || outcome.outcome === "reviewed");
  const patch = outcome?.outcome === "reviewed" ? outcome.patch : "";
  const hunks = parsePatch(patch);
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const jumpedTo = jump && shown.includes(jump.to) ? jump.to : undefined;
  // A Finding whose lines the diff doesn't show is scrolled to itself instead.
  const jumpedFrame = useRef<HTMLDivElement>(null);
  const jumpedOffDiff = jumpedTo && !lines.some((line) => covers(jumpedTo, line));

  useEffect(() => {
    if (jumpedOffDiff) jumpedFrame.current?.scrollIntoView({ block: "center" });
  }, [jump]);

  return (
    <section aria-label={file} className="card file">
      <header className="file-head">
        <h3>
          <code>{file}</code>
        </h3>
        {/* The file the Model has now stands out from the ones waiting, without a status colour: the words carry the meaning. */}
        {pending && <Badge tone={pending === "reviewing" ? "neutral" : "outline"}>{PENDING_LABELS[pending]}</Badge>}
        {outcome && <Badge tone={outcome.outcome === "reviewed" ? "outline" : "neutral"}>{OUTCOME_LABELS[outcome.outcome]}</Badge>}
        {reviewed && <span className="caption file-count">{findings.length === 0 ? "No Findings" : findingCount(findings.length)}</span>}
      </header>
      <div className="file-body">
        {pending === "reviewing" && <p className="caption">Reviewing now. Findings for this file appear when the Model finishes it.</p>}
        {pending === "queued" && <p className="caption">Queued.</p>}
        {outcome?.outcome === "failed" && <p className="caption">{outcome.reason}</p>}
        {reviewed && (
          <div className="file-review">
            {hunks.length > 0 ? (
              <DiffView file={file} hunks={hunks} findings={shown} jump={jump} />
            ) : (
              patch === "" && (
                <p className="caption">This Review was saved before diffs were kept, so its Findings are listed without one.</p>
              )
            )}
            <div className="file-findings">
              {findings.length === 0 && <p className="caption">No Findings in the lines this file changes.</p>}
              {findings.length > 0 && shown.length === 0 && (
                <p className="caption">{findingCount(findings.length)} hidden by the filters above.</p>
              )}
              {shown.map((finding, i) => (
                <div key={i} ref={finding === jumpedTo ? jumpedFrame : undefined}>
                  <FindingCard
                    kind={finding.kind}
                    severity={finding.severity}
                    file={finding.file}
                    lines={lineRange(finding)}
                    title={finding.title}
                    headingLevel={4}
                    suggestedFix={finding.suggestedFix}
                    securityReference={finding.securityReference}
                    onShowLines={() => onJump(finding)}
                    linesShown={finding === jumpedTo}
                  >
                    <p>{finding.explanation}</p>
                  </FindingCard>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function findingCount(n: number) {
  return n === 1 ? "1 Finding" : `${n} Findings`;
}

/** Highest Severity first, then by line, as the design system's Finding guidelines ask. */
function bySeverityThenLine(a: Finding, b: Finding) {
  return (
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.startLine - b.startLine || a.endLine - b.endLine
  );
}

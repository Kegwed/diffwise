import { useState } from "react";
import { SEVERITIES, type FileOutcome, type Finding, type PendingFile, type Review } from "@diffwise/shared";
import { DiffView } from "./DiffView.tsx";
import { FindingsPanel } from "./FindingsPanel.tsx";
import { matchesFilter, NO_FILTER, type Jump } from "./findings.ts";
import { Badge } from "./design-system/index.ts";

const OUTCOME_LABELS: Record<FileOutcome["outcome"], string> = {
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

const PENDING_LABELS: Record<PendingFile["state"], string> = {
  queued: "Queued",
  reviewing: "Reviewing",
};

/** A Review as it stands: complete, or still running with some of its files yet to settle. */
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
  const inDiffOrder = files.flatMap((file) => byFile.get(file) ?? []);
  const shownByFile = Map.groupBy(inDiffOrder.filter((finding) => matchesFilter(finding, filter)), (finding) => finding.file);

  return (
    <>
      <div className="review-layout">
        {review.findings.length > 0 && (
          <FindingsPanel
            findings={inDiffOrder}
            filter={filter}
            onFilter={setFilter}
            jumpedTo={jump?.to}
            onJump={(finding) => setJump({ to: finding })}
          />
        )}
        <div className="review-files">
          {files.map((file) => {
            const outcome = outcomes.get(file);
            const pendingState = pending.get(file);
            const findings = byFile.get(file)?.length ?? 0;
            const reviewed = !pendingState && (!outcome || outcome.outcome === "reviewed");
            return (
              <section key={file} aria-label={file} className="card file">
                <header className="file-head">
                  <h3>
                    <code>{file}</code>
                  </h3>
                  {/* The file the Model has now stands out from the ones waiting, without a status colour: the words carry the meaning. */}
                  {pendingState && <Badge tone={pendingState === "reviewing" ? "neutral" : "outline"}>{PENDING_LABELS[pendingState]}</Badge>}
                  {outcome && (
                    <Badge tone={outcome.outcome === "reviewed" ? "outline" : "neutral"}>{OUTCOME_LABELS[outcome.outcome]}</Badge>
                  )}
                  {reviewed && <span className="caption file-count">{findings === 0 ? "No Findings" : findingCount(findings)}</span>}
                </header>
                <div className="file-body">
                  {pendingState === "reviewing" && (
                    <p className="caption">Reviewing now. Findings for this file appear when the Model finishes it.</p>
                  )}
                  {pendingState === "queued" && <p className="caption">Queued.</p>}
                  {outcome?.outcome === "failed" && <p className="caption">{outcome.reason}</p>}
                  {reviewed && (
                    <DiffView file={file} patch={outcome?.outcome === "reviewed" ? outcome.patch : ""} findings={shownByFile.get(file) ?? []} jump={jump} />
                  )}
                  {reviewed && findings === 0 && <p className="caption">No Findings in the lines this file changes.</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
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

function findingCount(n: number) {
  return n === 1 ? "1 Finding" : `${n} Findings`;
}

/** Highest Severity first, then by line, as the design system's Finding guidelines ask. */
function bySeverityThenLine(a: Finding, b: Finding) {
  return (
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.startLine - b.startLine || a.endLine - b.endLine
  );
}

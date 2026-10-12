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
  // Outcome order first; Reviews saved before File Outcomes existed only have their Findings' files. Then the files still to settle.
  const files = [...new Set([...outcomes.keys(), ...byFile.keys(), ...pending.keys()])];
  const inDiffOrder = files.flatMap((file) => byFile.get(file) ?? []);
  const shownByFile = Map.groupBy(inDiffOrder.filter((finding) => matchesFilter(finding, filter)), (finding) => finding.file);
  const running = review.status === "running";

  return (
    <>
      {byFile.size === 0 && <p>{running ? "No Findings yet." : "No Findings."}</p>}
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
            return (
              <section key={file} aria-label={file} className="file">
                <header className="file-head">
                  <h3>
                    <code>{file}</code>
                  </h3>
                  {/* The file the Model has now stands out from the ones waiting, without a status colour: the words carry the meaning. */}
                  {pendingState && <Badge tone={pendingState === "reviewing" ? "neutral" : "outline"}>{PENDING_LABELS[pendingState]}</Badge>}
                  {outcome && (
                    <Badge tone={outcome.outcome === "reviewed" ? "outline" : "neutral"}>{OUTCOME_LABELS[outcome.outcome]}</Badge>
                  )}
                  {outcome && outcome.outcome !== "reviewed" && <p className="caption">{outcome.reason}</p>}
                </header>
                {!pendingState && (!outcome || outcome.outcome === "reviewed") && (
                  <DiffView file={file} patch={outcome?.patch ?? ""} findings={shownByFile.get(file) ?? []} jump={jump} />
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Highest Severity first, then by line, as the design system's Finding guidelines ask. */
function bySeverityThenLine(a: Finding, b: Finding) {
  return (
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.startLine - b.startLine || a.endLine - b.endLine
  );
}

import { useState } from "react";
import { SEVERITIES, type FileOutcome, type Finding, type PendingFile, type Review } from "@diffwise/shared";
import { DiffView } from "./DiffView.tsx";
import { FindingsPanel } from "./FindingsPanel.tsx";
import { matchesFilter, NO_FILTER, type Jump } from "./findings.ts";
import { HeadCommit } from "./HeadCommit.tsx";
import { Badge, Button } from "./design-system/index.ts";

const OUTCOME_LABELS: Record<FileOutcome["outcome"], string> = {
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

const PENDING_LABELS: Record<PendingFile["state"], string> = {
  queued: "Queued",
  reviewing: "Reviewing",
};

export interface ReviewViewProps {
  review: Review;
  /** Whether the Pull Request's head commit has moved on since the Review ran. */
  outdated?: boolean;
  /** Starts a Review of the Pull Request's latest commit with this Review's Model; none while one can't be started. */
  onReviewLatest?: () => void;
}

/** A Review as it stands: complete, or still running with some of its files yet to settle. */
export function ReviewView({ review, outdated = false, onReviewLatest }: ReviewViewProps) {
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
  const { owner, repo, number } = review.pullRequest;

  return (
    <section aria-labelledby="review">
      <h2 id="review">
        Review of {owner}/{repo}#{number}
      </h2>
      <p className="caption">
        {review.model} via {review.modelProvider} at <HeadCommit commit={review.headCommit} />
      </p>
      {outdated && (
        <div role="note" className="outdated-notice panel-sunken">
          <Badge>Outdated</Badge>
          <p>New commits were pushed to this Pull Request since this Review ran, so its Findings may no longer apply.</p>
          <Button size="sm" onClick={onReviewLatest} disabled={!onReviewLatest}>
            Review the latest commit
          </Button>
        </div>
      )}
      {running && (
        <p role="status">
          Reviewing: {review.fileOutcomes.length} of {review.fileOutcomes.length + review.pendingFiles.length} files done.
        </p>
      )}
      <CoverageNotice fileOutcomes={review.fileOutcomes} />
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
    </section>
  );
}

function CoverageNotice({ fileOutcomes }: { fileOutcomes: FileOutcome[] }) {
  const counts = (["skipped", "failed"] as const).flatMap((outcome) => {
    const count = fileOutcomes.filter((o) => o.outcome === outcome).length;
    return count > 0 ? [`${count} ${count === 1 ? "file" : "files"} ${outcome}`] : [];
  });
  if (counts.length === 0) return null;
  return (
    <p role="note" className="panel-sunken">
      <strong>Incomplete coverage:</strong> {counts.join(", ")}. No Findings in a file that wasn't reviewed doesn't
      mean it's clean.
    </p>
  );
}

/** Highest Severity first, then by line, as the design system's Finding guidelines ask. */
function bySeverityThenLine(a: Finding, b: Finding) {
  return (
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || a.startLine - b.startLine || a.endLine - b.endLine
  );
}

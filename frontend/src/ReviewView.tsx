import { SEVERITIES, type FileOutcome, type Finding, type PendingFile, type Review } from "@diffwise/shared";
import { DiffView } from "./DiffView.tsx";
import { HeadCommit } from "./HeadCommit.tsx";
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
  const byFile = Map.groupBy(review.findings.toSorted(bySeverityThenLine), (finding) => finding.file);
  const outcomes = new Map(review.fileOutcomes.map((outcome) => [outcome.file, outcome]));
  const pending = new Map(review.pendingFiles.map(({ file, state }) => [file, state]));
  // Outcome order first; Reviews saved before File Outcomes existed only have their Findings' files. Then the files still to settle.
  const files = [...new Set([...outcomes.keys(), ...byFile.keys(), ...pending.keys()])];
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
      {running && (
        <p role="status">
          Reviewing: {review.fileOutcomes.length} of {review.fileOutcomes.length + review.pendingFiles.length} files done.
        </p>
      )}
      <CoverageNotice fileOutcomes={review.fileOutcomes} />
      {byFile.size === 0 && <p>{running ? "No Findings yet." : "No Findings."}</p>}
      {files.map((file) => {
        const outcome = outcomes.get(file);
        const pendingState = pending.get(file);
        return (
          <section key={file} aria-label={file} className="file">
            <header className="file-head">
              <h3>
                <code>{file}</code>
              </h3>
              {/* Accent picks out the file the Model has now; the ones waiting stay quiet. */}
              {pendingState && <Badge tone={pendingState === "reviewing" ? "accent" : "outline"}>{PENDING_LABELS[pendingState]}</Badge>}
              {outcome && (
                <Badge tone={outcome.outcome === "reviewed" ? "outline" : "neutral"}>{OUTCOME_LABELS[outcome.outcome]}</Badge>
              )}
              {outcome && outcome.outcome !== "reviewed" && <p className="caption">{outcome.reason}</p>}
            </header>
            {!pendingState && (!outcome || outcome.outcome === "reviewed") && (
              <DiffView file={file} patch={outcome?.patch ?? ""} findings={byFile.get(file) ?? []} />
            )}
          </section>
        );
      })}
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

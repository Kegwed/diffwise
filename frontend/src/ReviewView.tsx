import { SEVERITIES, type FileOutcome, type Finding, type Review } from "@diffwise/shared";
import { DiffView } from "./DiffView.tsx";
import { HeadCommit } from "./HeadCommit.tsx";
import { Badge } from "./design-system/index.ts";

const OUTCOME_LABELS: Record<FileOutcome["outcome"], string> = {
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

export function ReviewView({ review }: { review: Review }) {
  const byFile = Map.groupBy(review.findings.toSorted(bySeverityThenLine), (finding) => finding.file);
  const outcomes = new Map(review.fileOutcomes.map((outcome) => [outcome.file, outcome]));
  // Outcome order first; Reviews saved before File Outcomes existed only have their Findings' files.
  const files = [...new Set([...outcomes.keys(), ...byFile.keys()])];
  const { owner, repo, number } = review.pullRequest;

  return (
    <section aria-labelledby="review">
      <h2 id="review">
        Review of {owner}/{repo}#{number}
      </h2>
      <p className="caption">
        {review.model} via {review.modelProvider} at <HeadCommit commit={review.headCommit} />
      </p>
      <CoverageNotice fileOutcomes={review.fileOutcomes} />
      {byFile.size === 0 && <p>No Findings.</p>}
      {files.map((file) => {
        const outcome = outcomes.get(file);
        return (
          <section key={file} aria-label={file} className="file">
            <header className="file-head">
              <h3>
                <code>{file}</code>
              </h3>
              {outcome && (
                <Badge tone={outcome.outcome === "reviewed" ? "outline" : "neutral"}>{OUTCOME_LABELS[outcome.outcome]}</Badge>
              )}
              {outcome && outcome.outcome !== "reviewed" && <p className="caption">{outcome.reason}</p>}
            </header>
            {(!outcome || outcome.outcome === "reviewed") && (
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

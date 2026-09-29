import type { FileOutcome, Finding, Review } from "@diffwise/shared";

const KIND_LABELS: Record<Finding["kind"], string> = {
  "bad-practice": "Bad Practice",
  "security-issue": "Security Issue",
};

const OUTCOME_LABELS: Record<FileOutcome["outcome"], string> = {
  reviewed: "Reviewed",
  skipped: "Skipped",
  failed: "Failed",
};

export function FindingsList({ review }: { review: Review }) {
  const byFile = Map.groupBy(review.findings, (finding) => finding.file);
  const outcomes = new Map(review.fileOutcomes.map((outcome) => [outcome.file, outcome]));
  // Outcome order first; Reviews saved before File Outcomes existed only have their Findings' files.
  const files = [...new Set([...outcomes.keys(), ...byFile.keys()])];
  const { owner, repo, number } = review.pullRequest;

  return (
    <section aria-labelledby="review">
      <h2 id="review">
        Review of {owner}/{repo}#{number}
      </h2>
      <p className="meta">
        {review.model} at <code>{review.headCommit.slice(0, 7)}</code>
      </p>
      <CoverageNotice fileOutcomes={review.fileOutcomes} />
      {byFile.size === 0 && <p>No Findings.</p>}
      {files.map((file) => {
        const outcome = outcomes.get(file);
        const findings = byFile.get(file) ?? [];
        return (
          <section key={file} aria-label={file} className="file">
            <h3>
              <code>{file}</code>
              {outcome && <span className={`outcome ${outcome.outcome}`}>{OUTCOME_LABELS[outcome.outcome]}</span>}
            </h3>
            {outcome && outcome.outcome !== "reviewed" && <p className="meta outcome-reason">{outcome.reason}</p>}
            {findings.length > 0 && (
              <ul>
                {findings.map((finding, i) => (
                  <FindingItem key={i} finding={finding} />
                ))}
              </ul>
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
    <p role="note" className="coverage-notice">
      <strong>Incomplete coverage:</strong> {counts.join(", ")}. No Findings in a file that wasn't reviewed doesn't
      mean it's clean.
    </p>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  const lines =
    finding.startLine === finding.endLine
      ? `line ${finding.startLine}`
      : `lines ${finding.startLine}–${finding.endLine}`;
  return (
    <li className={`finding ${finding.kind}`}>
      <div className="meta">
        <span className={`severity ${finding.severity}`}>{finding.severity}</span> {KIND_LABELS[finding.kind]} ·{" "}
        {lines}
        {finding.securityReference && (
          <>
            {" · "}
            <span>{finding.securityReference}</span>
          </>
        )}
      </div>
      <h4>{finding.title}</h4>
      <p>{finding.explanation}</p>
      {finding.suggestedFix && (
        <details>
          <summary>Suggested Fix</summary>
          <pre>
            <code>{finding.suggestedFix}</code>
          </pre>
        </details>
      )}
    </li>
  );
}

import type { Finding, Review } from "@diffwise/shared";

const KIND_LABELS: Record<Finding["kind"], string> = {
  "bad-practice": "Bad Practice",
  "security-issue": "Security Issue",
};

export function FindingsList({ review }: { review: Review }) {
  const byFile = Map.groupBy(review.findings, (finding) => finding.file);
  const { owner, repo, number } = review.pullRequest;

  return (
    <section aria-labelledby="review">
      <h2 id="review">
        Review of {owner}/{repo}#{number}
      </h2>
      <p className="meta">
        {review.model} at <code>{review.headCommit.slice(0, 7)}</code>
      </p>
      {byFile.size === 0 && <p>No Findings.</p>}
      {[...byFile].map(([file, findings]) => (
        <section key={file} aria-label={file} className="file">
          <h3>
            <code>{file}</code>
          </h3>
          <ul>
            {findings.map((finding, i) => (
              <FindingItem key={i} finding={finding} />
            ))}
          </ul>
        </section>
      ))}
    </section>
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

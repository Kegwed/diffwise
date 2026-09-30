import { Fragment } from "react";
import { DIFF_MARKERS, parsePatch, type DiffHunk, type DiffLine, type Finding } from "@diffwise/shared";
import { Finding as FindingCard } from "./design-system/index.ts";

/**
 * One reviewed file's diff, GitHub-style, with each Finding beneath the last line of its range the diff shows.
 * Findings on lines the diff doesn't show are listed after it. `findings` arrive in the order to stack them.
 */
export function DiffView({ file, patch, findings }: { file: string; patch: string; findings: Finding[] }) {
  const hunks = parsePatch(patch);
  const { beneath, elsewhere } = placeFindings(hunks, findings);
  return (
    <>
      {hunks.length > 0 ? (
        <div className="diff-scroll">
          <table className="diff" aria-label={`Diff of ${file}`}>
            <tbody>
              {hunks.map((hunk, h) => (
                <Fragment key={h}>
                  <tr className="diff-hunk">
                    <td colSpan={3}>{hunk.header}</td>
                  </tr>
                  {hunk.lines.map((line, l) => (
                    <Fragment key={l}>
                      <tr className={`diff-${line.type}`}>
                        <td className="diff-num">{line.oldLine}</td>
                        <td className="diff-num">{line.newLine}</td>
                        <td className="diff-code">
                          <span className="diff-marker">{DIFF_MARKERS[line.type]}</span>
                          {line.text}
                        </td>
                      </tr>
                      {beneath.get(line)?.map((finding, f) => (
                        <tr key={f} className="diff-finding">
                          <td colSpan={3}>
                            <div className="diff-finding-card">
                              <FindingItem finding={finding} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        patch === "" && (
          <p className="caption">This Review was saved before diffs were kept, so its Findings are listed without one.</p>
        )
      )}
      {hunks.length > 0 && elsewhere.length > 0 && <p className="caption">On lines this diff doesn't show:</p>}
      {elsewhere.map((finding, i) => (
        <FindingItem key={i} finding={finding} />
      ))}
    </>
  );
}

/** Anchors each Finding to the last diff line inside its range, keeping the given order among Findings on one line. */
function placeFindings(hunks: DiffHunk[], findings: Finding[]) {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const beneath = new Map<DiffLine, Finding[]>();
  const elsewhere: Finding[] = [];
  for (const finding of findings) {
    const anchor = lines.findLast(
      (line) => line.newLine !== undefined && line.newLine >= finding.startLine && line.newLine <= finding.endLine,
    );
    if (anchor) beneath.set(anchor, [...(beneath.get(anchor) ?? []), finding]);
    else elsewhere.push(finding);
  }
  return { beneath, elsewhere };
}

function FindingItem({ finding }: { finding: Finding }) {
  const lines = finding.startLine === finding.endLine ? finding.startLine : `${finding.startLine}–${finding.endLine}`;
  return (
    <FindingCard
      kind={finding.kind}
      severity={finding.severity}
      file={finding.file}
      lines={lines}
      title={finding.title}
      headingLevel={4}
      suggestedFix={finding.suggestedFix}
      securityReference={finding.securityReference}
    >
      <p>{finding.explanation}</p>
    </FindingCard>
  );
}

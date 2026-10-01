import { Fragment, useEffect, useRef } from "react";
import { DIFF_MARKERS, parsePatch, type DiffLine, type Finding } from "@diffwise/shared";
import { cx } from "./design-system/cx.ts";
import { Finding as FindingCard } from "./design-system/index.ts";
import { lineRange, type Jump } from "./findings.ts";

export interface DiffViewProps {
  file: string;
  patch: string;
  /** The file's Findings to show, in the order to stack them. */
  findings: Finding[];
  /** The latest jump to a Finding, in this file or another. */
  jump?: Jump;
}

/**
 * One reviewed file's diff, GitHub-style, with each Finding beneath the last line of its range the diff shows.
 * Findings on lines the diff doesn't show are listed after it. A jump to one of its Findings scrolls to the
 * Finding's lines and highlights them, or scrolls to the Finding itself when the diff doesn't show its lines.
 */
export function DiffView({ file, patch, findings, jump }: DiffViewProps) {
  const hunks = parsePatch(patch);
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const { beneath, elsewhere } = placeFindings(lines, findings);
  const jumpedTo = jump && findings.includes(jump.to) ? jump.to : undefined;
  const firstJumpedLine = jumpedTo && lines.find((line) => covers(jumpedTo, line));
  const firstJumpedRow = useRef<HTMLTableRowElement>(null);
  const jumpedCard = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (firstJumpedRow.current ?? jumpedCard.current)?.scrollIntoView({ block: "center" });
  }, [jump]);

  const card = (finding: Finding, key: number, className?: string) => (
    <div key={key} ref={finding === jumpedTo ? jumpedCard : undefined} className={className}>
      <FindingItem finding={finding} jumpedTo={finding === jumpedTo} />
    </div>
  );

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
                      <tr
                        ref={line === firstJumpedLine ? firstJumpedRow : undefined}
                        className={cx(`diff-${line.type}`, jumpedTo && covers(jumpedTo, line) && "diff-highlighted")}
                      >
                        <td className="diff-num">{line.oldLine}</td>
                        <td className="diff-num">{line.newLine}</td>
                        <td className="diff-code">
                          <span className="diff-marker">{DIFF_MARKERS[line.type]}</span>
                          {line.text}
                        </td>
                      </tr>
                      {beneath.get(line)?.map((finding, f) => (
                        <tr key={f} className="diff-finding">
                          <td colSpan={3}>{card(finding, f, "diff-finding-card")}</td>
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
      {elsewhere.map((finding, i) => card(finding, i))}
    </>
  );
}

/** Whether the line is one of the Finding's, which are lines of the new version of the file. */
function covers(finding: Finding, line: DiffLine): boolean {
  return line.newLine !== undefined && line.newLine >= finding.startLine && line.newLine <= finding.endLine;
}

/** Anchors each Finding to the last diff line inside its range, keeping the given order among Findings on one line. */
function placeFindings(lines: DiffLine[], findings: Finding[]) {
  const beneath = new Map<DiffLine, Finding[]>();
  const elsewhere: Finding[] = [];
  for (const finding of findings) {
    const anchor = lines.findLast((line) => covers(finding, line));
    if (anchor) beneath.set(anchor, [...(beneath.get(anchor) ?? []), finding]);
    else elsewhere.push(finding);
  }
  return { beneath, elsewhere };
}

function FindingItem({ finding, jumpedTo }: { finding: Finding; jumpedTo: boolean }) {
  return (
    <FindingCard
      className={jumpedTo ? "finding-jumped-to" : undefined}
      kind={finding.kind}
      severity={finding.severity}
      file={finding.file}
      lines={lineRange(finding)}
      title={finding.title}
      headingLevel={4}
      suggestedFix={finding.suggestedFix}
      securityReference={finding.securityReference}
    >
      <p>{finding.explanation}</p>
    </FindingCard>
  );
}

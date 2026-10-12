import { Fragment, useEffect, useRef } from "react";
import { DIFF_MARKERS, type DiffHunk, type DiffLine, type Finding } from "@diffwise/shared";
import { cx } from "./design-system/cx.ts";
import type { Jump } from "./findings.ts";

export interface DiffViewProps {
  file: string;
  hunks: DiffHunk[];
  /** The file's Findings that are shown: the lines they cover are marked. */
  findings: Finding[];
  /** The latest jump to a Finding, in this file or another. */
  jump?: Jump;
}

/**
 * One reviewed file's diff, GitHub-style, with the lines each shown Finding covers marked. A jump to one of its
 * Findings whose lines it shows highlights them, scrolls to the first and focuses it.
 */
export function DiffView({ file, hunks, findings, jump }: DiffViewProps) {
  const lines = hunks.flatMap((hunk) => hunk.lines);
  const jumpedTo = jump && findings.includes(jump.to) ? jump.to : undefined;
  const firstJumpedLine = jumpedTo && lines.find((line) => covers(jumpedTo, line));
  const firstJumpedRow = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    firstJumpedRow.current?.scrollIntoView({ block: "center" });
    firstJumpedRow.current?.focus({ preventScroll: true });
  }, [jump]);

  return (
    <div className="diff-scroll">
      <table className="diff" aria-label={`Diff of ${file}`}>
        <tbody>
          {hunks.map((hunk, h) => (
            <Fragment key={h}>
              <tr className="diff-hunk">
                <td colSpan={3}>{hunk.header}</td>
              </tr>
              {hunk.lines.map((line, l) => (
                <tr
                  key={l}
                  ref={line === firstJumpedLine ? firstJumpedRow : undefined}
                  tabIndex={line === firstJumpedLine ? -1 : undefined}
                  className={cx(
                    `diff-${line.type}`,
                    findings.some((finding) => covers(finding, line)) && "diff-marked",
                    jumpedTo && covers(jumpedTo, line) && "diff-highlighted",
                  )}
                >
                  <td className="diff-num">{line.oldLine}</td>
                  <td className="diff-num">{line.newLine}</td>
                  <td className="diff-code">
                    <span className="diff-marker">{DIFF_MARKERS[line.type]}</span>
                    {line.text}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Whether the line is one of the Finding's, which are lines of the new version of the file. */
export function covers(finding: Finding, line: DiffLine): boolean {
  return line.newLine !== undefined && line.newLine >= finding.startLine && line.newLine <= finding.endLine;
}

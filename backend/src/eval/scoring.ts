import type { Finding, FindingKind } from "@diffwise/shared";

/** A deliberate problem in an Eval Set fixture, which a good Review should report. */
export interface PlantedProblem {
  kind: FindingKind;
  file: string;
  /** First line of the range, in the new version of the file. */
  startLine: number;
  /** Last line of the range (inclusive), in the new version of the file. */
  endLine: number;
  /** What the problem is, for the report's reader. */
  description: string;
}

/** How one Review did against its fixture's Planted Problems. */
export interface Score {
  caught: PlantedProblem[];
  missed: PlantedProblem[];
  /** The Findings that matched no Planted Problem. */
  unmatched: Finding[];
}

/**
 * Scores a Review's Findings against Planted Problems. A Planted Problem is caught if a Finding of the same kind,
 * in the same file, has a line range overlapping it. One Finding can catch several Planted Problems.
 */
export function scoreFindings(plantedProblems: PlantedProblem[], findings: Finding[]): Score {
  const isCaught = (plantedProblem: PlantedProblem) => findings.some((finding) => matches(finding, plantedProblem));
  return {
    caught: plantedProblems.filter(isCaught),
    missed: plantedProblems.filter((plantedProblem) => !isCaught(plantedProblem)),
    unmatched: findings.filter((finding) => !plantedProblems.some((plantedProblem) => matches(finding, plantedProblem))),
  };
}

function matches(finding: Finding, plantedProblem: PlantedProblem): boolean {
  return (
    finding.kind === plantedProblem.kind &&
    finding.file === plantedProblem.file &&
    finding.startLine <= plantedProblem.endLine &&
    plantedProblem.startLine <= finding.endLine
  );
}

import type { FileOutcome, FindingKind, ModelChoice } from "@diffwise/shared";
import { fixtureForge } from "../fixture-forge.ts";
import type { PullRequestSnapshot } from "../forge.ts";
import type { ModelProvider } from "../model-provider.ts";
import { startReview } from "../review-engine.ts";
import type { EvalFixture } from "./eval-set.ts";
import { scoreFindings, type Score } from "./scoring.ts";

/** How the Model's Review of one fixture did. */
export interface FixtureResult extends Score {
  pullRequest: PullRequestSnapshot;
  /** The files that were skipped or failed. The Planted Problems in them are missed. */
  notReviewed: Exclude<FileOutcome, { outcome: "reviewed" }>[];
}

/** How one Model did on the Eval Set. */
export interface EvalReport extends ModelChoice {
  fixtures: FixtureResult[];
}

export interface EvalOptions {
  /** Called as the Review of each fixture starts, since a whole run can take a long while on a local Model. */
  onFixtureStart?: (fixture: EvalFixture) => void;
}

/** Reviews each fixture of the Eval Set with the Model, one after another, and scores each Review's Findings. */
export async function runEvalSet(
  evalSet: EvalFixture[],
  modelProvider: ModelProvider,
  model: string,
  { onFixtureStart }: EvalOptions = {},
): Promise<EvalReport> {
  const forge = fixtureForge(evalSet.map((fixture) => fixture.pullRequest));
  const fixtures: FixtureResult[] = [];
  for (const fixture of evalSet) {
    onFixtureStart?.(fixture);
    const pullRequest = (await forge.getPullRequest(fixture.pullRequest))!;
    const review = await startReview(pullRequest, model, modelProvider).finished;
    fixtures.push({
      pullRequest,
      ...scoreFindings(fixture.plantedProblems, review.findings),
      notReviewed: review.fileOutcomes.filter((fileOutcome) => fileOutcome.outcome !== "reviewed"),
    });
  }
  return { modelProvider: modelProvider.name, model, fixtures };
}

const KIND_NAMES: Record<FindingKind, string> = { "security-issue": "Security Issues", "bad-practice": "Bad Practices" };

/** The report as text for the terminal. */
export function formatEvalReport({ modelProvider, model, fixtures }: EvalReport): string {
  const lines = [`Eval Set report for ${model} (${modelProvider})`, ""];
  for (const { pullRequest, caught, missed, unmatched, notReviewed } of fixtures) {
    const { owner, repo, number, title } = pullRequest;
    lines.push(`${owner}/${repo}#${number} ${title}: caught ${caught.length} of ${caught.length + missed.length}`);
    for (const plantedProblem of caught) lines.push(row("caught", plantedProblem.kind, plantedProblem, plantedProblem.description));
    for (const plantedProblem of missed) lines.push(row("missed", plantedProblem.kind, plantedProblem, plantedProblem.description));
    for (const finding of unmatched) lines.push(row("unmatched", finding.kind, finding, `${finding.title} (${finding.severity})`));
    for (const { file, outcome, reason } of notReviewed) lines.push(`  ${outcome.padEnd(9)}  ${file}: ${reason}`);
    lines.push("");
  }

  const caught = fixtures.flatMap((fixture) => fixture.caught);
  const plantedProblems = [...caught, ...fixtures.flatMap((fixture) => fixture.missed)];
  const byKind = (Object.keys(KIND_NAMES) as FindingKind[]).map((kind) => {
    const ofKind = (plantedProblem: { kind: FindingKind }) => plantedProblem.kind === kind;
    return `${caught.filter(ofKind).length} of ${plantedProblems.filter(ofKind).length} ${KIND_NAMES[kind]}`;
  });
  const percentage = plantedProblems.length === 0 ? 0 : Math.round((caught.length / plantedProblems.length) * 100);
  lines.push(`Caught ${caught.length} of ${plantedProblems.length} Planted Problems (${percentage}%): ${byKind.join(", ")}.`);

  const unmatchedCount = fixtures.reduce((count, fixture) => count + fixture.unmatched.length, 0);
  if (unmatchedCount === 0) lines.push("No Finding went unmatched.");
  else lines.push(`${unmatchedCount} ${unmatchedCount === 1 ? "Finding" : "Findings"} matched no Planted Problem.`);

  const notReviewedCount = fixtures.reduce((count, fixture) => count + fixture.notReviewed.length, 0);
  if (notReviewedCount === 1) lines.push("1 file wasn't reviewed, so the Planted Problems in it count as missed.");
  else if (notReviewedCount > 1) lines.push(`${notReviewedCount} files weren't reviewed, so the Planted Problems in them count as missed.`);

  return lines.join("\n") + "\n";
}

function row(label: string, kind: FindingKind, at: { file: string; startLine: number; endLine: number }, text: string): string {
  const lineRange = at.startLine === at.endLine ? `${at.startLine}` : `${at.startLine}-${at.endLine}`;
  return `  ${label.padEnd(9)}  ${kind.padEnd(14)}  ${at.file}:${lineRange}  ${text}`;
}

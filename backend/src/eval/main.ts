import { parseArgs } from "node:util";
import { loadEnvFile } from "../env-file.ts";
import { modelProvidersFromEnv } from "../model-provider-config.ts";
import { describeModelUnavailable, modelUnavailable } from "../model-provider.ts";
import { EVAL_SET } from "./eval-set.ts";
import { formatEvalReport, runEvalSet } from "./runner.ts";

const USAGE = `Usage: npm run eval -- --model <model> [--provider <model provider>]

Reviews every fixture Pull Request of the Eval Set with the Model and reports the Planted Problems it caught and missed.
--provider names a configured Model Provider (e.g. "Ollama"); it can be left out when only one is configured.`;

/** Prints why the Eval Set can't be run, and stops. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArguments() {
  try {
    return parseArgs({ options: { model: { type: "string" }, provider: { type: "string" } } }).values;
  } catch (error) {
    fail(`${(error as Error).message}\n\n${USAGE}`);
  }
}

loadEnvFile();

const { model, provider: providerName } = parseArguments();
if (!model) fail(USAGE);

const modelProviders = modelProvidersFromEnv(process.env);
const configured = modelProviders.map((provider) => provider.name).join(", ") || "none (see README.md)";
const modelProvider = providerName
  ? modelProviders.find((provider) => provider.name.toLowerCase() === providerName.toLowerCase())
  : modelProviders.length === 1
    ? modelProviders[0]
    : undefined;
if (!modelProvider) {
  fail(
    providerName
      ? `No Model Provider named "${providerName}" is configured. Configured: ${configured}.`
      : `Choose a Model Provider with --provider. Configured: ${configured}.`,
  );
}

const unavailable = await modelUnavailable(modelProvider, model);
if (unavailable) fail(describeModelUnavailable(modelProvider.name, model, unavailable));

const report = await runEvalSet(EVAL_SET, modelProvider, model, {
  onFixtureStart: ({ pullRequest: { owner, repo, number } }) => console.error(`Reviewing ${owner}/${repo}#${number}...`),
});
process.stdout.write(`\n${formatEvalReport(report)}`);

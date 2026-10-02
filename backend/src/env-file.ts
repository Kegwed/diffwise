import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Loads `.env` at the repo root into the environment, if there is one. */
export function loadEnvFile() {
  const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

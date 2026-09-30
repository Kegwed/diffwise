import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizePath, type Plugin } from "vite";
import { tokensToCss, type DesignTokens } from "./src/design-system/tokens.ts";

const VIRTUAL_ID = "virtual:design-tokens.css";

/**
 * Serves `virtual:design-tokens.css`, generated from the design system's tokens.json at build time (ADR-0002).
 * The module is given a path next to tokens.json so Vite resolves the fonts' relative url()s from there.
 */
export function designTokens(tokensPath: string): Plugin {
  const cssPath = normalizePath(join(dirname(tokensPath), "tokens.generated.css"));
  return {
    name: "diffwise-design-tokens",
    resolveId: (id) => (id === VIRTUAL_ID ? cssPath : undefined),
    async load(id) {
      if (id !== cssPath) return;
      this.addWatchFile(tokensPath);
      return tokensToCss(JSON.parse(await readFile(tokensPath, "utf8")) as DesignTokens);
    },
  };
}

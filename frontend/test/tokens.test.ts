import { expect, test } from "vitest";
import { tokensToCss, type DesignTokens } from "../src/design-system/tokens.ts";
import tokensJson from "../src/design-system/tokens.json?raw";

const sample: DesignTokens = {
  color: {
    themes: [
      { id: "light", name: "Light" },
      { id: "dark", name: "Dark" },
    ],
    tokens: [
      { name: "bg", value: { light: "#f6f7f8", dark: "#0f1216" } },
      { name: "accent", value: { light: "#0b6e79", dark: "#4fd1dc" } },
      { name: "link", value: "{accent}" },
    ],
  },
  type: {
    fonts: [{ family: "IBM Plex Sans", file: "fonts/IBMPlexSans-Regular.woff2", weight: "400" }],
    families: { sans: '"IBM Plex Sans", sans-serif', mono: '"IBM Plex Mono", monospace' },
    groups: [
      {
        name: "Text",
        family: "sans",
        styles: [
          { name: "title", fontSize: "24px", lineHeight: "32px", fontWeight: 600, letterSpacing: "-0.01em" },
          { name: "body", fontSize: "14px", lineHeight: "22px", fontWeight: 400 },
        ],
      },
    ],
  },
  spacing: { tokens: [{ name: "space-1", value: "4px" }] },
  radius: { tokens: [{ name: "radius-sm", value: "3px" }] },
  shadow: {
    tokens: [{ name: "focus-ring", value: { light: "0 0 0 2px #ffffff", dark: "0 0 0 2px #171b21" } }],
  },
};

/** The declarations inside the first block whose selector line matches. */
function block(css: string, opener: RegExp): string {
  const start = css.search(opener);
  expect(start, `no block matching ${opener}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error("unbalanced braces");
}

test("the light theme is the default and the dark theme follows the OS setting", () => {
  const css = tokensToCss(sample);

  const light = block(css, /^:root \{/m);
  expect(light).toContain("color-scheme: light dark;");
  expect(light).toContain("--bg: #f6f7f8;");
  expect(light).toContain("--accent: #0b6e79;");
  expect(light).toContain("--focus-ring: 0 0 0 2px #ffffff;");

  const dark = block(css, /^@media \(prefers-color-scheme: dark\) \{/m);
  expect(dark).toContain("--bg: #0f1216;");
  expect(dark).toContain("--accent: #4fd1dc;");
  expect(dark).toContain("--focus-ring: 0 0 0 2px #171b21;");
});

test("an alias refers to the token it names, so it follows that token in both themes", () => {
  const css = tokensToCss(sample);

  expect(block(css, /^:root \{/m)).toContain("--link: var(--accent);");
  expect(block(css, /^@media/m)).not.toContain("--link");
});

test("theme-independent tokens, font families and type styles are declared once", () => {
  const css = tokensToCss(sample);
  const light = block(css, /^:root \{/m);

  expect(light).toContain("--space-1: 4px;");
  expect(light).toContain("--radius-sm: 3px;");
  expect(light).toContain('--font-sans: "IBM Plex Sans", sans-serif;');
  expect(light).toContain('--font-mono: "IBM Plex Mono", monospace;');
  expect(light).toContain("--type-title: 600 24px/32px var(--font-sans);");
  expect(light).toContain("--type-title-letter-spacing: -0.01em;");
  expect(light).toContain("--type-body: 400 14px/22px var(--font-sans);");
  expect(light).toContain("--type-body-letter-spacing: normal;");
  expect(block(css, /^@media/m)).not.toContain("--space-1");
});

test("each font file is declared with @font-face, relative to tokens.json", () => {
  const css = tokensToCss(sample);

  const face = block(css, /^@font-face \{/m);
  expect(face).toContain('font-family: "IBM Plex Sans";');
  expect(face).toContain('src: url("./fonts/IBMPlexSans-Regular.woff2") format("woff2");');
  expect(face).toContain("font-weight: 400;");
  expect(face).toContain("font-display: swap;");
});

test("the design system's own tokens.json generates both themes", () => {
  const css = tokensToCss(JSON.parse(tokensJson) as DesignTokens);

  expect(block(css, /^:root \{/m)).toContain("--surface: #ffffff;");
  expect(block(css, /^@media/m)).toContain("--surface: #171b21;");
  expect(css.match(/@font-face/g)).toHaveLength(5);
});

test("a theme other than light and dark is an error, not silently dropped", () => {
  const extra: DesignTokens = {
    ...sample,
    color: { ...sample.color, themes: [...sample.color.themes, { id: "high-contrast", name: "High contrast" }] },
  };

  expect(() => tokensToCss(extra)).toThrow(/high-contrast/);
});

test("a themed value missing a theme is an error, not a silently missing variable", () => {
  const broken: DesignTokens = {
    ...sample,
    color: { ...sample.color, tokens: [{ name: "bg", value: { light: "#fff" } }] },
  };

  expect(() => tokensToCss(broken)).toThrow(/bg.*dark/);
});

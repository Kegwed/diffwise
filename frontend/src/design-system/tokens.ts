// Generates the design system's CSS from its tokens.json (ADR-0002). Pure, so the Vite plugin and tests share it.

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** A value the same in every theme, one per theme, or an alias of another token ("{accent}"). */
type TokenValue = string | Partial<Record<Theme, string>>;

interface Token {
  name: string;
  value: TokenValue;
}

interface TypeStyle {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
}

/** The parts of the artifact's tokens.json the generator reads; the rest (usage notes, samples) is documentation. */
export interface DesignTokens {
  color: { themes: { id: string; name: string }[]; tokens: Token[] };
  type: {
    fonts: { family: string; file: string; weight: string }[];
    families: Record<string, string>;
    groups: { name: string; family: string; styles: TypeStyle[] }[];
  };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
}

const ALIAS = /^\{([\w-]+)\}$/;

/** The token's value in each theme, or one value for all themes. */
function resolve({ name, value }: Token): string | Record<Theme, string> {
  if (typeof value === "string") return value.replace(ALIAS, "var(--$1)");
  const missing = THEMES.filter((theme) => value[theme] === undefined);
  if (missing.length > 0) throw new Error(`Token "${name}" has no value for the ${missing.join(" and ")} theme`);
  return value as Record<Theme, string>;
}

const declarations = (entries: [string, string][], indent: string) =>
  entries.map(([name, value]) => `${indent}--${name}: ${value};`).join("\n");

const FONT_FORMATS: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/** CSS for tokens.json: @font-face rules, the light theme on :root and the dark theme under prefers-color-scheme. */
export function tokensToCss(tokens: DesignTokens): string {
  const shared: [string, string][] = [];
  const themed: Record<Theme, [string, string][]> = { light: [], dark: [] };

  const allTokens = [...tokens.color.tokens, ...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens];
  for (const token of allTokens) {
    const value = resolve(token);
    if (typeof value === "string") shared.push([token.name, value]);
    else for (const theme of THEMES) themed[theme].push([token.name, value[theme]]);
  }

  for (const [family, stack] of Object.entries(tokens.type.families)) shared.push([`font-${family}`, stack]);
  for (const group of tokens.type.groups) {
    for (const style of group.styles) {
      const font = `${style.fontWeight} ${style.fontSize}/${style.lineHeight} var(--font-${group.family})`;
      shared.push([`type-${style.name}`, font], [`type-${style.name}-letter-spacing`, style.letterSpacing ?? "normal"]);
    }
  }

  const fontFaces = tokens.type.fonts.map((font) => {
    const format = FONT_FORMATS[font.file.split(".").pop()!.toLowerCase()];
    return [
      "@font-face {",
      `  font-family: "${font.family}";`,
      `  src: url("./${font.file}")${format ? ` format("${format}")` : ""};`,
      `  font-weight: ${font.weight};`,
      "  font-style: normal;",
      "  font-display: swap;",
      "}",
    ].join("\n");
  });

  return [
    "/* Generated from tokens.json by the design-tokens Vite plugin. Edit tokens.json, not this. */",
    ...fontFaces,
    `:root {\n  color-scheme: light dark;\n${declarations([...themed.light, ...shared], "  ")}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n${declarations(themed.dark, "    ")}\n  }\n}`,
  ].join("\n\n") + "\n";
}

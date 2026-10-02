import type { ChangedFile } from "./forge.ts";

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "deno.lock",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
]);

const MINIFIED = /[.-]min\.(js|mjs|cjs|css)$|\.(js|mjs|cjs|css)\.map$/i;

/** Build output wherever it appears, e.g. in a monorepo package. */
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", "__pycache__"]);

/** Build output only at the Repository's root; deeper down these names are often real source (src/build/). */
const ROOT_BUILD_OUTPUT_DIRECTORIES = new Set(["build", "out", "target", "obj", "coverage"]);

const BINARY_EXTENSIONS = new Set([
  // Images
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "tiff", "psd",
  // Fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // Audio and video
  "mp3", "wav", "ogg", "flac", "mp4", "mov", "avi", "webm", "mkv",
  // Archives
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war",
  // Documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  // Compiled code and data
  "exe", "dll", "so", "dylib", "a", "o", "class", "pyc", "wasm", "bin", "dat", "db", "sqlite", "lockb",
]);

/** A diff longer than this is too large to review in one Model call, especially on small local Models. */
const MAX_PATCH_CHARACTERS = 50_000;

/** Why a changed file should not be sent to the Model, or undefined if it should be reviewed. */
export function skipReason(file: ChangedFile): string | undefined {
  const segments = file.path.split("/");
  const name = segments.at(-1)!;
  const extension = name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
  if (LOCKFILES.has(name)) return "Lockfile";
  if (MINIFIED.test(name)) return "Minified asset";
  const directories = segments.slice(0, -1);
  const buildDirectory =
    directories.find((directory) => BUILD_OUTPUT_DIRECTORIES.has(directory)) ??
    (ROOT_BUILD_OUTPUT_DIRECTORIES.has(directories[0] ?? "") ? directories[0] : undefined);
  if (buildDirectory) return `In the build output directory ${buildDirectory}/`;
  // Checked after lockfiles, so bun.lockb reads as a lockfile rather than a binary.
  if (BINARY_EXTENSIONS.has(extension)) return "Binary file";
  // GitHub sends no diff for binary files and for diffs too large to show.
  if (file.patch.trim() === "") return "No diff available (a binary file, or a diff too large for GitHub to show)";
  if (file.patch.length > MAX_PATCH_CHARACTERS) {
    return `Too large to review (${file.patch.length.toLocaleString("en")} characters of diff, the limit is ${MAX_PATCH_CHARACTERS.toLocaleString("en")})`;
  }
  return undefined;
}

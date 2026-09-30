import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { designTokens } from "./design-tokens-plugin.ts";

export default defineConfig({
  plugins: [react(), designTokens(fileURLToPath(new URL("src/design-system/tokens.json", import.meta.url)))],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.DIFFWISE_PORT ?? 3001}` },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});

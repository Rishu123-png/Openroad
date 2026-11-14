import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/**
 * The ordinary suite: unit and scene tests on synthetic fixtures. It needs no
 * browser and no map data, so it runs anywhere, including CI.
 *
 * Kept apart on purpose: tests/real (the real district, when present) and
 * e2e (a browser).
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/*.test.ts"],
      // Scene tests build a whole district several times over.
      testTimeout: 30_000,
    },
  }),
);

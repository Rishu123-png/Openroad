import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/** Real-data integration tests. They skip, and say so, when the district file has not been built on this machine. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/real/*.real.test.ts"],
      testTimeout: 180_000,
      reporters: ["verbose"],
    },
  }),
);

import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    // Development only: reachable from other devices on the network and from
    // the hosted preview used during AI-agent sessions.
    host: true,
    allowedHosts: [".e2b.app"],
  },
  preview: { port: 4173, host: true, allowedHosts: [".e2b.app"] },
  build: { target: "es2022", sourcemap: true },
});

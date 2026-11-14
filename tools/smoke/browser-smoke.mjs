#!/usr/bin/env node
/**
 * Browser smoke test: the built game in a real (headless) browser.
 *
 *   npm run test:smoke                 build, serve, test
 *   npm run test:smoke -- --no-build   use the existing apps/web/dist
 *   npm run test:smoke -- --require    fail, instead of skipping, when no browser is available
 *
 * Needs a Chrome or Chromium. Set CHROME_PATH to its executable, or install
 * one in a usual place. Without a browser (or without the puppeteer-core
 * package) the test is SKIPPED, says so, and exits 0, so it never breaks a
 * machine that cannot run it.
 *
 * It runs on the SYNTHETIC district (tools/build-district.mjs --synthetic),
 * with traffic off so the pictures do not depend on random cars. When the
 * real Alpha 1 file has been built on this machine it also starts the game on
 * it; when it has not, that part is reported as SKIPPED.
 *
 * Screenshots are written to test-results/smoke/ for a person to look at.
 * They are not compared with anything: this is not a visual regression test.
 * No frame rate is asserted; software rendering makes it meaningless.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = resolve(root, "apps/web");
const args = process.argv.slice(2);
const required = args.includes("--require");
const out = resolve(root, "test-results/smoke");
const VIEWPORT = { width: 1280, height: 720 };

const banner = (lines) => console.log(["", "=".repeat(80), ...lines.map((l) => ` ${l}`), "=".repeat(80), ""].join("\n"));
function skip(reason) {
  banner(["BROWSER SMOKE TEST: SKIPPED", reason, "Nothing was checked in a browser and nothing is reported as passed."]);
  process.exit(required ? 1 : 0);
}

// ---- a browser
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((p) => p && existsSync(p));
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  skip("The puppeteer-core package is not installed. Run: npm install");
}
const chrome = findChrome();
if (!chrome) skip("No Chrome or Chromium was found. Install one, or set CHROME_PATH to its executable.");

// ---- the game, built and served
const syntheticFile = resolve(web, "public/regions/greater-noida/synthetic.json");
const realFile = resolve(web, "public/regions/greater-noida/alpha-1.json");
if (!existsSync(syntheticFile)) {
  const made = spawnSync(process.execPath, [resolve(root, "tools/build-district.mjs"), "--synthetic"], { stdio: "inherit" });
  if (made.status !== 0) throw new Error("Could not build the synthetic district.");
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (!args.includes("--no-build")) {
  const built = spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
} else if (!existsSync(resolve(web, "dist/index.html"))) throw new Error("apps/web/dist does not exist. Run without --no-build.");
const hasReal = existsSync(resolve(web, "dist/regions/greater-noida/alpha-1.json")) && existsSync(realFile);

const port = await new Promise((done, fail) => {
  const probe = createServer();
  probe.once("error", fail);
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => done(free));
  });
});
const server = spawn(npm, ["exec", "--", "vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: web, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => {
  try {
    if (process.platform === "win32") server.kill();
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 100 || server.exitCode !== null) {
    stopServer();
    throw new Error(`The preview server did not start.\n${serverLog}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}

// ---- checks
const results = [];
let failed = 0;
function check(name, ok, detail = "") {
  results.push(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "shell",
  // Software WebGL, so the test runs on machines without a GPU.
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio"],
});

/** Opens the game and collects everything the page complains about. */
async function open(query) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => void (m.type() === "error" && errors.push(`console.error: ${m.text()}`)));
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  page.on("response", (r) => void (r.status() >= 400 && errors.push(`HTTP ${r.status()}: ${r.url()}`)));
  await page.goto(`${base}?${query}`, { waitUntil: "load" });
  return { page, errors };
}
const state = (page) =>
  page.evaluate(() => {
    const g = window.openroad;
    const garage = document.querySelector(".or-garage");
    return {
      garageOpen: g.isGarageOpen, panelShown: Boolean(garage && !garage.hidden), panelName: document.querySelector(".or-garage-name")?.textContent ?? "",
      vehicle: g.selectedVehicle.id, carLength: g.selectedVehicle.length, view: g.camera.viewName,
      x: g.vehicle.x, z: g.vehicle.z, heading: g.vehicle.heading, speed: g.vehicle.speed, onRoad: g.vehicle.onRoad,
      saved: localStorage.getItem("openroad.vehicle"), detail: document.querySelector(".or-detail")?.textContent ?? "", status: document.querySelector(".or-status")?.textContent ?? "",
      error: (document.querySelector(".or-error")?.hidden === false ? document.querySelector(".or-error").textContent : ""), traffic: g.traffic.activeCount,
      canvas: [document.querySelector("canvas")?.width ?? 0, document.querySelector("canvas")?.height ?? 0],
    };
  });
/** A screenshot of a frame that has just been drawn. */
async function shot(page, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}
/** The share of screenshot pixels that differ from the commonest colour: zero for a blank canvas. */
async function drawnSomething(page) {
  return page.evaluate(async () => {
    const g = window.openroad;
    g.renderFrame();
    const pixels = await g.engine.readPixels(0, 0, g.engine.getRenderWidth(), g.engine.getRenderHeight());
    const seen = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 97) seen.add((pixels[i] >> 3) | ((pixels[i + 1] >> 3) << 5) | ((pixels[i + 2] >> 3) << 10));
    return seen.size;
  });
}

try {
  // ---------- startup, first visit
  const { page, errors } = await open("district=synthetic&traffic=0&inspect");
  await page.waitForFunction(() => window.openroad?.playerCar || document.querySelector(".or-error")?.hidden === false, { timeout: 120_000 });
  let s = await state(page);
  check("the game starts on the synthetic district without an error message", s.error === "", s.error);
  check("the canvas fills the window", s.canvas[0] >= VIEWPORT.width && s.canvas[1] >= VIEWPORT.height, s.canvas.join("x"));
  check("the page says the data is synthetic", (await page.evaluate(() => document.querySelector(".or-credit")?.textContent ?? "")).includes("SYNTHETIC"));
  check("a first visit opens the garage on the compact SUV", s.garageOpen && s.panelShown && s.vehicle === "compact-suv" && s.panelName === "Compact SUV", `${s.panelName}, open ${s.garageOpen}`);
  check("?traffic=0 gives an empty road", s.traffic === 0, `${s.traffic} cars`);
  check("the renderer draws a picture, not a blank canvas", (await drawnSomething(page)) > 50);
  await sleep(500);
  await shot(page, "garage-suv");

  // ---------- garage: selection
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.openroad.selectedVehicle.id === "compact-sedan", { timeout: 10_000 }).catch(() => {});
  s = await state(page);
  check("the right arrow shows the compact sedan, in the world and on the panel", s.vehicle === "compact-sedan" && s.panelName === "Compact sedan" && Math.abs(s.carLength - 3.995) < 1e-6, `${s.panelName}, ${s.carLength} m`);
  await sleep(500);
  await shot(page, "garage-sedan");
  await page.click('.or-garage button[aria-label="Previous vehicle"]');
  s = await state(page);
  check("the panel's own button changes the vehicle too", s.vehicle === "compact-suv", s.vehicle);
  await page.keyboard.press("KeyD");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !window.openroad.isGarageOpen, { timeout: 10_000 }).catch(() => {});
  s = await state(page);
  check("Enter closes the garage and spawns the chosen vehicle on the road", !s.garageOpen && !s.panelShown && s.vehicle === "compact-sedan" && s.onRoad && s.speed === 0, `${s.vehicle}, on road ${s.onRoad}`);
  check("the choice is saved", s.saved === "compact-sedan", String(s.saved));
  const spawn = { x: s.x, z: s.z };

  // ---------- camera
  await sleep(300);
  await shot(page, "chase");
  const views = [s.view];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("KeyC");
    views.push((await state(page)).view);
    if (i === 0) {
      await sleep(300);
      await shot(page, "bonnet");
    }
  }
  check("C cycles Chase, Bonnet, High, Overview and back", views.join(",") === "Chase,Bonnet,High,Overview,Chase", views.join(","));

  // ---------- driving, with real key events and the game's own loop
  await page.keyboard.down("KeyW");
  await page.waitForFunction((z) => window.openroad.vehicle.z - z > 6 && window.openroad.vehicle.speed > 2, { timeout: 30_000 }, spawn.z).catch(() => {});
  s = await state(page);
  check("holding W drives the car forward along its road", s.z - spawn.z > 6 && s.speed > 2 && s.onRoad, `${(s.z - spawn.z).toFixed(1)} m, ${s.speed.toFixed(1)} m/s`);
  await shot(page, "street");
  await page.keyboard.down("KeyD");
  await page.waitForFunction(() => window.openroad.vehicle.heading > 0.15, { timeout: 15_000 }).catch(() => {});
  await page.keyboard.up("KeyD");
  s = await state(page);
  check("D steers to the right", s.heading > 0.15, `heading ${s.heading.toFixed(2)} rad`);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.openroad.vehicle.speed === 0, { timeout: 20_000 }).catch(() => {});
  await page.keyboard.up("Space");
  s = await state(page);
  check("Space stops the car", s.speed === 0, `${s.speed.toFixed(2)} m/s`);
  await page.keyboard.press("KeyR");
  s = await state(page);
  check("R puts the car back at the start", Math.hypot(s.x - spawn.x, s.z - spawn.z) < 0.01 && s.speed === 0);

  // ---------- statistics from a real renderer
  await page.waitForFunction(() => /\d+ draw calls/.test(document.querySelector(".or-detail")?.textContent ?? ""), { timeout: 10_000 }).catch(() => {});
  s = await state(page);
  const numbers = /(\d+) draw calls · (\d+) meshes · (\d+)k triangles/.exec(s.detail);
  check("the overlay reports draw calls, meshes and triangles above zero", Boolean(numbers) && Number(numbers[1]) > 0 && Number(numbers[2]) > 0 && Number(numbers[3]) > 0, s.detail);

  // ---------- after a reload
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.openroad?.playerCar, { timeout: 120_000 });
  s = await state(page);
  check("after a reload the saved vehicle is spawned and the garage stays closed", s.vehicle === "compact-sedan" && !s.garageOpen && !s.panelShown, `${s.vehicle}, open ${s.garageOpen}`);
  await page.keyboard.press("KeyG");
  s = await state(page);
  check("G opens the garage again", s.garageOpen && s.panelShown);
  await page.keyboard.press("Enter");
  check("no uncaught errors, failed requests or console errors on the synthetic district", errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.close();

  // ---------- default traffic on a real renderer
  {
    const { page: p, errors: e } = await open("district=synthetic&inspect");
    await p.waitForFunction(() => window.openroad?.playerCar, { timeout: 120_000 });
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => window.openroad.traffic.activeCount > 0, { timeout: 20_000 }).catch(() => {});
    await sleep(2000);
    const t = await p.evaluate(() => {
      const g = window.openroad;
      return { count: g.traffic.activeCount, moving: g.traffic.cars.filter((c) => c.active && c.speed > 0.5).length, bad: g.traffic.cars.filter((c) => c.active && g.world.buildingIndex.at(c.x, c.z)).length };
    });
    check("default traffic appears, moves, and keeps out of buildings", t.count === 12 && t.moving > 0 && t.bad === 0, JSON.stringify(t));
    check("no uncaught errors with traffic running", e.length === 0, e.slice(0, 5).join(" | "));
    await p.close();
  }

  // ---------- the real district, when it has been built here
  if (hasReal) {
    const { page: p, errors: e } = await open("traffic=0&inspect");
    await p.waitForFunction(() => window.openroad?.playerCar || document.querySelector(".or-error")?.hidden === false, { timeout: 180_000 });
    const r = await state(p);
    check("REAL DATA: the game starts on the real Alpha 1 district", r.error === "" && r.onRoad, r.error);
    check("REAL DATA: the page does not call it synthetic", !(await p.evaluate(() => document.querySelector(".or-credit")?.textContent ?? "")).includes("SYNTHETIC"));
    await p.keyboard.press("Enter");
    await sleep(500);
    await shot(p, "alpha1-street");
    check("REAL DATA: no uncaught errors", e.length === 0, e.slice(0, 5).join(" | "));
    await p.close();
  }
} catch (error) {
  check("the smoke test ran to the end", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  stopServer();
}

banner([
  `BROWSER SMOKE TEST: ${failed === 0 ? "PASSED" : "FAILED"}  (${results.length - failed} of ${results.length} checks, SYNTHETIC district, ${VIEWPORT.width}x${VIEWPORT.height}, software WebGL)`,
  hasReal ? "Real Alpha 1 district: checked (lines marked REAL DATA)." : "Real Alpha 1 district: SKIPPED. alpha-1.json has not been built on this machine; no real-data check ran.",
  `Screenshots for review (not compared): ${out}`,
]);
console.log(results.join("\n"), "\n");
process.exit(failed === 0 ? 0 : 1);

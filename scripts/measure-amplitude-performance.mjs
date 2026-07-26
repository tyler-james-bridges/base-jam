#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const outputPath = path.resolve(
  process.env.OUTPUT_PATH ??
    path.join(
      process.cwd(),
      "test-results",
      "amplitude-hardware-performance.json",
    ),
);
const runCount = Number(process.env.RUN_COUNT ?? 5);
const warmupMs = Number(process.env.WARMUP_MS ?? 3_000);
const sampleMs = Number(process.env.SAMPLE_MS ?? 15_000);
const headed = process.env.HEADED !== "0";

const profiles = [
  {
    name: "desktop-1440x900",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  },
  {
    name: "phone-390x844",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
];

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1,
  );
  return Number(sorted[index].toFixed(3));
}

function summarize(samples) {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample) && sample > 0)
    .sort((left, right) => left - right);
  const mean =
    sorted.reduce((total, sample) => total + sample, 0) /
    Math.max(1, sorted.length);
  return {
    sampleCount: sorted.length,
    meanDeltaMs: Number(mean.toFixed(3)),
    estimatedMeanFps: Number((1_000 / mean).toFixed(2)),
    p50DeltaMs: percentile(sorted, 0.5),
    p95DeltaMs: percentile(sorted, 0.95),
    p99DeltaMs: percentile(sorted, 0.99),
    framesOver33Ms: sorted.filter((sample) => sample > 33.34).length,
    percentFramesOver33Ms: Number(
      (
        (sorted.filter((sample) => sample > 33.34).length /
          Math.max(1, sorted.length)) *
        100
      ).toFixed(3),
    ),
  };
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: 1,
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /Tap to start/i }).click();
  await page.locator(".base-jam-reactor-stage canvas").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.bringToFront();

  const result = await page.evaluate(
    ({ duration, warmup }) =>
      new Promise((resolve) => {
        const canvas = document.querySelector(
          ".base-jam-reactor-stage canvas",
        );
        const gl =
          canvas instanceof HTMLCanvasElement
            ? canvas.getContext("webgl2") ?? canvas.getContext("webgl")
            : null;
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        const renderer =
          gl && debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : gl?.getParameter(gl.RENDERER) ?? "unknown";
        const vendor =
          gl && debug
            ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
            : gl?.getParameter(gl.VENDOR) ?? "unknown";
        const samples = [];
        const startedAt = performance.now();
        const measureAt = startedAt + warmup;
        const finishAt = measureAt + duration;
        let lastFrameAt = null;
        let lastCue = -1;
        let pointerId = 500;

        const dispatchReadyCue = () => {
          const stage = document.querySelector(
            ".base-jam-reactor-stage",
          );
          const game = document.querySelector(".pulse-game-layout");
          const surface = document.querySelector(".pulse-tap-surface");
          if (
            stage?.getAttribute("data-cue-ready") !== "true" ||
            !(surface instanceof HTMLElement)
          ) {
            return;
          }
          const cue = Number(game?.getAttribute("data-current-cue"));
          if (!Number.isFinite(cue) || cue === lastCue) return;
          lastCue = cue;
          pointerId += 1;
          const route =
            game?.getAttribute("data-expected-route") ?? "tap";
          const bounds = surface.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const deltaX = route === "left" ? -80 : route === "right" ? 80 : 0;
          surface.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: 1,
              clientX: x,
              clientY: y,
              isPrimary: true,
              pointerId,
              pointerType: "touch",
            }),
          );
          surface.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              cancelable: true,
              button: 0,
              buttons: 0,
              clientX: x + deltaX,
              clientY: y,
              isPrimary: true,
              pointerId,
              pointerType: "touch",
            }),
          );
        };

        const frame = (at) => {
          dispatchReadyCue();
          if (at >= measureAt && lastFrameAt !== null) {
            samples.push(at - lastFrameAt);
          }
          lastFrameAt = at;
          if (at < finishAt) {
            requestAnimationFrame(frame);
            return;
          }
          const stage = document.querySelector(
            ".base-jam-reactor-stage",
          );
          resolve({
            renderer,
            vendor,
            visibility: document.visibilityState,
            samples,
            drawCalls: Number(stage?.getAttribute("data-draw-calls")),
            triangles: Number(stage?.getAttribute("data-triangles")),
          });
        };
        requestAnimationFrame(frame);
      }),
    { duration: sampleMs, warmup: warmupMs },
  );
  await context.close();
  return {
    errors,
    renderer: result.renderer,
    vendor: result.vendor,
    visibility: result.visibility,
    drawCalls: result.drawCalls,
    triangles: result.triangles,
    ...summarize(result.samples),
  };
}

await mkdir(path.dirname(outputPath), { recursive: true });
const report = {
  createdAt: new Date().toISOString(),
  baseUrl,
  headed,
  runCount,
  warmupMs,
  sampleMs,
  browser: null,
  profiles: {},
};

let browser;
try {
  browser = await chromium.launch({
    channel: "chrome",
    headless: !headed,
    args: [
      "--use-angle=metal",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
  report.browser = await browser.version();
  for (const profile of profiles) {
    report.profiles[profile.name] = [];
    for (let index = 0; index < runCount; index += 1) {
      process.stdout.write(
        `${profile.name} hardware run ${index + 1}/${runCount}\n`,
      );
      report.profiles[profile.name].push(
        await runProfile(browser, profile),
      );
    }
  }
} finally {
  await browser?.close().catch(() => {});
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Performance report: ${outputPath}\n`);
}

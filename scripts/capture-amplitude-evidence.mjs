#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const CAPTURE_TIMEOUT_MS = 12_000;
const INPUT_SETTLE_MS = 115;
// One p95 frame on the software-rendered desktop evidence profile. This still
// rejects the old +200.5ms capture while allowing one compositor frame of
// headless variance around the requested gameplay state.
const CAPTURE_TIMING_TOLERANCE_MS = 84;
const EVIDENCE_HEADED = process.env.EVIDENCE_HEADED === "1";
const MEDIA_RECORDING_FRAME_RATE = 60;
const EVENT_CUE_COUNTS = [2, 2, 3, 3, 3, 3, 3, 4, 4, 4];

const blockHash =
  "0x8f31a843fc6cd24af9e31f153b712bf3a4b95800997d580cc5f21f1c889ca07f";
const digest =
  "0x6cbf2efda67befa88d7d447669bfb3fafb3cb63cfe5f5af2b87ccb827564aebb";

const pieces = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
  type: "0x2",
  from: `0x${"1".repeat(39)}${index.toString(16)}`.slice(0, 42),
  to: `0x${"2".repeat(39)}${index.toString(16)}`.slice(0, 42),
  value: String(index * 1_000_000_000_000),
  calldataBytes: 4 + index * 17,
  selector: "0xa9059cbb",
  gasLimit: String(21_000 + index * 30_000),
  maxFeePerGas: String(1_000_000 + index * 400_000),
  maxPriorityFeePerGas: "100000",
}));

const fixtureLevel = {
  schemaVersion: "1",
  rulesetVersion: "base-jam-v1",
  chainId: 8453,
  ranked: true,
  source: {
    kind: "base",
    number: "48725123",
    hash: blockHash,
    timestamp: "2026-07-17T20:00:00.000Z",
    gasUsed: "21400000",
    gasLimit: "400000000",
    baseFeePerGas: "5000000",
    txCount: 144,
    explorerUrl: "https://basescan.org/block/48725123",
    confirmations: 3,
  },
  seed: digest,
  digest,
  pieces,
  generatedAt: "2026-07-17T20:00:00.000Z",
};

const captureProfiles = [
  {
    name: "desktop-1440x900",
    viewport: { width: 1440, height: 900 },
    mobile: false,
  },
  {
    name: "phone-390x844",
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
];

function normalizedBaseUrl(input) {
  const withProtocol = /^https?:\/\//i.test(input)
    ? input
    : `http://${input}`;
  return withProtocol.replace(/\/+$/, "");
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }
  return { message: String(error), name: "UnknownError", stack: null };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return Number(sorted[index].toFixed(3));
}

function frameStats(samples) {
  const finite = samples.filter(
    (sample) => Number.isFinite(sample) && sample > 0,
  );
  const active = finite.filter((sample) => sample <= 250);
  const sorted = [...active].sort((left, right) => left - right);
  const mean =
    active.length > 0
      ? active.reduce((total, sample) => total + sample, 0) / active.length
      : null;
  return {
    sampleCount: active.length,
    excludedAutomationPauses: finite.length - active.length,
    meanDeltaMs: mean === null ? null : Number(mean.toFixed(3)),
    estimatedMeanFps:
      mean === null ? null : Number((1_000 / mean).toFixed(2)),
    p50DeltaMs: percentile(sorted, 0.5),
    p95DeltaMs: percentile(sorted, 0.95),
    p99DeltaMs: percentile(sorted, 0.99),
    maxDeltaMs:
      sorted.length === 0
        ? null
        : Number(sorted[sorted.length - 1].toFixed(3)),
    framesOver25Ms: active.filter((sample) => sample > 25).length,
    framesOver33Ms: active.filter((sample) => sample > 33.34).length,
    rawSamplesMs: finite.map((sample) => Number(sample.toFixed(3))),
  };
}

async function assertServerAvailable(baseUrl) {
  let response;
  try {
    response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${baseUrl}. Start the local app first (for example, pnpm dev). ${serializeError(error).message}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Expected ${baseUrl} to return a playable page, received HTTP ${response.status}.`,
    );
  }
}

async function mockPlayableApi(page) {
  await page.route("**/api/levels/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ level: fixtureLevel }),
    });
  });
  await page.route("**/api/mixes/latest", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        levels: Array.from({ length: 15 }, () => fixtureLevel),
      }),
    });
  });
}

async function installBrowserTelemetry(page) {
  await page.addInitScript(() => {
    // PulseAudioEngine reads this before construction and exposes only its
    // post-compressor MediaStream. Normal gameplay never creates this tap.
    window.__BASE_JAM_AUDIO_EVIDENCE_ENABLED__ = true;
    const documentHasFocusDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "hasFocus",
    );
    window.__setAmplitudeEvidencePaused = (paused) => {
      if (paused) {
        Object.defineProperty(document, "hasFocus", {
          configurable: true,
          value: () => false,
        });
        window.dispatchEvent(new Event("blur"));
        return;
      }
      if (documentHasFocusDescriptor) {
        Object.defineProperty(
          document,
          "hasFocus",
          documentHasFocusDescriptor,
        );
      } else {
        delete document.hasFocus;
      }
      window.dispatchEvent(new Event("focus"));
    };

    const telemetry = {
      timeOrigin: performance.timeOrigin,
      installedAt: performance.now(),
      frames: [],
      inputs: [],
      marks: [],
      mutations: [],
      feedback: [],
      stopped: false,
    };
    window.__amplitudeEvidence = telemetry;
    window.__readAmplitudeEvidenceSnapshot = () => {
      const element = (selector) => document.querySelector(selector);
      const rect = (selector) => {
        const target = element(selector);
        if (!(target instanceof HTMLElement)) return null;
        const bounds = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        return {
          x: Number(bounds.x.toFixed(3)),
          y: Number(bounds.y.toFixed(3)),
          width: Number(bounds.width.toFixed(3)),
          height: Number(bounds.height.toFixed(3)),
          top: Number(bounds.top.toFixed(3)),
          right: Number(bounds.right.toFixed(3)),
          bottom: Number(bounds.bottom.toFixed(3)),
          left: Number(bounds.left.toFixed(3)),
          fontSize: style.fontSize,
          visibility: style.visibility,
          display: style.display,
        };
      };
      const game = element(".pulse-game-layout");
      const board = element(".base-jam-pulse-canvas");
      const stage = element(".base-jam-reactor-stage");
      const target = element(".blockstream-stage__target");
      const documentElement = document.documentElement;
      return {
        at: performance.now(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        dataset: {
          game: game instanceof HTMLElement ? { ...game.dataset } : null,
          board: board instanceof HTMLElement ? { ...board.dataset } : null,
          stage: stage instanceof HTMLElement ? { ...stage.dataset } : null,
        },
        feedback: {
          className: target?.getAttribute("class") ?? null,
          text: target?.textContent?.trim() ?? null,
          notice:
            element(".pulse-notice")?.textContent?.trim() ?? null,
        },
        render: {
          drawCalls: Number(
            stage?.getAttribute("data-draw-calls") ?? 0,
          ),
          triangles: Number(
            stage?.getAttribute("data-triangles") ?? 0,
          ),
        },
        overflow: {
          scrollWidth: documentElement.scrollWidth,
          scrollHeight: documentElement.scrollHeight,
          horizontalPixels: Math.max(
            0,
            documentElement.scrollWidth - window.innerWidth,
          ),
          verticalPixels: Math.max(
            0,
            documentElement.scrollHeight - window.innerHeight,
          ),
        },
        anchors: {
          game: rect(".pulse-game-layout"),
          hud: rect(".pulse-game-hud"),
          live: rect(".pulse-live-chip"),
          stems: rect(".pulse-channel-statuses"),
          phrase: rect(".pulse-phrase-status"),
          clock: rect(".pulse-clock"),
          stage: rect(".base-jam-reactor-stage"),
          canvas: rect(".base-jam-reactor-stage canvas"),
          target: rect(".blockstream-stage__target"),
          targetCommand: rect(".blockstream-stage__target strong"),
          targetDetail: rect(".blockstream-stage__target span"),
          mute: rect(".pulse-mute"),
        },
      };
    };

    let previousFrame = null;
    const sampleFrame = (now) => {
      if (telemetry.stopped) return;
      if (previousFrame !== null && telemetry.frames.length < 10_000) {
        telemetry.frames.push(now - previousFrame);
      }
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);

    const observedAttributes = new Set([
      "class",
      "data-active-face",
      "data-channel-captures",
      "data-combo",
      "data-cue-ready",
      "data-current-cue",
      "data-current-event",
      "data-current-step",
      "data-draw-calls",
      "data-expected-route",
      "data-hits",
      "data-last-gesture",
      "data-last-route",
      "data-misses",
      "data-playback-phase",
      "data-sealed",
      "data-target-face",
      "data-triangles",
      "data-tutorial-step",
      "data-wrong",
    ]);
    const lastValues = new Map();

    const nodeName = (element) => {
      if (!(element instanceof Element)) return null;
      if (element.matches(".pulse-game-layout")) return "game";
      if (element.matches(".base-jam-pulse-canvas")) return "board";
      if (element.matches(".base-jam-reactor-stage")) return "stage";
      if (element.matches(".blockstream-stage__target")) return "target";
      if (element.matches(".pulse-notice")) return "notice";
      return null;
    };

    const pushMutation = (node, attribute, value) => {
      const key = `${node}:${attribute}`;
      if (lastValues.get(key) === value) return;
      lastValues.set(key, value);
      if (telemetry.mutations.length < 5_000) {
        telemetry.mutations.push({
          at: performance.now(),
          node,
          attribute,
          value,
        });
      }
    };

    const pushFeedback = (element) => {
      const target =
        element.closest?.(".blockstream-stage__target, .pulse-notice") ??
        null;
      if (!target) return;
      const node = nodeName(target);
      const value = `${target.getAttribute("class") ?? ""}|${target.textContent?.trim() ?? ""}`;
      const key = `feedback:${node}`;
      if (lastValues.get(key) === value) return;
      lastValues.set(key, value);
      if (telemetry.feedback.length < 1_000) {
        telemetry.feedback.push({
          at: performance.now(),
          node,
          className: target.getAttribute("class"),
          text: target.textContent?.trim() ?? "",
        });
      }
    };

    const startObserver = () => {
      const root = document.documentElement;
      if (!root) return;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const element =
            record.target instanceof Element
              ? record.target
              : record.target.parentElement;
          if (!element) continue;
          if (record.type === "attributes") {
            const attribute = record.attributeName;
            const node = nodeName(element);
            if (
              node &&
              attribute &&
              observedAttributes.has(attribute) &&
              (attribute !== "class" || node === "target")
            ) {
              pushMutation(
                node,
                attribute,
                element.getAttribute(attribute),
              );
            }
          }
          if (
            record.type === "childList" ||
            record.type === "characterData" ||
            element.closest?.(
              ".blockstream-stage__target, .pulse-notice",
            )
          ) {
            pushFeedback(element);
          }
        }
      });
      observer.observe(root, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      window.__amplitudeEvidenceObserver = observer;
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startObserver, {
        once: true,
      });
    } else {
      startObserver();
    }
  });
}

async function readGameState(page) {
  return page.evaluate(() => {
    const game = document.querySelector(".pulse-game-layout");
    const stage = document.querySelector(".base-jam-reactor-stage");
    const board = document.querySelector(".base-jam-pulse-canvas");
    const number = (value, fallback = 0) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      at: performance.now(),
      activeFace: number(game?.getAttribute("data-active-face")),
      combo: number(game?.getAttribute("data-combo")),
      currentCue: number(game?.getAttribute("data-current-cue")),
      currentEvent: number(game?.getAttribute("data-current-event")),
      currentStep: number(game?.getAttribute("data-current-step"), -16),
      expectedRoute: game?.getAttribute("data-expected-route") ?? null,
      hits: number(game?.getAttribute("data-hits")),
      misses: number(game?.getAttribute("data-misses")),
      sealed: number(game?.getAttribute("data-sealed")),
      tutorialStep: number(game?.getAttribute("data-tutorial-step")),
      wrong: number(game?.getAttribute("data-wrong")),
      cueReady: stage?.getAttribute("data-cue-ready") === "true",
      targetFace: number(stage?.getAttribute("data-target-face")),
      playbackPhase: board?.getAttribute("data-playback-phase") ?? null,
    };
  });
}

async function readDomSnapshot(page) {
  return page.evaluate(() => {
    if (typeof window.__readAmplitudeEvidenceSnapshot !== "function") {
      throw new Error("The amplitude evidence snapshot reader is unavailable.");
    }
    return window.__readAmplitudeEvidenceSnapshot();
  });
}

async function waitForAnimationFrames(page, count = 2) {
  await page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        let remaining = frames;
        const next = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
          } else {
            requestAnimationFrame(next);
          }
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

async function waitUntilPerformanceTime(
  page,
  targetAt,
  includeSnapshot = false,
) {
  return page.evaluate(
    ({ shouldIncludeSnapshot, target }) =>
      new Promise((resolve) => {
        const check = () => {
          const now = performance.now();
          if (now >= target) {
            if (shouldIncludeSnapshot) {
              if (
                typeof window.__readAmplitudeEvidenceSnapshot !==
                "function"
              ) {
                throw new Error(
                  "The amplitude evidence snapshot reader is unavailable.",
                );
              }
              const snapshot =
                window.__readAmplitudeEvidenceSnapshot();
              resolve({
                reachedAt: snapshot.at,
                snapshot,
              });
            } else {
              resolve(performance.now());
            }
          } else {
            setTimeout(check, Math.max(0, target - now));
          }
        };
        check();
      }),
    {
      shouldIncludeSnapshot: includeSnapshot,
      target: targetAt,
    },
  );
}

async function waitForCueReady(page, minimumCue) {
  await page.waitForFunction(
    (minimum) => {
      const game = document.querySelector(".pulse-game-layout");
      const stage = document.querySelector(".base-jam-reactor-stage");
      return (
        Number(game?.getAttribute("data-current-cue")) >= minimum &&
        stage?.getAttribute("data-cue-ready") === "true"
      );
    },
    minimumCue,
    { polling: "raf", timeout: CAPTURE_TIMEOUT_MS },
  );
}

let pointerSequence = 100;

async function dispatchGestureInPage(
  page,
  route,
  label,
  captureOffsetMs,
  minimumCue = null,
) {
  pointerSequence += 1;
  return page.evaluate(
    ({
      captureOffset,
      inputLabel,
      inputRoute,
      minimumReadyCue,
      pointerId,
    }) => {
      const performGesture = () => {
      const surface = document.querySelector(".pulse-tap-surface");
      const game = document.querySelector(".pulse-game-layout");
      if (!(surface instanceof HTMLElement)) {
        throw new Error("The pulse tap surface is not mounted.");
      }
      const expectedRoute =
        game?.getAttribute("data-expected-route") ?? "tap";
      const resolvedInputRoute =
        inputRoute === "__expected"
          ? expectedRoute
          : inputRoute === "__opposite"
            ? expectedRoute === "left"
              ? "right"
              : expectedRoute === "right"
                ? "left"
                : "right"
            : inputRoute;
      const bounds = surface.getBoundingClientRect();
      const startX = bounds.left + bounds.width / 2;
      const startY = bounds.top + bounds.height / 2;
      const deltaX =
        resolvedInputRoute === "left"
          ? -80
          : resolvedInputRoute === "right"
            ? 80
            : 0;
      const id = `${inputLabel}:${pointerId}`;
      const dataset = () => ({
        activeFace: game?.getAttribute("data-active-face") ?? null,
        currentCue: game?.getAttribute("data-current-cue") ?? null,
        expectedRoute: game?.getAttribute("data-expected-route") ?? null,
        hits: game?.getAttribute("data-hits") ?? null,
        misses: game?.getAttribute("data-misses") ?? null,
        wrong: game?.getAttribute("data-wrong") ?? null,
      });
      const before = dataset();
      const pointerDownAt = performance.now();
      surface.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 1,
          clientX: startX,
          clientY: startY,
          isPrimary: true,
          pointerId,
          pointerType: "touch",
        }),
      );
      const pointerUpStartedAt = performance.now();
      surface.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 0,
          clientX: startX + deltaX,
          clientY: startY,
          isPrimary: true,
          pointerId,
          pointerType: "touch",
        }),
      );
      const pointerUpCompletedAt = performance.now();
      const record = {
        id,
        label: inputLabel,
        route: resolvedInputRoute,
        pointerId,
        pointerDownAt,
        pointerUpStartedAt,
        pointerUpCompletedAt,
        dispatchDurationMs: pointerUpCompletedAt - pointerDownAt,
        captureOffsetMs: captureOffset,
        capturePoint:
          captureOffset === null
            ? null
            : {
                requestedAt: pointerDownAt + captureOffset,
                actualAt: null,
                snapshot: null,
              },
        before,
        immediatelyAfter: dataset(),
        firstFrameAt: null,
        firstFrameTimestamp: null,
      };
      window.__amplitudeEvidence?.inputs.push(record);
      window.__amplitudeEvidence?.marks.push({
        at: pointerDownAt,
        kind: "input",
        id,
      });
      if (record.capturePoint) {
        const captureClock = new MessageChannel();
        const captureWhenDue = () => {
          const now = performance.now();
          if (now < record.capturePoint.requestedAt) {
            captureClock.port2.postMessage(null);
            return;
          }
          captureClock.port1.close();
          captureClock.port2.close();
          record.capturePoint.schedulerReachedAt = now;
          // Let the already-registered React Three Fiber frame consume the
          // input before freezing. A timer-only snapshot can otherwise label
          // stale scene telemetry as a hit or route switch.
          requestAnimationFrame(() => {
            const renderedAt = performance.now();
            record.capturePoint.actualAt = renderedAt;
            record.capturePoint.snapshot =
              typeof window.__readAmplitudeEvidenceSnapshot === "function"
                ? window.__readAmplitudeEvidenceSnapshot()
                : null;
            window.__setAmplitudeEvidencePaused?.(true);
            record.capturePoint.pausedAt = performance.now();
            window.__amplitudeEvidence?.marks.push({
              at: renderedAt,
              kind: "rendered-state-capture",
              id,
            });
          });
        };
        captureClock.port1.addEventListener("message", captureWhenDue);
        captureClock.port1.start();
        captureClock.port2.postMessage(null);
      }
      requestAnimationFrame((at) => {
        // The rAF timestamp is the frame start and can predate an input
        // dispatched later in that same frame. performance.now() here is the
        // first observable render callback after the input.
        record.firstFrameAt = performance.now();
        record.firstFrameTimestamp = at;
      });
      return { ...record };
      };

      if (minimumReadyCue === null) {
        return performGesture();
      }

      return new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const attempt = () => {
          const game = document.querySelector(".pulse-game-layout");
          const stage = document.querySelector(
            ".base-jam-reactor-stage",
          );
          if (
            Number(game?.getAttribute("data-current-cue")) >=
              minimumReadyCue &&
            stage?.getAttribute("data-cue-ready") === "true"
          ) {
            resolve(performGesture());
            return;
          }
          if (performance.now() - startedAt > 4_000) {
            reject(
              new Error(
                `Timed out waiting to atomically dispatch cue ${minimumReadyCue}.`,
              ),
            );
            return;
          }
          requestAnimationFrame(attempt);
        };
        attempt();
      });
    },
    {
      captureOffset: captureOffsetMs,
      inputLabel: label,
      inputRoute: route,
      minimumReadyCue: minimumCue,
      pointerId: pointerSequence,
    },
  );
}

async function captureScreenshot({
  page,
  outputDirectory,
  outputRoot,
  run,
  name,
  timing = null,
  snapshot = null,
  requestedAt = null,
  deferSnapshotUntilAfterCapture = false,
  pauseBeforeCapture = false,
  semantics = null,
}) {
  const absolutePath = path.join(outputDirectory, `${name}.png`);
  const before =
    snapshot ??
    (deferSnapshotUntilAfterCapture
      ? null
      : await readDomSnapshot(page));
  const requestTimestamp =
    requestedAt ?? before?.at ?? timing?.frameReachedAt;
  const actualAt = timing?.frameReachedAt ?? before?.at ?? requestTimestamp;
  const screenshotWallStartedAt = Date.now();
  try {
    if (pauseBeforeCapture) {
      await page.evaluate(() => {
        window.__setAmplitudeEvidencePaused?.(true);
      });
    }
    await page.screenshot({
      path: absolutePath,
      fullPage: false,
      animations: "allow",
      caret: "hide",
    });
  } finally {
    if (pauseBeforeCapture || timing?.inputAt !== undefined) {
      await page.evaluate(() => {
        window.__setAmplitudeEvidencePaused?.(false);
      });
    }
  }
  const screenshotWallDurationMs = Date.now() - screenshotWallStartedAt;
  const completedAt = await page.evaluate(() => performance.now());
  const resolvedSnapshot = before ?? (await readDomSnapshot(page));
  const resolvedTiming =
    timing?.inputAt === undefined
      ? timing
      : {
          ...timing,
          requestedAt: requestTimestamp,
          actualAt,
          actualOffsetMs: Number(
            (actualAt - timing.inputAt).toFixed(3),
          ),
          timingErrorMs: Number(
            (
              actualAt -
              timing.inputAt -
              timing.requestedOffsetMs
            ).toFixed(3),
          ),
          toleranceMs: CAPTURE_TIMING_TOLERANCE_MS,
          withinTolerance:
            Math.abs(
              actualAt -
                timing.inputAt -
                timing.requestedOffsetMs,
            ) <= CAPTURE_TIMING_TOLERANCE_MS,
          actualBasis:
            timing.actualBasis ?? "browser high-resolution timer",
          screenshotCompletedAt: completedAt,
        };
  const capture = {
    name,
    path: path.relative(outputRoot, absolutePath),
    absolutePath,
    requestedAt: requestTimestamp,
    actualAt,
    actualBasis:
      timing?.frameReachedAt === undefined
        ? "pre-capture DOM snapshot"
        : (timing.actualBasis ?? "browser high-resolution timer"),
    requestToActualMs: Number(
      (actualAt - requestTimestamp).toFixed(3),
    ),
    completedAt,
    captureDurationMs: screenshotWallDurationMs,
    requestToCompletedMs: Number(
      (completedAt - requestTimestamp).toFixed(3),
    ),
    timing: resolvedTiming,
    snapshot: resolvedSnapshot,
    snapshotAt: resolvedSnapshot.at,
    semantics,
  };
  run.screenshots.push(capture);
  assertCaptureSemantics(capture);
  if (resolvedTiming?.withinTolerance === false) {
    throw new Error(
      `${name} missed its ${resolvedTiming.requestedOffsetMs}ms evidence timing: actual ${resolvedTiming.actualOffsetMs}ms, error ${resolvedTiming.timingErrorMs}ms, tolerance ±${resolvedTiming.toleranceMs}ms.`,
    );
  }
  return capture;
}

function assertCaptureSemantics(capture) {
  const expected = capture.semantics;
  if (!expected) return;

  const stage = capture.snapshot?.dataset?.stage ?? {};
  const game = capture.snapshot?.dataset?.game ?? {};
  const failures = [];
  const oneOf = (actual, values, label) => {
    if (values && !values.includes(actual)) {
      failures.push(`${label}=${JSON.stringify(actual)} not in ${JSON.stringify(values)}`);
    }
  };
  const equals = (actual, value, label) => {
    if (value !== undefined && actual !== String(value)) {
      failures.push(`${label}=${JSON.stringify(actual)} expected ${JSON.stringify(String(value))}`);
    }
  };
  const atLeast = (actual, value, label) => {
    if (value !== undefined && Number(actual) < value) {
      failures.push(`${label}=${JSON.stringify(actual)} expected >= ${value}`);
    }
  };

  oneOf(stage.sceneState, expected.sceneStates, "sceneState");
  oneOf(stage.lastOutcome, expected.outcomes, "lastOutcome");
  oneOf(stage.cuePhase, expected.cuePhases, "cuePhase");
  equals(stage.routeSettled, expected.routeSettled, "routeSettled");
  equals(stage.processorOpen, expected.processorOpen, "processorOpen");
  equals(stage.cueReady, expected.cueReady, "cueReady");
  equals(stage.cueRoute, expected.cueRoute, "cueRoute");
  atLeast(
    stage.visibleDecisions,
    expected.minVisibleDecisions,
    "visibleDecisions",
  );
  atLeast(game.hits, expected.minHits, "hits");
  atLeast(game.sealed, expected.minSealed, "sealed");
  atLeast(game.wrong, expected.minWrong, "wrong");
  atLeast(game.misses, expected.minMisses, "misses");

  if (
    expected.activeFaceNot !== undefined &&
    game.activeFace === String(expected.activeFaceNot)
  ) {
    failures.push(
      `activeFace=${JSON.stringify(game.activeFace)} must differ from ${JSON.stringify(String(expected.activeFaceNot))}`,
    );
  }
  if (
    expected.maxFeedbackAgeMs !== undefined &&
    (Number(stage.feedbackAgeMs) < 0 ||
      Number(stage.feedbackAgeMs) > expected.maxFeedbackAgeMs)
  ) {
    failures.push(
      `feedbackAgeMs=${JSON.stringify(stage.feedbackAgeMs)} expected 0..${expected.maxFeedbackAgeMs}`,
    );
  }
  if (
    expected.maxAbsoluteCueDeltaMs !== undefined &&
    Math.abs(Number(stage.cueDeltaMs)) >
      expected.maxAbsoluteCueDeltaMs
  ) {
    failures.push(
      `cueDeltaMs=${JSON.stringify(stage.cueDeltaMs)} expected |delta| <= ${expected.maxAbsoluteCueDeltaMs}`,
    );
  }
  if (
    expected.forbidFeedbackPattern &&
    expected.forbidFeedbackPattern.some((value) =>
      capture.snapshot?.feedback?.text?.includes(value),
    )
  ) {
    failures.push(
      `feedback=${JSON.stringify(capture.snapshot?.feedback?.text)} contains a forbidden state`,
    );
  }

  capture.semanticAssertion = {
    expected,
    failures,
    passed: failures.length === 0,
  };
  if (failures.length > 0) {
    throw new Error(
      `${capture.name} semantic evidence mismatch: ${failures.join("; ")}.`,
    );
  }
}

async function captureAtInputOffset({
  page,
  input,
  offsetMs,
  ...captureOptions
}) {
  const targetAt = input.pointerDownAt + offsetMs;
  const capturePoint = await page.evaluate(
    ({ inputId, requestedOffset }) =>
      new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          const record = window.__amplitudeEvidence?.inputs.find(
            (candidate) => candidate.id === inputId,
          );
          if (!record) {
            reject(
              new Error(`No scheduled capture record exists for ${inputId}.`),
            );
            return;
          }
          if (record.captureOffsetMs !== requestedOffset) {
            reject(
              new Error(
                `Capture offset mismatch for ${inputId}: scheduled ${record.captureOffsetMs}, requested ${requestedOffset}.`,
              ),
            );
            return;
          }
          if (record.capturePoint.actualAt !== null) {
            resolve(record.capturePoint);
            return;
          }
          if (performance.now() - startedAt > 2_000) {
            reject(
              new Error(`Timed out waiting for state capture ${inputId}.`),
            );
            return;
          }
          setTimeout(check, 2);
        };
        check();
      }),
    { inputId: input.id, requestedOffset: offsetMs },
  );
  const reachedAt = capturePoint.actualAt;
  const schedulerReachedAt =
    capturePoint.schedulerReachedAt ?? reachedAt;
  return captureScreenshot({
    page,
    ...captureOptions,
    requestedAt: targetAt,
    snapshot: capturePoint.snapshot,
    timing: {
      inputId: input.id,
      inputAt: input.pointerDownAt,
      requestedOffsetMs: offsetMs,
      requestedAt: targetAt,
      actualBasis:
        "pre-registered MessageChannel performance-clock state snapshot",
      schedulerReachedAt,
      schedulerReachedOffsetMs: Number(
        (schedulerReachedAt - input.pointerDownAt).toFixed(3),
      ),
      frameReachedAt: reachedAt,
      frameReachedOffsetMs: Number(
        (reachedAt - input.pointerDownAt).toFixed(3),
      ),
      schedulerErrorMs: Number(
        (schedulerReachedAt - targetAt).toFixed(3),
      ),
    },
  });
}

async function waitForCorrectOutcome(page, before, label) {
  await page.waitForFunction(
    (state) => {
      const game = document.querySelector(".pulse-game-layout");
      return (
        Number(game?.getAttribute("data-hits")) > state.hits ||
        Number(game?.getAttribute("data-current-cue")) > state.currentCue
      );
    },
    before,
    { polling: "raf", timeout: 3_000 },
  );
  const after = await readGameState(page);
  if (after.hits <= before.hits) {
    throw new Error(
      `${label} did not score. Before=${JSON.stringify(before)} After=${JSON.stringify(after)}`,
    );
  }
  return after;
}

async function waitForWrongOutcome(page, before) {
  await page.waitForFunction(
    (state) => {
      const game = document.querySelector(".pulse-game-layout");
      return (
        Number(game?.getAttribute("data-wrong")) > state.wrong ||
        Number(game?.getAttribute("data-current-cue")) > state.currentCue
      );
    },
    before,
    { polling: "raf", timeout: 3_000 },
  );
  const after = await readGameState(page);
  if (after.wrong <= before.wrong) {
    throw new Error(
      `Expected a wrong-route judgement. Before=${JSON.stringify(before)} After=${JSON.stringify(after)}`,
    );
  }
  return after;
}

async function waitForMissOutcome(page, before) {
  await page.waitForFunction(
    (state) => {
      const game = document.querySelector(".pulse-game-layout");
      return Number(game?.getAttribute("data-misses")) > state.misses;
    },
    before,
    { polling: "raf", timeout: 4_000 },
  );
  return readGameState(page);
}

function lastCueIndexForEvent(eventIndex) {
  return (
    EVENT_CUE_COUNTS.slice(0, eventIndex + 1).reduce(
      (total, count) => total + count,
      0,
    ) - 1
  );
}

async function startAppMediaRecording(page, run) {
  await page.waitForFunction(
    () => {
      const stream = window.__BASE_JAM_AUDIO_EVIDENCE_STREAM__;
      return (
        stream instanceof MediaStream &&
        stream
          .getAudioTracks()
          .some((track) => track.readyState === "live")
      );
    },
    undefined,
    { polling: "raf", timeout: CAPTURE_TIMEOUT_MS },
  );

  run.appMediaRecorder = await page.evaluate(
    ({ frameRate }) => {
      if (window.__amplitudeEvidenceRecorder) {
        throw new Error("The app media recorder is already active.");
      }
      const canvas = document.querySelector(
        ".base-jam-reactor-stage canvas",
      );
      const audioStream =
        window.__BASE_JAM_AUDIO_EVIDENCE_STREAM__;
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("The reactor canvas is unavailable for recording.");
      }
      if (!(audioStream instanceof MediaStream)) {
        throw new Error(
          "The PulseAudioEngine evidence stream is unavailable.",
        );
      }
      const sourceAudioTrack = audioStream.getAudioTracks()[0];
      if (!sourceAudioTrack) {
        throw new Error(
          "The PulseAudioEngine evidence stream has no audio track.",
        );
      }

      const canvasStream = canvas.captureStream(frameRate);
      const sourceVideoTrack = canvasStream.getVideoTracks()[0];
      if (!sourceVideoTrack) {
        throw new Error("canvas.captureStream returned no video track.");
      }
      const recordingAudioTrack = sourceAudioTrack.clone();
      const combinedStream = new MediaStream([
        sourceVideoTrack,
        recordingAudioTrack,
      ]);
      const mimeType = [
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9,opus",
        "video/webm",
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        throw new Error(
          "This browser cannot record a WebM canvas stream with MediaRecorder.",
        );
      }

      const chunks = [];
      const errors = [];
      const recorder = new MediaRecorder(combinedStream, {
        audioBitsPerSecond: 192_000,
        mimeType,
        videoBitsPerSecond: 6_000_000,
      });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        errors.push(event.error?.message ?? "Unknown MediaRecorder error");
      });
      const trackMetadata = (track) => ({
        contentHint: track.contentHint,
        enabled: track.enabled,
        id: track.id,
        kind: track.kind,
        label: track.label,
        muted: track.muted,
        readyState: track.readyState,
        settings: track.getSettings(),
      });
      const startedAt = performance.now();
      window.__amplitudeEvidenceRecorder = {
        chunks,
        combinedStream,
        errors,
        mimeType,
        recorder,
        startedAt,
      };
      recorder.start(250);
      return {
        audioSource: "PulseAudioEngine post-compressor mix",
        evidenceFlag: "__BASE_JAM_AUDIO_EVIDENCE_ENABLED__",
        frameRate,
        mimeType,
        recorderAudioBitsPerSecond: recorder.audioBitsPerSecond,
        recorderVideoBitsPerSecond: recorder.videoBitsPerSecond,
        startedAt,
        tracks: combinedStream.getTracks().map(trackMetadata),
      };
    },
    { frameRate: MEDIA_RECORDING_FRAME_RATE },
  );
}

async function stopAppMediaRecording(page) {
  return page.evaluate(async () => {
    const state = window.__amplitudeEvidenceRecorder;
    if (!state) return null;
    const {
      chunks,
      combinedStream,
      errors,
      mimeType,
      recorder,
      startedAt,
    } = state;

    if (recorder.state !== "inactive") {
      await new Promise((resolve, reject) => {
        const onError = (event) => {
          reject(
            new Error(
              event.error?.message ??
                "MediaRecorder failed while stopping.",
            ),
          );
        };
        recorder.addEventListener("error", onError, { once: true });
        recorder.addEventListener(
          "stop",
          () => {
            recorder.removeEventListener("error", onError);
            resolve();
          },
          { once: true },
        );
        recorder.stop();
      });
    }

    const stoppedAt = performance.now();
    const blob = new Blob(chunks, { type: mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + 32_768),
      );
    }
    for (const track of combinedStream.getTracks()) track.stop();
    delete window.__amplitudeEvidenceRecorder;

    return {
      base64: btoa(binary),
      byteLength: bytes.length,
      durationMs: Number((stoppedAt - startedAt).toFixed(3)),
      errors,
      mimeType,
      stoppedAt,
    };
  });
}

async function runScenario(page, run, runDirectory, outputRoot) {
  await page.goto(run.baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const start = page.getByRole("button", { name: /Tap to start/i });
  await start.waitFor({ state: "visible", timeout: 20_000 });
  await start.click();

  await page.getByTestId("base-jam-pulse").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.locator(".base-jam-reactor-stage canvas").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => {
      const board = document.querySelector(".base-jam-pulse-canvas");
      const phase = board?.getAttribute("data-playback-phase");
      return phase === "preroll" || phase === "playing";
    },
    undefined,
    { polling: "raf", timeout: 4_000 },
  );
  await waitForAnimationFrames(page, 3);
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(".base-jam-reactor-stage");
      return (
        Number(stage?.getAttribute("data-draw-calls")) > 0 &&
        Number(stage?.getAttribute("data-triangles")) > 0
      );
    },
    undefined,
    { polling: "raf", timeout: CAPTURE_TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(".base-jam-reactor-stage");
      const phase = stage?.getAttribute("data-cue-phase");
      const scene = stage?.getAttribute("data-scene-state");
      return (
        (phase === "soon" || phase === "ready") &&
        (scene === "anticipation" || scene === "ready")
      );
    },
    undefined,
    { polling: "raf", timeout: CAPTURE_TIMEOUT_MS },
  );
  await captureScreenshot({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "00-anticipation-current-plus-2",
    pauseBeforeCapture: true,
    semantics: {
      cuePhases: ["soon", "ready"],
      forbidFeedbackPattern: ["LATE", "WRONG", "GOOD", "PERFECT"],
      minVisibleDecisions: 3,
      outcomes: ["none"],
      sceneStates: ["anticipation", "ready"],
    },
  });
  // Full-page PNG encoding can briefly monopolize the compositor on desktop.
  // Re-establish a stable rAF cadence before arming the +75ms state gate.
  await waitForAnimationFrames(page, 3);

  let before = await readGameState(page);
  const firstInput = await dispatchGestureInPage(
    page,
    "__expected",
    "correct-hit",
    75,
    before.currentCue,
  );
  await captureAtInputOffset({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "01-correct-hit-plus-75ms",
    input: firstInput,
    offsetMs: 75,
    semantics: {
      maxFeedbackAgeMs: 360,
      minHits: before.hits + 1,
      outcomes: ["perfect", "good"],
      sceneStates: ["impact", "phrase-seal"],
    },
  });
  await waitForCorrectOutcome(page, before, "First correct cue");
  await waitUntilPerformanceTime(
    page,
    firstInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  before = await readGameState(page);
  for (let setupAttempt = 0; setupAttempt < 4; setupAttempt += 1) {
    const lastCueIndex = lastCueIndexForEvent(before.currentEvent);
    if (before.currentCue >= lastCueIndex) break;
    const setupBefore = before;
    const setupInput = await dispatchGestureInPage(
      page,
      "__expected",
      `phrase-setup-${setupAttempt + 1}`,
      null,
      before.currentCue,
    );
    await waitForCorrectOutcome(
      page,
      setupBefore,
      `Phrase setup cue ${setupAttempt + 1}`,
    );
    run.phraseSetupInputs ??= [];
    run.phraseSetupInputs.push(setupInput.id);
    await waitUntilPerformanceTime(
      page,
      setupInput.pointerDownAt + INPUT_SETTLE_MS,
    );
    before = await readGameState(page);
  }
  if (
    before.currentCue !== lastCueIndexForEvent(before.currentEvent)
  ) {
    throw new Error(
      `Could not align the phrase-payoff capture to a final cue: ${JSON.stringify(before)}.`,
    );
  }
  const phraseInput = await dispatchGestureInPage(
    page,
    "__expected",
    "phrase-payoff",
    120,
    before.currentCue,
  );
  await captureAtInputOffset({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "02-phrase-payoff-plus-120ms",
    input: phraseInput,
    offsetMs: 120,
    semantics: {
      maxFeedbackAgeMs: 1_500,
      minHits: before.hits + 1,
      minSealed: before.sealed + 1,
      outcomes: ["perfect", "good"],
      processorOpen: true,
      sceneStates: ["phrase-seal"],
    },
  });
  const phraseAfter = await waitForCorrectOutcome(
    page,
    before,
    "Phrase payoff cue",
  );
  if (phraseAfter.sealed <= before.sealed) {
    throw new Error(
      `The second correct cue did not seal its phrase. Before=${JSON.stringify(before)} After=${JSON.stringify(phraseAfter)}`,
    );
  }

  await waitUntilPerformanceTime(
    page,
    phraseInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  before = await readGameState(page);
  const switchRoute = before.expectedRoute ?? "left";
  if (switchRoute === "tap") {
    throw new Error(
      `Expected the third tutorial cue to switch routes, received ${JSON.stringify(before)}.`,
    );
  }
  const switchInput = await dispatchGestureInPage(
    page,
    "__expected",
    "route-switch",
    90,
    before.currentCue,
  );
  await captureAtInputOffset({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "03-route-switch-plus-90ms",
    input: switchInput,
    offsetMs: 90,
    semantics: {
      activeFaceNot: before.activeFace,
      maxFeedbackAgeMs: 150,
      minHits: before.hits + 1,
      outcomes: ["perfect", "good"],
      routeSettled: false,
      sceneStates: ["route-switch"],
    },
  });
  await waitForCorrectOutcome(page, before, "Route-switch cue");

  await waitUntilPerformanceTime(
    page,
    switchInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  before = await readGameState(page);
  const settleRoute = before.expectedRoute ?? "right";
  if (settleRoute === "tap") {
    throw new Error(
      `Expected the fourth tutorial cue to switch routes, received ${JSON.stringify(before)}.`,
    );
  }
  const settleInput = await dispatchGestureInPage(
    page,
    "__expected",
    "route-settle",
    180,
    before.currentCue,
  );
  await captureAtInputOffset({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "04-route-settled-plus-180ms",
    input: settleInput,
    offsetMs: 180,
    semantics: {
      activeFaceNot: before.activeFace,
      maxFeedbackAgeMs: 360,
      minHits: before.hits + 1,
      outcomes: ["perfect", "good"],
      routeSettled: true,
      sceneStates: ["impact", "phrase-seal"],
    },
  });
  await waitForCorrectOutcome(page, before, "Route-settle cue");

  await waitUntilPerformanceTime(
    page,
    settleInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  before = await readGameState(page);
  const wrongInput = await dispatchGestureInPage(
    page,
    "__opposite",
    "wrong-route",
    75,
    before.currentCue,
  );
  await captureAtInputOffset({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "05-wrong-route-plus-75ms",
    input: wrongInput,
    offsetMs: 75,
    semantics: {
      maxFeedbackAgeMs: 460,
      minWrong: before.wrong + 1,
      outcomes: ["wrong"],
      sceneStates: ["reject"],
    },
  });
  await waitForWrongOutcome(page, before);

  await waitUntilPerformanceTime(
    page,
    wrongInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  before = await readGameState(page);
  await waitForCueReady(page, before.currentCue);
  before = await readGameState(page);
  run.missWindowOpenedAt = before.at;
  const missAfter = await waitForMissOutcome(page, before);
  await waitForAnimationFrames(page, 1);
  await captureScreenshot({
    page,
    outputDirectory: runDirectory,
    outputRoot,
    run,
    name: "06-automatic-miss",
    pauseBeforeCapture: true,
    semantics: {
      maxFeedbackAgeMs: 460,
      minMisses: before.misses + 1,
      outcomes: ["miss"],
      sceneStates: ["reject"],
    },
    timing: {
      missWindowOpenedAt: run.missWindowOpenedAt,
      missObservedAt: missAfter.at,
      elapsedMs: Number(
        (missAfter.at - run.missWindowOpenedAt).toFixed(3),
      ),
    },
  });
}

function gameStateFromInputRecord(input) {
  return {
    currentCue: Number(input.before.currentCue),
    hits: Number(input.before.hits),
    misses: Number(input.before.misses),
    wrong: Number(input.before.wrong),
  };
}

async function runAppMixDemo(page, run) {
  await page.goto(run.baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const start = page.getByRole("button", { name: /Tap to start/i });
  await start.waitFor({ state: "visible", timeout: 20_000 });
  await start.click();
  await page.getByTestId("base-jam-pulse").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.locator(".base-jam-reactor-stage canvas").waitFor({
    state: "visible",
    timeout: 20_000,
  });
  await page.waitForFunction(
    () => {
      const phase = document
        .querySelector(".base-jam-pulse-canvas")
        ?.getAttribute("data-playback-phase");
      return phase === "preroll" || phase === "playing";
    },
    undefined,
    { polling: "raf", timeout: 4_000 },
  );

  await startAppMediaRecording(page, run);
  const recordingStartedAt = run.appMediaRecorder.startedAt;
  const anticipation = await readDomSnapshot(page);
  const initialState = await readGameState(page);
  const demo = {
    phase: "fresh-playable-replay",
    recordingStartedAt,
    anticipation,
    initialPlaybackPhase: initialState.playbackPhase,
    correctInputs: [],
    phraseSeals: 0,
    routeSwitches: 0,
    wrongInputs: [],
    automaticMisses: 0,
    sequence: [],
    minimumDurationMs: 12_000,
    completedAt: null,
  };
  run.demo = demo;

  const sealedAtStart = initialState.sealed;
  const missesAtStart = initialState.misses;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readGameState(page);
    const input = await dispatchGestureInPage(
      page,
      "__expected",
      `demo-correct-${attempt + 1}`,
      null,
      current.currentCue,
    );
    const after = await waitForCorrectOutcome(
      page,
      gameStateFromInputRecord(input),
      `Demo correct cue ${attempt + 1}`,
    );
    demo.correctInputs.push(input.id);
    if (input.route !== "tap") demo.routeSwitches += 1;
    demo.phraseSeals = Math.max(
      demo.phraseSeals,
      after.sealed - sealedAtStart,
    );
    demo.sequence.push({
      at: input.pointerDownAt,
      cue: Number(input.before.currentCue),
      kind: "correct",
      route: input.route,
      sealed: after.sealed,
    });
    await waitUntilPerformanceTime(
      page,
      input.pointerDownAt + INPUT_SETTLE_MS,
    );
    if (
      demo.correctInputs.length >= 4 &&
      demo.phraseSeals >= 1 &&
      demo.routeSwitches >= 1
    ) {
      break;
    }
  }

  const beforeWrong = await readGameState(page);
  const wrongInput = await dispatchGestureInPage(
    page,
    "__opposite",
    "demo-wrong-route",
    null,
    beforeWrong.currentCue,
  );
  const afterWrong = await waitForWrongOutcome(
    page,
    gameStateFromInputRecord(wrongInput),
  );
  demo.wrongInputs.push(wrongInput.id);
  demo.sequence.push({
    at: wrongInput.pointerDownAt,
    cue: Number(wrongInput.before.currentCue),
    kind: "wrong",
    route: wrongInput.route,
    wrong: afterWrong.wrong,
  });

  await waitUntilPerformanceTime(
    page,
    wrongInput.pointerDownAt + INPUT_SETTLE_MS,
  );
  let beforeMiss = await readGameState(page);
  await waitForCueReady(page, beforeMiss.currentCue);
  beforeMiss = await readGameState(page);
  const afterMiss = await waitForMissOutcome(page, beforeMiss);
  demo.automaticMisses = Math.max(
    0,
    afterMiss.misses - missesAtStart,
  );
  demo.sequence.push({
    at: afterMiss.at,
    cue: beforeMiss.currentCue,
    kind: "automatic-miss",
    misses: afterMiss.misses,
  });

  await waitUntilPerformanceTime(
    page,
    recordingStartedAt + demo.minimumDurationMs,
  );
  demo.completedAt = await page.evaluate(() => performance.now());
  demo.durationBeforeRecorderStopMs = Number(
    (demo.completedAt - recordingStartedAt).toFixed(3),
  );

  if (
    demo.initialPlaybackPhase !== "preroll" ||
    demo.correctInputs.length < 4 ||
    demo.phraseSeals < 1 ||
    demo.routeSwitches < 1 ||
    demo.wrongInputs.length < 1 ||
    demo.automaticMisses < 1 ||
    demo.durationBeforeRecorderStopMs < demo.minimumDurationMs
  ) {
    throw new Error(
      `App-mix demo coverage gate failed: ${JSON.stringify(demo)}.`,
    );
  }
}

function addInputLatencies(run) {
  const mutations = run.telemetry?.mutations ?? [];
  const feedback = run.telemetry?.feedback ?? [];
  run.inputLatencies = (run.telemetry?.inputs ?? []).map((input) => {
    const datasetEvent = mutations.find(
      (event) =>
        event.at >= input.pointerDownAt &&
        event.node === "game" &&
        [
          "data-active-face",
          "data-current-cue",
          "data-hits",
          "data-wrong",
        ].includes(event.attribute),
    );
    const feedbackEvent = feedback.find(
      (event) =>
        event.at >= input.pointerDownAt &&
        Boolean(event.text) &&
        /PERFECT|GOOD|WRONG|EARLY|LATE|PHRASE/i.test(event.text),
    );
    return {
      id: input.id,
      route: input.route,
      pointerDownAt: input.pointerDownAt,
      pointerUpCompletedAt: input.pointerUpCompletedAt,
      firstFrameAt: input.firstFrameAt,
      firstFrameTimestamp: input.firstFrameTimestamp,
      firstDatasetMutationAt: datasetEvent?.at ?? null,
      firstDatasetMutation:
        datasetEvent === undefined
          ? null
          : {
              node: datasetEvent.node,
              attribute: datasetEvent.attribute,
              value: datasetEvent.value,
            },
      firstFeedbackAt: feedbackEvent?.at ?? null,
      firstFeedback:
        feedbackEvent === undefined
          ? null
          : {
              node: feedbackEvent.node,
              className: feedbackEvent.className,
              text: feedbackEvent.text,
            },
      inputToFirstFrameMs:
        input.firstFrameAt === null
          ? null
          : Number((input.firstFrameAt - input.pointerDownAt).toFixed(3)),
      inputToDatasetMs:
        datasetEvent === undefined
          ? null
          : Number((datasetEvent.at - input.pointerDownAt).toFixed(3)),
      inputToFeedbackMs:
        feedbackEvent === undefined
          ? null
          : Number((feedbackEvent.at - input.pointerDownAt).toFixed(3)),
    };
  });
}

async function stopAndReadTelemetry(page) {
  return page.evaluate(() => {
    if (window.__amplitudeEvidence) {
      window.__amplitudeEvidence.stopped = true;
    }
    window.__amplitudeEvidenceObserver?.disconnect();
    return window.__amplitudeEvidence ?? null;
  });
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-100_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stderr, stdout });
      } else {
        reject(
          new Error(
            `${command} exited with code ${code}.\n${stderr.slice(-4_000)}`,
          ),
        );
      }
    });
  });
}

async function probeMedia(filePath) {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    filePath,
  ]);
  const raw = JSON.parse(result.stdout);
  return {
    format: {
      bitRate: raw.format?.bit_rate ?? null,
      duration: raw.format?.duration ?? null,
      formatLongName: raw.format?.format_long_name ?? null,
      formatName: raw.format?.format_name ?? null,
      size: raw.format?.size ?? null,
    },
    streams: (raw.streams ?? []).map((stream) => ({
      averageFrameRate: stream.avg_frame_rate ?? null,
      bitRate: stream.bit_rate ?? null,
      channelLayout: stream.channel_layout ?? null,
      channels: stream.channels ?? null,
      codecLongName: stream.codec_long_name ?? null,
      codecName: stream.codec_name ?? null,
      codecType: stream.codec_type ?? null,
      duration: stream.duration ?? null,
      height: stream.height ?? null,
      index: stream.index,
      pixelFormat: stream.pix_fmt ?? null,
      profile: stream.profile ?? null,
      sampleRate: stream.sample_rate ?? null,
      width: stream.width ?? null,
    })),
  };
}

function assertMediaStreams(probe, expected, label) {
  const video = probe.streams.find(
    (stream) => stream.codecType === "video",
  );
  const audio = probe.streams.find(
    (stream) => stream.codecType === "audio",
  );
  if (!video || !audio) {
    throw new Error(
      `${label} must contain both video and app audio. Streams=${JSON.stringify(probe.streams)}`,
    );
  }
  if (
    expected.videoCodecs &&
    !expected.videoCodecs.includes(video.codecName)
  ) {
    throw new Error(
      `${label} video codec ${video.codecName} is not one of ${expected.videoCodecs.join(", ")}.`,
    );
  }
  if (
    expected.audioCodecs &&
    !expected.audioCodecs.includes(audio.codecName)
  ) {
    throw new Error(
      `${label} audio codec ${audio.codecName} is not one of ${expected.audioCodecs.join(", ")}.`,
    );
  }
}

async function probeAudioLevel(filePath) {
  const result = await runProcess("ffmpeg", [
    "-hide_banner",
    "-i",
    filePath,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const maxMatch = result.stderr.match(
    /max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i,
  );
  const meanMatch = result.stderr.match(
    /mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/i,
  );
  const parseLevel = (match) => {
    if (!match) return null;
    if (match[1].toLowerCase() === "-inf") return -Infinity;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };
  return {
    maxVolumeDb: parseLevel(maxMatch),
    meanVolumeDb: parseLevel(meanMatch),
  };
}

async function finalizeAppMediaRecording(
  recording,
  outputRoot,
  runDirectory,
  run,
) {
  if (!recording || recording.byteLength <= 0) {
    throw new Error(
      "The app MediaRecorder returned no canvas-plus-audio evidence.",
    );
  }
  if (recording.errors.length > 0) {
    throw new Error(
      `The app MediaRecorder reported errors: ${recording.errors.join("; ")}`,
    );
  }
  if (recording.durationMs < 12_000) {
    throw new Error(
      `The app MediaRecorder evidence is too short: ${recording.durationMs}ms; expected at least 12000ms.`,
    );
  }

  const webmPath = path.join(
    runDirectory,
    `${run.name}-app-mix.webm`,
  );
  const mp4Path = path.join(
    runDirectory,
    `${run.name}-app-mix-share.mp4`,
  );
  const bytes = Buffer.from(recording.base64, "base64");
  if (bytes.byteLength !== recording.byteLength) {
    throw new Error(
      `The app recording changed size during transfer: browser=${recording.byteLength} node=${bytes.byteLength}.`,
    );
  }
  await writeFile(webmPath, bytes);
  const webmProbe = await probeMedia(webmPath);
  assertMediaStreams(
    webmProbe,
    { audioCodecs: ["opus"], videoCodecs: ["vp8", "vp9"] },
    "App-mix WebM",
  );
  const audioLevel = await probeAudioLevel(webmPath);
  if (
    audioLevel.maxVolumeDb === null ||
    audioLevel.maxVolumeDb < -60
  ) {
    throw new Error(
      `App-mix WebM contains an audio track but no audible app mix. Levels=${JSON.stringify(audioLevel)}`,
    );
  }

  await runProcess("ffmpeg", [
    "-y",
    "-i",
    webmPath,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  const mp4Probe = await probeMedia(mp4Path);
  assertMediaStreams(
    mp4Probe,
    { audioCodecs: ["aac"], videoCodecs: ["h264"] },
    "Share MP4",
  );

  run.video = {
    available: true,
    audioSource: run.appMediaRecorder.audioSource,
    audioLevel,
    durationMs: recording.durationMs,
    demoCoverage: run.demo,
    mimeType: recording.mimeType,
    mp4AbsolutePath: mp4Path,
    mp4Path: path.relative(outputRoot, mp4Path),
    mp4Probe,
    recorder: run.appMediaRecorder,
    source: "canvas.captureStream + post-compressor WebAudio",
    stoppedAt: recording.stoppedAt,
    webmAbsolutePath: webmPath,
    webmBytes: recording.byteLength,
    webmPath: path.relative(outputRoot, webmPath),
    webmProbe,
  };
}

async function finalizeVideo(video, outputRoot, runDirectory, run) {
  if (!video) {
    run.playwrightVideo = {
      available: false,
      reason: "Playwright returned no video.",
    };
    return;
  }
  const temporaryPath = await video.path();
  const webmPath = path.join(runDirectory, `${run.name}-uncut.webm`);
  const mp4Path = path.join(runDirectory, `${run.name}-share.mp4`);
  await copyFile(temporaryPath, webmPath);
  const result = {
    available: true,
    webmPath: path.relative(outputRoot, webmPath),
    webmAbsolutePath: webmPath,
    mp4Path: null,
    mp4AbsolutePath: null,
    conversionError: null,
  };
  try {
    await runProcess("ffmpeg", [
      "-y",
      "-i",
      webmPath,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ]);
    result.mp4Path = path.relative(outputRoot, mp4Path);
    result.mp4AbsolutePath = mp4Path;
  } catch (error) {
    result.conversionError = serializeError(error);
  }
  run.playwrightVideo = result;
}

async function captureProfile(browser, profile, baseUrl, outputRoot) {
  const runDirectory = path.join(outputRoot, profile.name);
  const temporaryVideoDirectory = path.join(
    outputRoot,
    ".video-tmp",
    profile.name,
  );
  await mkdir(runDirectory, { recursive: true });
  await mkdir(temporaryVideoDirectory, { recursive: true });

  const run = {
    name: profile.name,
    baseUrl,
    viewport: profile.viewport,
    mobile: profile.mobile,
    startedAt: new Date().toISOString(),
    completedAt: null,
    screenshots: [],
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    telemetry: null,
    frameStats: null,
    inputLatencies: [],
    finalSnapshot: null,
    demo: null,
    demoFinalSnapshot: null,
    demoTelemetry: null,
    demoFrameStats: null,
    missWindowOpenedAt: null,
    appMediaRecorder: null,
    video: null,
    playwrightVideo: null,
    error: null,
  };
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: 1,
    hasTouch: profile.mobile,
    isMobile: profile.mobile,
    colorScheme: "dark",
    serviceWorkers: "block",
    recordVideo: {
      dir: temporaryVideoDirectory,
      size: profile.viewport,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(CAPTURE_TIMEOUT_MS);
  page.on("pageerror", (error) => {
    run.pageErrors.push(serializeError(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      run.consoleErrors.push({
        at: new Date().toISOString(),
        text: message.text(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    run.requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });

  await installBrowserTelemetry(page);
  await mockPlayableApi(page);
  const video = page.video();

  try {
    await runScenario(page, run, runDirectory, outputRoot);
    run.finalSnapshot = await readDomSnapshot(page);
    run.telemetry = await stopAndReadTelemetry(page);
    run.frameStats = frameStats(run.telemetry?.frames ?? []);
    addInputLatencies(run);

    // Phase B is a clean replay. Its MediaRecorder load and frame samples are
    // intentionally isolated from the F0-F6 measurement evidence above.
    await runAppMixDemo(page, run);
  } catch (error) {
    run.error = serializeError(error);
    try {
      const failurePath = path.join(runDirectory, "99-failure.png");
      await page.screenshot({
        path: failurePath,
        fullPage: false,
        animations: "allow",
      });
      run.screenshots.push({
        name: "99-failure",
        path: path.relative(outputRoot, failurePath),
        absolutePath: failurePath,
        requestedAt: await page.evaluate(() => performance.now()),
        completedAt: null,
        captureDurationMs: null,
        timing: null,
        snapshot: await readDomSnapshot(page),
      });
    } catch (failureCaptureError) {
      run.failureCaptureError = serializeError(failureCaptureError);
    }
  } finally {
    if (run.demo) {
      try {
        run.demoFinalSnapshot = await readDomSnapshot(page);
        run.demoTelemetry = await stopAndReadTelemetry(page);
        run.demoFrameStats = frameStats(
          run.demoTelemetry?.frames ?? [],
        );
      } catch (demoTelemetryError) {
        run.demoTelemetryError = serializeError(demoTelemetryError);
      }
    } else if (!run.telemetry) {
      try {
        run.finalSnapshot = await readDomSnapshot(page);
        run.telemetry = await stopAndReadTelemetry(page);
        run.frameStats = frameStats(run.telemetry?.frames ?? []);
        addInputLatencies(run);
      } catch (telemetryError) {
        run.telemetryError = serializeError(telemetryError);
      }
    }
    try {
      const recording = await stopAppMediaRecording(page);
      await finalizeAppMediaRecording(
        recording,
        outputRoot,
        runDirectory,
        run,
      );
    } catch (mediaError) {
      run.video = {
        available: false,
        reason: serializeError(mediaError),
        source: "canvas.captureStream + post-compressor WebAudio",
      };
      if (!run.error) {
        run.error = serializeError(
          new Error(
            `App-audio evidence gate failed: ${serializeError(mediaError).message}`,
          ),
        );
      }
    }
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    try {
      await finalizeVideo(video, outputRoot, runDirectory, run);
    } catch (videoError) {
      run.playwrightVideo = {
        available: false,
        reason: serializeError(videoError),
      };
    }
    run.completedAt = new Date().toISOString();
  }
  return run;
}

async function main() {
  const baseUrl = normalizedBaseUrl(
    process.env.BASE_URL ?? DEFAULT_BASE_URL,
  );
  const outputRoot = path.resolve(
    process.env.OUTPUT_DIR ??
      path.join(
        process.cwd(),
        "test-results",
        "amplitude-evidence",
        timestampSlug(),
      ),
  );
  await mkdir(outputRoot, { recursive: true });
  await assertServerAvailable(baseUrl);

  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    baseUrl,
    outputDirectory: outputRoot,
    fixture: {
      chainId: fixtureLevel.chainId,
      blockNumber: fixtureLevel.source.number,
      blockHash: fixtureLevel.source.hash,
      digest: fixtureLevel.digest,
      txCount: fixtureLevel.source.txCount,
    },
    evidenceGates: {
      appAudioSource: "PulseAudioEngine post-compressor mix",
      captureTimingToleranceMs: CAPTURE_TIMING_TOLERANCE_MS,
      headedMetalCapture: EVIDENCE_HEADED,
      mp4Codecs: { audio: "aac", video: "h264" },
      recordingFrameRate: MEDIA_RECORDING_FRAME_RATE,
      webmCodecs: { audio: "opus", video: ["vp8", "vp9"] },
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      browser: null,
    },
    runs: [],
    errors: [],
  };

  let browser;
  try {
    browser = await chromium.launch({
      channel: EVIDENCE_HEADED ? "chrome" : undefined,
      headless: !EVIDENCE_HEADED,
      args: EVIDENCE_HEADED
        ? [
            "--use-angle=metal",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
          ]
        : [],
    });
    manifest.runtime.browser = await browser.version();
    for (const profile of captureProfiles) {
      process.stdout.write(
        `Capturing ${profile.name} from ${baseUrl}...\n`,
      );
      const run = await captureProfile(
        browser,
        profile,
        baseUrl,
        outputRoot,
      );
      manifest.runs.push(run);
      if (run.error) manifest.errors.push({ run: run.name, ...run.error });
    }
  } finally {
    await browser?.close().catch(() => {});
    await rm(path.join(outputRoot, ".video-tmp"), {
      recursive: true,
      force: true,
    }).catch(() => {});
    manifest.completedAt = new Date().toISOString();
    const manifestPath = path.join(outputRoot, "manifest.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`Evidence manifest: ${manifestPath}\n`);
  }

  if (manifest.errors.length > 0) {
    const diagnostic = manifest.errors
      .map((error) => `${error.run}: ${error.message}`)
      .join("\n");
    throw new Error(
      `Amplitude evidence capture failed for ${manifest.errors.length} profile(s).\n${diagnostic}\nSee ${path.join(outputRoot, "manifest.json")}`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});

import { expect, test, type Page } from "@playwright/test";

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

const practiceLevel = {
  ...fixtureLevel,
  ranked: false,
  source: {
    ...fixtureLevel.source,
    kind: "practice",
    number: "practice-2026-07-18",
    explorerUrl: "https://basescan.org",
    confirmations: 0,
  },
  fallbackReason: "Test practice mix.",
};

async function mockPlayableApi(page: Page) {
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

async function dispatchWhenCueReady(
  page: Page,
  {
    fallbackDeltaY = 0,
    mode = "expected",
    pointerId,
  }: {
    fallbackDeltaY?: number;
    mode?: "expected" | "wrong";
    pointerId: number;
  },
) {
  return page.evaluate(
    async ({ fallbackDeltaY, mode, pointerId }) => {
      const deadline = performance.now() + 6_000;
      const waitForReadyFrame = () =>
        new Promise<void>((resolve, reject) => {
          const sample = () => {
            const stage = document.querySelector<HTMLElement>(
              ".base-jam-reactor-stage",
            );
            if (
              stage?.dataset.cueReady === "true" &&
              stage.dataset.cueRoute &&
              stage.dataset.cueRoute !== "none"
            ) {
              resolve();
              return;
            }
            if (performance.now() >= deadline) {
              reject(new Error("Timed out waiting for an exact cue window."));
              return;
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });

      await waitForReadyFrame();

      const stage = document.querySelector<HTMLElement>(
        ".base-jam-reactor-stage",
      );
      const game = document.querySelector<HTMLElement>(".pulse-game-layout");
      const surface =
        document.querySelector<HTMLElement>(".pulse-tap-surface");
      if (!stage || !game || !surface) {
        throw new Error("The active game surface was not mounted.");
      }

      const expectedRoute = stage.dataset.cueRoute;
      const route =
        mode === "wrong"
          ? expectedRoute === "left"
            ? "right"
            : expectedRoute === "right"
              ? "left"
              : "right"
          : expectedRoute;
      const deltaX = route === "left" ? -80 : route === "right" ? 80 : 0;
      const deltaY = route === "tap" ? fallbackDeltaY : 0;
      const bounds = surface.getBoundingClientRect();
      const clientX = bounds.left + bounds.width / 2;
      const clientY = bounds.top + bounds.height / 2;
      const shared = {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX,
        clientY,
        composed: true,
        isPrimary: true,
        pointerId,
        pointerType: "touch",
      };
      const before = {
        cue: Number(game.dataset.currentCue),
        hits: Number(game.dataset.hits),
        wrong: Number(game.dataset.wrong),
      };

      // Keep readiness sampling and both pointer events in the browser's own
      // animation task. Crossing the Playwright transport here can consume
      // most or all of a short rhythm-game hit window.
      surface.dispatchEvent(
        new PointerEvent("pointerdown", { ...shared, buttons: 1 }),
      );
      surface.dispatchEvent(
        new PointerEvent("pointerup", {
          ...shared,
          buttons: 0,
          clientX: clientX + deltaX,
          clientY: clientY + deltaY,
        }),
      );

      return {
        ...before,
        cueDeltaMs: Number(stage.dataset.cueDeltaMs),
        expectedRoute,
        route,
      };
    },
    { fallbackDeltaY, mode, pointerId },
  );
}

async function hitExpectedCue(
  page: Page,
  pointerId: number,
  fallbackGesture?: { deltaX?: number; deltaY?: number },
) {
  const game = page.locator(".pulse-game-layout");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await dispatchWhenCueReady(page, {
      fallbackDeltaY: fallbackGesture?.deltaY,
      pointerId: pointerId + attempt * 100,
    });
    await page.waitForFunction(
      ({ cue, hits }) => {
        const element = document.querySelector(".pulse-game-layout");
        return (
          Number(element?.getAttribute("data-hits")) > hits ||
          Number(element?.getAttribute("data-current-cue")) > cue
        );
      },
      { cue: before.cue, hits: before.hits },
      { polling: 16, timeout: 2_000 },
    );
    if (Number(await game.getAttribute("data-hits")) > before.hits) return;
  }
  throw new Error("Five readable cue windows passed without a hit.");
}

async function judgeWrongTutorialCue(page: Page, pointerId: number) {
  const game = page.locator(".pulse-game-layout");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await dispatchWhenCueReady(page, {
      mode: "wrong",
      pointerId: pointerId + attempt * 100,
    });
    await page.waitForFunction(
      ({ cue, wrong }) => {
        const element = document.querySelector(".pulse-game-layout");
        return (
          Number(element?.getAttribute("data-wrong")) > wrong ||
          Number(element?.getAttribute("data-current-cue")) > cue
        );
      },
      { cue: before.cue, wrong: before.wrong },
      { polling: 16, timeout: 2_000 },
    );
    if (Number(await game.getAttribute("data-wrong")) > before.wrong) return;
  }
  throw new Error("Five readable LEFT cues passed without a wrong result.");
}

test("home makes the live Base rhythm game the focal point", async ({ page }) => {
  await mockPlayableApi(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/Play the chain/);
  await expect(
    page.getByRole("heading", { name: "JAM THE CHAIN." }),
  ).toBeVisible();
  await expect(page.getByText("Block 48,725,123")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Tap to start/ }),
  ).toBeEnabled();

  const preview = page.getByTestId("home-mix-preview");
  const dailyPoster = page.locator(".daily-poster");
  await expect(preview).toBeVisible();
  await expect(page.locator(".field-guide")).not.toHaveAttribute("open", "");

  const previewBox = await preview.boundingBox();
  const posterBox = await dailyPoster.boundingBox();
  const viewport = page.viewportSize();
  expect(previewBox).not.toBeNull();
  expect(posterBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(previewBox!.width).toBeGreaterThan(
    viewport!.width <= 760 ? viewport!.width * 0.82 : viewport!.width * 0.45,
  );
  expect(previewBox!.y).toBeLessThan(viewport!.height);
  expect(previewBox!.width / previewBox!.height).toBeGreaterThan(1.15);
  expect(posterBox!.width / posterBox!.height).toBeCloseTo(1.5, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    viewport!.width,
  );
});

test("one thumb can tap, flick, and read the channel HUD in both phone orientations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPlayableApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    type GateSample = {
      readonly at: number;
      readonly phase: string | null;
      readonly sceneReady: string | null;
      readonly step: string | null;
    };
    const scope = window as Window & {
      __pulseGateLifecycle?: GateSample[];
    };
    const samples: GateSample[] = [];
    let previous = "";
    const capture = () => {
      const board = document.querySelector<HTMLElement>(
        "[data-testid='base-jam-pulse']",
      );
      const game = document.querySelector<HTMLElement>(".pulse-game-layout");
      if (!board || !game) return;
      const sample = {
        at: performance.now(),
        phase: board.dataset.playbackPhase ?? null,
        sceneReady: board.dataset.sceneReady ?? null,
        step: game.dataset.currentStep ?? null,
      };
      const key = `${sample.phase}:${sample.sceneReady}:${sample.step}`;
      if (key === previous) return;
      previous = key;
      samples.push(sample);
    };
    scope.__pulseGateLifecycle = samples;
    new MutationObserver(capture).observe(document.documentElement, {
      attributeFilter: [
        "data-current-step",
        "data-playback-phase",
        "data-scene-ready",
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
  await page.getByRole("button", { name: /Tap to start/ }).click();

  const board = page.getByTestId("base-jam-pulse");
  await expect(board).toBeVisible();
  await expect(
    page.locator(".base-jam-reactor-stage canvas"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".pulse-game-layout")).toHaveAttribute(
    "data-visual-version",
    "amplitude",
  );
  await expect(page.locator(".base-jam-reactor-stage")).toHaveAttribute(
    "data-camera-mode",
    "first-person",
  );
  await expect(page.locator(".base-jam-reactor-stage canvas")).toHaveCount(1);
  await expect(page.locator(".base-jam-phaser-runtime canvas")).toHaveCount(0);
  const stage = page.locator(".base-jam-reactor-stage");
  await expect(stage).toHaveAttribute("data-cue-ready-source", "runtime");
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector(".base-jam-reactor-stage")
          ?.getAttribute("data-draw-calls"),
      ) > 0,
    undefined,
    { polling: 50, timeout: 5_000 },
  );
  await expect(board).toHaveAttribute("data-scene-ready", "true");
  await expect(board).toHaveAttribute("data-scene-ready-mode", "rendered");
  await expect(board).toHaveAttribute("data-playback-phase", /preroll|playing/);
  const gateLifecycle = await page.evaluate(
    () =>
      (
        window as Window & {
          __pulseGateLifecycle?: Array<{
            readonly phase: string | null;
            readonly sceneReady: string | null;
            readonly step: string | null;
          }>;
        }
      ).__pulseGateLifecycle ?? [],
  );
  const pendingGateIndex = gateLifecycle.findIndex(
    (sample) =>
      sample.sceneReady === "false" &&
      sample.phase === "idle" &&
      Number(sample.step) < 0,
  );
  const startedGateIndex = gateLifecycle.findIndex(
    (sample) =>
      sample.sceneReady === "true" &&
      (sample.phase === "preroll" || sample.phase === "playing"),
  );
  expect(pendingGateIndex).toBeGreaterThanOrEqual(0);
  expect(startedGateIndex).toBeGreaterThan(pendingGateIndex);
  expect(Number(await stage.getAttribute("data-draw-calls"))).toBeLessThanOrEqual(
    90,
  );
  expect(Number(await stage.getAttribute("data-triangles"))).toBeLessThanOrEqual(
    120_000,
  );
  const clock = page.locator(".pulse-clock span");
  await expect(clock).toHaveText(/^\d{2}$/);
  expect(Number(await clock.textContent())).toBeGreaterThan(0);
  const target = page.locator(".blockstream-stage__target");
  await expect(target).toContainText("TAP");
  await expect(target).toContainText("TOUCH ANYWHERE AT THE LINE");
  await expect(page.locator(".pulse-notice")).toContainText(
    /Signal armed|Follow the command line/,
    { timeout: 2_000 },
  );

  const game = page.locator(".pulse-game-layout");
  const tapSurface = page.locator(".pulse-tap-surface");
  await expect(game).toHaveAttribute("data-play-mode", "tap-flick");
  await expect(game).toHaveAttribute("data-tutorial-step", "0");
  await expect(game).toHaveAttribute("data-expected-route", "tap");
  await expect(page.locator(".rhythm-hit-button")).toHaveCount(0);
  await expect(page.locator(".rhythm-lane-buttons")).toHaveCount(0);
  await expect(page.locator(".pulse-channel-statuses > span")).toHaveCount(4);
  await expect(page.locator(".pulse-channel-statuses")).toBeVisible();
  await expect(
    page.locator(".pulse-channel-statuses > span b"),
  ).toHaveText(["BEAT", "BASS", "SYNTH", "FX"]);
  await expect(page.locator(".pulse-phrase-status i")).toHaveCount(2);

  const tapBox = await tapSurface.boundingBox();
  expect(tapBox).not.toBeNull();
  expect(tapBox!.width).toBeGreaterThan(390 * 0.82);

  // The home CTA starts the run. A vertical or short release is a tap, so
  // normal thumb drift never falls into a silent gesture dead zone.
  await hitExpectedCue(page, 10, { deltaY: 80 });
  await expect(game).toHaveAttribute("data-tutorial-step", "1");
  await expect(game).toHaveAttribute("data-last-gesture", "tap");
  await page.waitForTimeout(110);
  await hitExpectedCue(page, 11);
  await expect(game).toHaveAttribute("data-tutorial-step", "2");
  await expect(game).toHaveAttribute("data-expected-route", "left");

  // The tutorial advances on successful commands, not gestures alone.
  await page.waitForTimeout(110);
  await judgeWrongTutorialCue(page, 12);
  await expect(game).toHaveAttribute("data-tutorial-step", "2");
  await expect(game).toHaveAttribute("data-wrong", "1");
  await expect(game).toHaveAttribute("data-combo", "0");
  await expect(game).toHaveAttribute("data-expected-route", "left");

  await page.waitForTimeout(110);
  await hitExpectedCue(page, 13);
  await expect(game).toHaveAttribute("data-tutorial-step", "3");
  await expect(game).toHaveAttribute("data-last-gesture", "flick-left");
  await expect(game).toHaveAttribute("data-expected-route", "right");

  await page.waitForTimeout(110);
  await hitExpectedCue(page, 14);
  expect(Number(await game.getAttribute("data-combo"))).toBeGreaterThan(0);
  await expect(game).toHaveAttribute("data-tutorial-step", "4");
  await expect(game).toHaveAttribute("data-last-gesture", "flick-right");
  await expect(game).toHaveAttribute("data-hits", "4");
  await expect(game).toHaveAttribute("data-wrong", "1");
  await expect(page.locator(".pulse-phrase-status")).toBeVisible();

  await page.getByRole("button", { name: /Sound on/i }).click();
  await expect(page.getByRole("button", { name: /Sound off/i })).toBeVisible();

  const portraitCanvas = await page.getByTestId("base-jam-pulse").boundingBox();
  expect(portraitCanvas!.y).toBeGreaterThanOrEqual(0);
  expect(portraitCanvas!.y + portraitCanvas!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeCanvas = await page.getByTestId("base-jam-pulse").boundingBox();
  const landscapeFooter = await page.locator(".pulse-game-footer").boundingBox();
  expect(landscapeCanvas!.y).toBeGreaterThanOrEqual(0);
  expect(landscapeCanvas!.y + landscapeCanvas!.height).toBeLessThanOrEqual(390);
  expect(landscapeFooter!.y + landscapeFooter!.height).toBeLessThanOrEqual(390);
  await expect(page.locator(".pulse-channel-statuses")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    844,
  );
});

test("procedural 3D scene plays without external model downloads", async ({
  page,
}) => {
  let modelRequests = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockPlayableApi(page);
  await page.route("**/models/**", async (route) => {
    modelRequests += 1;
    await route.abort();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Tap to start/ }).click();

  const game = page.locator(".pulse-game-layout");
  const tapSurface = page.locator(".pulse-tap-surface");
  const target = page.locator(".blockstream-stage__target");
  await expect(game).toHaveAttribute("data-play-mode", "tap-flick");
  await expect(tapSurface).toBeVisible();

  await expect(target).toContainText("TOUCH ANYWHERE AT THE LINE");
  await hitExpectedCue(page, 30);
  await expect(game).toHaveAttribute("data-tutorial-step", "1");
  await expect(game).toHaveAttribute("data-hits", "1");
  expect(modelRequests).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("specific block deep link keeps the challenged source", async ({ page }) => {
  await mockPlayableApi(page);
  await page.goto("/?block=48725123");
  await expect(page.getByText("Challenge #48,725,123")).toBeVisible();
  await page.getByRole("button", { name: /Tap to start/ }).click();
  if (page.viewportSize()!.width <= 760) {
    await expect(page.locator(".pulse-live-chip__mobile")).toHaveAttribute(
      "title",
      "Base block 48,725,123",
    );
  } else {
    await expect(
      page.getByRole("heading", { name: "BASE #48,725,123" }),
    ).toBeVisible();
  }
});

test("RPC failure offers a playable, honestly labeled practice mix", async ({
  page,
}) => {
  await page.route("**/api/levels/latest", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/mixes/latest", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/levels/practice**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ level: practiceLevel }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Tap to start/ }).click();
  await expect(
    page.getByRole("heading", { name: "THE FEED LOST BASE." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Base" })).toBeVisible();

  await page.getByRole("button", { name: "Use practice mix" }).click();
  await expect(page.getByTestId("base-jam-pulse")).toBeVisible();
  await expect(page.locator(".pulse-live-chip")).toContainText("Practice");
});

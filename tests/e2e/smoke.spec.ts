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

test("home makes the live Base rhythm game the focal point", async ({ page }) => {
  await mockPlayableApi(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/Play the chain/);
  await expect(
    page.getByRole("heading", { name: "JAM THE CHAIN." }),
  ).toBeVisible();
  await expect(page.getByText("Block 48,725,123")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Drop into the set/ }),
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

test("guest can enter the set and use keyboard or touch controls", async ({
  page,
}) => {
  await mockPlayableApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Drop into the set/ }).click();

  await expect(page.getByTestId("base-jam-rhythm")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".rhythm-clock span")).toHaveText(/^(2[89]|30)$/);
  await expect(page.locator(".rhythm-hit-button").first()).toBeVisible();

  await page.keyboard.press("KeyD");
  await expect(
    page.locator(".rhythm-lane-buttons button[aria-pressed='true']"),
  ).toContainText("BASS");
  await page.locator(".rhythm-hit-button").nth(1).click();
  await page.getByRole("button", { name: /Sound on/i }).click();
  await expect(page.getByRole("button", { name: /Sound off/i })).toBeVisible();

  const viewport = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    viewport!.width,
  );
});

test("specific block deep link keeps the challenged source", async ({ page }) => {
  await mockPlayableApi(page);
  await page.goto("/?block=48725123");
  await expect(page.getByText("Challenge #48,725,123")).toBeVisible();
  await page.getByRole("button", { name: /Drop into the set/ }).click();
  await expect(page.getByRole("heading", { name: "BASE #48,725,123" })).toBeVisible();
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
  await page.getByRole("button", { name: /Drop into the set/ }).click();
  await expect(
    page.getByRole("heading", { name: "THE FEED LOST BASE." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Base" })).toBeVisible();

  await page.getByRole("button", { name: "Use practice mix" }).click();
  await expect(page.getByTestId("base-jam-rhythm")).toBeVisible();
  await expect(page.getByText("Practice sequence")).toBeVisible();
});

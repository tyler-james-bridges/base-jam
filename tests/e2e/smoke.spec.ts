import { expect, test, type Page } from "@playwright/test";

const blockHash =
  "0x8f31a843fc6cd24af9e31f153b712bf3a4b95800997d580cc5f21f1c889ca07f";
const digest =
  "0x6cbf2efda67befa88d7d447669bfb3fafb3cb63cfe5f5af2b87ccb827564aebb";

// Keep the browser smoke fixture intentionally small. The full 24-piece
// simulation is covered by unit tests; this fixture only needs enough pieces
// to exercise the complete browser flow on slow shared CI runners.
const pieces = Array.from({ length: 6 }, (_, index) => ({
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

async function mockPlayableApi(page: Page) {
  await page.route("**/api/levels/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ level: fixtureLevel }),
    });
  });
  await page.route("**/api/runs/start", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ticket: "signed-test-ticket",
        expiresAt: "2026-07-17T20:15:00.000Z",
        ranked: true,
      }),
    });
  });
  await page.route("**/api/runs/finish", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        verified: true,
        shareToken: "verified-test-token",
      }),
    });
  });
}

test("home explains the game and loads a Base level", async ({ page }) => {
  await mockPlayableApi(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/BASE JAM/);
  await expect(
    page.getByRole("heading", { name: "JAM THE BLOCK." }),
  ).toBeVisible();
  await expect(page.getByText("Block 48,725,123")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Play latest block/ }),
  ).toBeEnabled();
});

test("guest can enter the game and finish an unfilled plate", async ({
  page,
}) => {
  await mockPlayableApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Play latest block/ }).click();

  await expect(page.getByTestId("base-jam-board")).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".timer span")).toHaveText(/^(5[0-9]|60)$/);

  for (let index = 0; index < pieces.length; index += 1) {
    await page.getByRole("button", { name: /Spill piece/ }).click();
  }

  await expect(
    page.getByRole("heading", { name: "THE BLOCK SPILLED." }),
  ).toBeVisible();
  await expect(page.getByText(/Verified replay/)).toBeVisible();
  await expect(page.getByRole("button", { name: /JAM again/ })).toBeVisible();
});

test("specific challenge deep link keeps the challenged block", async ({
  page,
}) => {
  await mockPlayableApi(page);
  await page.goto("/?block=48725123");
  await expect(
    page.getByRole("button", { name: /Play challenge #48,725,123/ }),
  ).toBeVisible();
});

test("RPC failure produces an actionable recovery state", async ({ page }) => {
  await page.route("**/api/levels/latest", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "BASE_UNAVAILABLE", message: "Base timed out." },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Play latest block/ }).click();

  await expect(
    page.getByRole("heading", { name: "THE PRESS LOST BASE." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Base" })).toBeVisible();
});

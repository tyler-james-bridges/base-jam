import { describe, expect, it } from "vitest";

import {
  createGame,
  createReplay,
  currentPiece,
  sealGame,
  spillPiece,
} from "@/game/simulation";
import { levelToSimulationTransactions } from "@/lib/base";
import { createPracticeManifest } from "@/lib/base/server";

import { GET as getSharedRun } from "./[token]/route";
import { POST as finishRun } from "./finish/route";
import { POST as startRun } from "./start/route";

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("run API", () => {
  it("starts, verifies, signs, and decodes a practice run", async () => {
    const level = createPracticeManifest({
      reason: "test",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });
    const started = await startRun(
      request("/api/runs/start", {
        levelDigest: level.digest,
        levelNumber: level.source.number,
        levelHash: level.source.hash,
      }),
    );
    expect(started.status).toBe(200);
    const startBody = (await started.json()) as {
      ticket: string;
      ranked: boolean;
    };
    expect(startBody.ranked).toBe(false);

    let state = createGame({
      blockHash: level.source.hash,
      transactions: levelToSimulationTransactions(level),
    });
    while (currentPiece(state)) {
      state = spillPiece(state, currentPiece(state)!.id);
    }
    state = sealGame(state);
    const replay = createReplay(state);

    const finished = await finishRun(
      request("/api/runs/finish", {
        ticket: startBody.ticket,
        durationMs: 500,
        replay,
      }),
    );
    expect(finished.status).toBe(200);
    const finishBody = (await finished.json()) as {
      verified: boolean;
      ranked: boolean;
      shareToken: string;
    };
    expect(finishBody).toMatchObject({ verified: true, ranked: false });

    const shared = await getSharedRun(
      new Request(
        `http://localhost/api/runs/${encodeURIComponent(finishBody.shareToken)}`,
      ),
      { params: Promise.resolve({ token: finishBody.shareToken }) },
    );
    expect(shared.status).toBe(200);
    await expect(shared.json()).resolves.toMatchObject({
      verified: true,
      run: {
        purpose: "share-run",
        ranked: false,
        board: expect.stringMatching(/^[-0-9a-z]{100}$/),
        colors: expect.stringMatching(/^[0-4]{24}$/),
      },
    });
  });

  it("rejects a replay whose transaction features do not match the level", async () => {
    const level = createPracticeManifest({
      reason: "test",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });
    const started = await startRun(
      request("/api/runs/start", {
        levelDigest: level.digest,
        levelNumber: level.source.number,
        levelHash: level.source.hash,
      }),
    );
    const { ticket } = (await started.json()) as { ticket: string };
    let state = createGame({
      blockHash: level.source.hash,
      transactions: levelToSimulationTransactions(level),
    });
    while (currentPiece(state)) {
      state = spillPiece(state, currentPiece(state)!.id);
    }
    state = sealGame(state);
    const replay = createReplay(state);
    const tampered = {
      ...replay,
      transactions: replay.transactions.map((features, index) =>
        index === 0
          ? { ...features, gasBucket: (features.gasBucket + 1) % 16 }
          : features,
      ),
    };

    const response = await finishRun(
      request("/api/runs/finish", {
        ticket,
        durationMs: 500,
        replay: tampered,
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "LEVEL_DATA_MISMATCH" },
    });
  });
});

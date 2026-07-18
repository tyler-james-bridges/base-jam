import { verifyReplay } from "@/game/simulation";
import {
  levelToSimulationTransactions,
  type LevelManifestV1,
} from "@/lib/base";

import type { ParsedGameReplay } from "./schemas";

export type VerifiedReplayResult =
  | {
      readonly ok: true;
      readonly score: number;
      readonly lines: number;
      readonly packedPercentage: number;
      readonly sealGrade: "S" | "A" | "B" | "C" | "D" | "F";
      readonly fingerprint: string;
      readonly board: string;
      readonly colors: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

function sameTransactions(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyLevelReplay(
  level: LevelManifestV1,
  replay: ParsedGameReplay,
): VerifiedReplayResult {
  if (replay.blockHash.toLowerCase() !== level.source.hash.toLowerCase()) {
    return {
      ok: false,
      code: "LEVEL_HASH_MISMATCH",
      message: "The replay was created for a different SQSH level.",
    };
  }

  const canonicalTransactions = levelToSimulationTransactions(level);
  if (!sameTransactions(replay.transactions, canonicalTransactions)) {
    return {
      ok: false,
      code: "LEVEL_DATA_MISMATCH",
      message: "The replay transaction features do not match the level manifest.",
    };
  }

  const verified = verifyReplay(replay);
  if (!verified.ok) {
    return {
      ok: false,
      code: verified.error.code,
      message: verified.error.message,
    };
  }

  const sealGrade = verified.state.sealGrade;
  if (!sealGrade) {
    return {
      ok: false,
      code: "GAME_NOT_SEALED",
      message: "A verified SQSH replay must be sealed.",
    };
  }

  const pieceIndexes = new Map(
    verified.state.pieces.map((piece, index) => [
      piece.id,
      index.toString(36),
    ]),
  );
  const board = verified.state.board
    .map((pieceId) => (pieceId === null ? "-" : pieceIndexes.get(pieceId) ?? "-"))
    .join("");
  const colors = verified.state.pieces
    .map((piece, index) =>
      ((piece.source.inputBucket + piece.source.valueBucket + index) % 5).toString(
        10,
      ),
    )
    .join("")
    .padEnd(24, "0")
    .slice(0, 24);

  return {
    ok: true,
    score: verified.state.score.total,
    lines:
      verified.state.completedRows.filter(Boolean).length +
      verified.state.completedColumns.filter(Boolean).length,
    packedPercentage: replay.expected.packedPercentage,
    sealGrade,
    fingerprint: verified.fingerprint,
    board,
    colors,
  };
}

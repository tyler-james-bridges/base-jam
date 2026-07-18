import {
  createPracticeManifest,
  fetchBaseLevel,
} from "@/lib/base/server";
import type { LevelManifestV1 } from "@/lib/base";

import { ApiError } from "./http";
import type { LevelIdentityInput } from "./schemas";

const BASE_BLOCK_NUMBER = /^\d{1,24}$/;
const PRACTICE_LEVEL =
  /^practice-(\d{4}-\d{2}-\d{2})(?:-for-(\d{1,24}))?$/;

function assertIdentity(
  level: LevelManifestV1,
  identity: LevelIdentityInput,
): LevelManifestV1 {
  if (
    level.digest.toLowerCase() !== identity.levelDigest.toLowerCase() ||
    level.source.hash.toLowerCase() !== identity.levelHash.toLowerCase()
  ) {
    throw new ApiError(
      409,
      "LEVEL_CHANGED",
      "The supplied level identity does not match the canonical BASE JAM level.",
    );
  }

  return level;
}

function practiceLevel(levelNumber: string): LevelManifestV1 | null {
  const match = PRACTICE_LEVEL.exec(levelNumber);
  if (!match) return null;

  const date = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) {
    return null;
  }

  return createPracticeManifest({
    reason: "This deterministic fallback level is practice-only.",
    requestedBlockNumber: match[2] ? BigInt(match[2]) : undefined,
    now: date,
  });
}

export async function resolveLevelIdentity(
  identity: LevelIdentityInput,
): Promise<LevelManifestV1> {
  if (BASE_BLOCK_NUMBER.test(identity.levelNumber)) {
    try {
      const level = await fetchBaseLevel(BigInt(identity.levelNumber));
      return assertIdentity(level, identity);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "BASE_UNAVAILABLE",
        "The Base level could not be confirmed right now. Try again shortly.",
      );
    }
  }

  const level = practiceLevel(identity.levelNumber);
  if (!level) {
    throw new ApiError(
      400,
      "INVALID_LEVEL",
      "The level number is not a recognized Base or BASE JAM practice level.",
    );
  }

  return assertIdentity(level, identity);
}

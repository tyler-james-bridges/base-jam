import { createPracticeManifest } from "@/lib/base/server";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const blockNumber = new URL(request.url).searchParams.get("block");
    if (blockNumber && !/^\d{1,24}$/.test(blockNumber)) {
      throw new ApiError(
        400,
        "INVALID_BLOCK_NUMBER",
        "Base block numbers must be non-negative decimal integers.",
      );
    }

    const level = createPracticeManifest({
      reason: "You chose the deterministic practice plate.",
      requestedBlockNumber: blockNumber ? BigInt(blockNumber) : undefined,
    });

    return jsonResponse({
      level,
      warning: level.fallbackReason,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { blockLevelOrPractice } from "@/lib/base/server";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly blockNumber: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { blockNumber: encodedBlockNumber } = await context.params;
    const blockNumber = decodeURIComponent(encodedBlockNumber);
    if (!/^\d{1,24}$/.test(blockNumber)) {
      throw new ApiError(
        400,
        "INVALID_BLOCK_NUMBER",
        "Base block numbers must be non-negative decimal integers.",
      );
    }

    const url = new URL(request.url);
    const level = await blockLevelOrPractice(BigInt(blockNumber), {
      enrichReceipts: url.searchParams.get("receipts") === "1",
    });

    return jsonResponse({
      level,
      ...(level.ranked
        ? {}
        : {
            warning:
              level.fallbackReason ??
              "This level is practice-only and cannot produce a ranked run.",
          }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { latestLevelOrPractice } from "@/lib/base/server";
import { errorResponse, jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const level = await latestLevelOrPractice({
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

import { latestMixOrPractice } from "@/lib/base/server";
import { errorResponse, jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const levels = await latestMixOrPractice(15);
    const ranked = levels.length === 15 && levels.every((level) => level.ranked);

    return jsonResponse({
      levels,
      ...(ranked
        ? {}
        : {
            warning:
              levels[0]?.fallbackReason ??
              "The live feed paused, so this mix uses deterministic practice data.",
          }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

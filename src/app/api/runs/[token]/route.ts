import {
  ApiError,
  errorResponse,
  jsonResponse,
  shareRunPayloadSchema,
  verifyCompact,
} from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly token: string }>;
}
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { token: encodedToken } = await context.params;
    const token = decodeURIComponent(encodedToken);
    if (token.length > 2_048) {
      throw new ApiError(
        400,
        "INVALID_SHARE_TOKEN",
        "The BASE JAM share token is too large.",
      );
    }

    const run = verifyCompact(token, shareRunPayloadSchema);
    const now = Math.floor(Date.now() / 1_000);
    if (run.createdAt > now + 30) {
      throw new ApiError(
        401,
        "INVALID_SHARE_TIME",
        "The BASE JAM share token was created in the future.",
      );
    }

    return jsonResponse(
      { verified: true, run },
      200,
      "public, max-age=300, s-maxage=86400, immutable",
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error);
    }
    return errorResponse(
      new ApiError(
        401,
        "INVALID_SHARE_TOKEN",
        "This BASE JAM share token is invalid or no longer verifiable.",
      ),
    );
  }
}

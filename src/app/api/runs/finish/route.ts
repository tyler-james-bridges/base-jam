import {
  ApiError,
  createShareToken,
  errorResponse,
  finishRunSchema,
  jsonResponse,
  parseJsonBody,
  resolveLevelIdentity,
  runTicketPayloadSchema,
  verifyCompact,
  verifyLevelReplay,
} from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLOCK_SKEW_SECONDS = 30;
const DURATION_GRACE_MS = 10_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseJsonBody(request, finishRunSchema);
    const ticket = verifyCompact(input.ticket, runTicketPayloadSchema);
    const now = Math.floor(Date.now() / 1_000);

    if (ticket.issuedAt > now + CLOCK_SKEW_SECONDS) {
      throw new ApiError(
        401,
        "INVALID_TICKET_TIME",
        "The run ticket was issued in the future.",
      );
    }
    if (ticket.expiresAt < now) {
      throw new ApiError(
        401,
        "TICKET_EXPIRED",
        "This run took too long to submit. Start a new run and try again.",
      );
    }
    const maximumPlausibleDuration =
      (now - ticket.issuedAt) * 1_000 + DURATION_GRACE_MS;
    if (input.durationMs > maximumPlausibleDuration) {
      throw new ApiError(
        400,
        "INVALID_DURATION",
        "The submitted duration is longer than the ticket has existed.",
      );
    }

    const level = await resolveLevelIdentity({
      levelDigest: ticket.levelDigest,
      levelNumber: ticket.levelNumber,
      levelHash: ticket.levelHash,
    });
    if (ticket.ranked && !level.ranked) {
      throw new ApiError(
        409,
        "RANKING_CHANGED",
        "The ranking status of this level could not be confirmed.",
      );
    }

    const verified = verifyLevelReplay(level, input.replay);
    if (!verified.ok) {
      throw new ApiError(422, verified.code, verified.message);
    }

    const { token: shareToken, payload } = createShareToken({
      levelDigest: level.digest,
      levelNumber: level.source.number,
      levelHash: level.source.hash,
      ranked: ticket.ranked,
      score: verified.score,
      lines: verified.lines,
      durationMs: input.durationMs,
      packedPercentage: verified.packedPercentage,
      sealGrade: verified.sealGrade,
      fingerprint: verified.fingerprint,
      board: verified.board,
      colors: verified.colors,
    });

    return jsonResponse({
      verified: true,
      ranked: payload.ranked,
      score: payload.score,
      lines: payload.lines,
      packedPercentage: payload.packedPercentage,
      sealGrade: payload.sealGrade,
      fingerprint: payload.fingerprint,
      board: payload.board,
      colors: payload.colors,
      durationMs: payload.durationMs,
      shareToken,
      sharePath: `/run/${encodeURIComponent(shareToken)}`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

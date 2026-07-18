import {
  createRunTicket,
  errorResponse,
  jsonResponse,
  levelIdentitySchema,
  parseJsonBody,
  resolveLevelIdentity,
} from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await parseJsonBody(request, levelIdentitySchema, 8 * 1_024);
    const level = await resolveLevelIdentity(identity);
    const { ticket, payload } = createRunTicket(level, {
      forcePractice: identity.practice === true,
    });

    return jsonResponse({
      ticket,
      expiresAt: new Date(payload.expiresAt * 1_000).toISOString(),
      ranked: payload.ranked,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

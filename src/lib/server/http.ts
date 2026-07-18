import type { z } from "zod";

const DEFAULT_MAX_BODY_BYTES = 96 * 1_024;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<z.output<S>> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "The request body is too large.");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "The request body is too large.");
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "A valid JSON body is required.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "The request does not match the expected BASE JAM API format.",
    );
  }

  return parsed.data;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  cacheControl = "no-store",
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }

  return jsonResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "BASE JAM could not complete this request.",
      },
    },
    500,
  );
}

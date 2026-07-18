import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { z } from "zod";

import type {
  LevelManifestV1,
  RunTicketPayloadV1,
  ShareRunPayloadV1,
} from "@/lib/base";

const LOCAL_DEVELOPMENT_SECRET =
  "base-jam-local-development-signing-key-not-for-production";
const SIGNATURE_PREFIX = "basejam.signed.v1.";
const RUN_TICKET_TTL_SECONDS = 15 * 60;
const MAX_SIGNED_VALUE_BYTES = 4_096;

export class SigningConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningConfigurationError";
  }
}

export class InvalidSignedValueError extends Error {
  constructor(message = "The signed value is invalid.") {
    super(message);
    this.name = "InvalidSignedValueError";
  }
}

function signingSecret(): string {
  const configured =
    process.env.BASE_JAM_RUN_SIGNING_SECRET?.trim() ||
    process.env.RUN_TICKET_SECRET?.trim();

  if (configured) {
    if (Buffer.byteLength(configured, "utf8") < 32) {
      throw new SigningConfigurationError(
        "BASE_JAM_RUN_SIGNING_SECRET must contain at least 32 bytes.",
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new SigningConfigurationError(
      "BASE_JAM_RUN_SIGNING_SECRET is required in production.",
    );
  }

  return LOCAL_DEVELOPMENT_SECRET;
}

function signatureFor(encodedPayload: string): Buffer {
  return createHmac("sha256", signingSecret())
    .update(`${SIGNATURE_PREFIX}${encodedPayload}`, "utf8")
    .digest();
}

export function signCompact(payload: object): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signatureFor(encodedPayload).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyCompact<S extends z.ZodType>(
  token: string,
  schema: S,
): z.output<S> {
  if (
    Buffer.byteLength(token, "utf8") > MAX_SIGNED_VALUE_BYTES ||
    token.split(".").length !== 2
  ) {
    throw new InvalidSignedValueError();
  }

  const [encodedPayload, encodedSignature] = token.split(".");
  let providedSignature: Buffer;
  let payloadText: string;

  try {
    providedSignature = Buffer.from(encodedSignature, "base64url");
    payloadText = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    throw new InvalidSignedValueError();
  }

  // Reject non-canonical base64url spellings. Without this check, changing
  // unused trailing bits can produce a different token string that decodes to
  // the same signature bytes.
  if (
    providedSignature.toString("base64url") !== encodedSignature ||
    Buffer.from(payloadText, "utf8").toString("base64url") !== encodedPayload
  ) {
    throw new InvalidSignedValueError();
  }

  const expectedSignature = signatureFor(encodedPayload);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new InvalidSignedValueError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new InvalidSignedValueError();
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new InvalidSignedValueError();
  }

  return result.data;
}

export function createRunTicket(
  level: LevelManifestV1,
  options: { readonly forcePractice?: boolean } = {},
): {
  readonly ticket: string;
  readonly payload: RunTicketPayloadV1;
} {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const payload: RunTicketPayloadV1 = {
    version: 1,
    purpose: "run-ticket",
    ticketId: randomUUID(),
    levelDigest: level.digest,
    levelNumber: level.source.number,
    levelHash: level.source.hash,
    ranked: options.forcePractice ? false : level.ranked,
    issuedAt,
    expiresAt: issuedAt + RUN_TICKET_TTL_SECONDS,
  };

  return { ticket: signCompact(payload), payload };
}

export function createShareToken(
  result: Omit<ShareRunPayloadV1, "version" | "purpose" | "runId" | "createdAt">,
): {
  readonly token: string;
  readonly payload: ShareRunPayloadV1;
} {
  const payload: ShareRunPayloadV1 = {
    version: 1,
    purpose: "share-run",
    runId: randomBytes(9).toString("base64url"),
    ...result,
    createdAt: Math.floor(Date.now() / 1_000),
  };

  return { token: signCompact(payload), payload };
}

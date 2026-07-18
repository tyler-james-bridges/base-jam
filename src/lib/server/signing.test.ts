import { describe, expect, it } from "vitest";

import { createPracticeManifest } from "@/lib/base/server";

import { runTicketPayloadSchema } from "./schemas";
import {
  createRunTicket,
  InvalidSignedValueError,
  verifyCompact,
} from "./signing";

describe("stateless HMAC tickets", () => {
  it("round-trips a signed run ticket and rejects tampering", () => {
    const level = createPracticeManifest({
      reason: "test",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });
    const { ticket, payload } = createRunTicket(level);

    expect(verifyCompact(ticket, runTicketPayloadSchema)).toEqual(payload);

    const tampered = `${ticket.slice(0, -1)}${ticket.endsWith("a") ? "b" : "a"}`;
    expect(() => verifyCompact(tampered, runTicketPayloadSchema)).toThrow(
      InvalidSignedValueError,
    );
  });

  it("allows a canonical level to be safely downgraded to practice", () => {
    const level = {
      ...createPracticeManifest({
        reason: "test",
        now: new Date("2026-07-18T12:00:00.000Z"),
      }),
      ranked: true,
    };
    const { payload } = createRunTicket(level, { forcePractice: true });

    expect(payload.ranked).toBe(false);
  });
});

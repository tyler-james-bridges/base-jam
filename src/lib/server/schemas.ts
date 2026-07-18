import { z } from "zod";

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as `0x${string}`);

const transactionFeaturesSchema = z
  .object({
    gasBucket: z.number().int().min(0).max(15),
    feeBucket: z.number().int().min(0).max(15),
    inputBucket: z.number().int().min(0).max(7),
    valueBucket: z.number().int().min(0).max(7),
  })
  .strict();

const placeActionSchema = z
  .object({
    type: z.literal("place"),
    pieceId: z.string().min(1).max(64),
    x: z.number().int().min(-100).max(100),
    y: z.number().int().min(-100).max(100),
    rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

const spillActionSchema = z
  .object({
    type: z.literal("spill"),
    pieceId: z.string().min(1).max(64),
  })
  .strict();

const undoActionSchema = z
  .object({
    type: z.literal("undo"),
  })
  .strict();

const sealActionSchema = z
  .object({
    type: z.literal("seal"),
  })
  .strict();

export const gameReplaySchema = z
  .object({
    version: z.literal(1),
    blockHash: hex32,
    transactions: z.array(transactionFeaturesSchema).max(24),
    actions: z
      .array(
        z.discriminatedUnion("type", [
          placeActionSchema,
          spillActionSchema,
          undoActionSchema,
          sealActionSchema,
        ]),
      )
      .max(128),
    expected: z
      .object({
        score: z.number().int().min(0).max(10_000_000),
        packedPercentage: z.number().int().min(0).max(100),
        sealGrade: z.enum(["S", "A", "B", "C", "D", "F"]),
        fingerprint: z.string().regex(/^[a-z0-9]+-[0-9a-f]{8}$/i),
      })
      .strict(),
  })
  .strict();

export const levelIdentitySchema = z
  .object({
    levelDigest: hex32,
    levelNumber: z.string().min(1).max(96),
    levelHash: hex32,
    practice: z.boolean().optional(),
  })
  .strict();

export const finishRunSchema = z
  .object({
    ticket: z.string().min(40).max(2_048),
    durationMs: z.number().int().min(250).max(10 * 60 * 1_000),
    replay: gameReplaySchema,
  })
  .strict();

export const runTicketPayloadSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("run-ticket"),
    ticketId: z.string().uuid(),
    levelDigest: hex32,
    levelNumber: z.string().min(1).max(96),
    levelHash: hex32,
    ranked: z.boolean(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const shareRunPayloadSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("share-run"),
    runId: z.string().min(8).max(32),
    levelDigest: hex32,
    levelNumber: z.string().min(1).max(96),
    levelHash: hex32,
    ranked: z.boolean(),
    score: z.number().int().min(0).max(10_000_000),
    lines: z.number().int().min(0).max(20),
    durationMs: z.number().int().min(250).max(10 * 60 * 1_000),
    packedPercentage: z.number().int().min(0).max(100),
    sealGrade: z.enum(["S", "A", "B", "C", "D", "F"]),
    fingerprint: z.string().regex(/^[a-z0-9]+-[0-9a-f]{8}$/i),
    board: z.string().regex(/^[-0-9a-z]{100}$/),
    colors: z.string().regex(/^[0-4]{24}$/),
    createdAt: z.number().int().positive(),
  })
  .strict();

export type LevelIdentityInput = z.infer<typeof levelIdentitySchema>;
export type FinishRunInput = z.infer<typeof finishRunSchema>;
export type ParsedGameReplay = z.infer<typeof gameReplaySchema>;
export type ParsedRunTicket = z.infer<typeof runTicketPayloadSchema>;
export type ParsedShareRun = z.infer<typeof shareRunPayloadSchema>;

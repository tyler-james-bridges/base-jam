export const BASE_CHAIN_ID = 8453 as const;
export const LEVEL_SCHEMA_VERSION = "1" as const;
export const SQSH_RULESET_VERSION = "sqsh-v1" as const;
export const MAX_LEVEL_PIECES = 24 as const;

export type HexString = `0x${string}`;
export type LevelSourceKind = "base" | "practice";
export type PieceStatus = "success" | "reverted";

export interface LevelSourceV1 {
  readonly kind: LevelSourceKind;
  readonly number: string;
  readonly hash: HexString;
  readonly timestamp: string;
  readonly gasUsed: string;
  readonly gasLimit: string;
  readonly baseFeePerGas: string;
  readonly txCount: number;
  readonly explorerUrl: string;
  /**
   * Distance from the RPC tip when this level was created. Practice levels use 0.
   * A Base level is only ranked when this is at least three.
   */
  readonly confirmations: number;
}

export interface LevelPieceV1 {
  readonly id: string;
  readonly hash: HexString;
  readonly type: string;
  readonly from: HexString;
  readonly to: HexString | null;
  readonly value: string;
  readonly calldataBytes: number;
  readonly selector: HexString | null;
  readonly gasLimit: string;
  readonly maxFeePerGas: string | null;
  readonly maxPriorityFeePerGas: string | null;
  readonly actualGasUsed?: string;
  readonly status?: PieceStatus;
}

/**
 * Canonical, JSON-safe level input. Bigints are encoded as base-10 strings.
 * Consumers should treat this object as immutable.
 */
export interface LevelManifestV1 {
  readonly schemaVersion: typeof LEVEL_SCHEMA_VERSION;
  readonly rulesetVersion: typeof SQSH_RULESET_VERSION;
  readonly chainId: typeof BASE_CHAIN_ID;
  readonly ranked: boolean;
  readonly source: LevelSourceV1;
  readonly seed: HexString;
  readonly digest: HexString;
  readonly pieces: readonly LevelPieceV1[];
  readonly generatedAt: string;
  readonly fallbackReason?: string;
}

export interface LevelApiResponse {
  readonly level: LevelManifestV1;
  readonly warning?: string;
}

export interface RunTicketPayloadV1 {
  readonly version: 1;
  readonly purpose: "run-ticket";
  readonly ticketId: string;
  readonly levelDigest: HexString;
  readonly levelNumber: string;
  readonly levelHash: HexString;
  readonly ranked: boolean;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface ShareRunPayloadV1 {
  readonly version: 1;
  readonly purpose: "share-run";
  readonly runId: string;
  readonly levelDigest: HexString;
  readonly levelNumber: string;
  readonly levelHash: HexString;
  readonly ranked: boolean;
  readonly score: number;
  readonly lines: number;
  readonly durationMs: number;
  readonly packedPercentage: number;
  readonly sealGrade: "S" | "A" | "B" | "C" | "D" | "F";
  readonly fingerprint: string;
  /** 100 board cells: "-" for empty or a base36 piece index. */
  readonly board: string;
  /** 24 palette indexes (0-4), padded with zeroes when a level has fewer pieces. */
  readonly colors: string;
  readonly createdAt: number;
}

import {
  createPublicClient,
  http,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { baseChain } from "./chain";

import { createBaseManifest, createPracticeManifest } from "./manifest";
import type { HexString, LevelManifestV1 } from "./types";

const DEVELOPMENT_RPC_URL = "https://mainnet.base.org";
const SAFE_BLOCK_DEPTH = BigInt(3);
const ZERO = BigInt(0);
const RPC_TIMEOUT_MS = 8_000;
const RPC_RETRY_COUNT = 2;
const RECEIPT_BATCH_SIZE = 6;

export class BaseRpcConfigurationError extends Error {
  constructor() {
    super(
      "BASE_RPC_HTTP_URL is required in production. The public Base RPC is development-only.",
    );
    this.name = "BaseRpcConfigurationError";
  }
}

function rpcUrl(): string {
  const configured = process.env.BASE_RPC_HTTP_URL?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEVELOPMENT_RPC_URL;
  }

  throw new BaseRpcConfigurationError();
}

function baseClient() {
  return createPublicClient({
    chain: baseChain,
    transport: http(rpcUrl(), {
      retryCount: RPC_RETRY_COUNT,
      retryDelay: 350,
      timeout: RPC_TIMEOUT_MS,
    }),
  });
}

async function enrichReceipts(
  hashes: readonly HexString[],
): Promise<ReadonlyMap<HexString, TransactionReceipt>> {
  const client = baseClient();
  const receipts = new Map<HexString, TransactionReceipt>();

  for (let offset = 0; offset < hashes.length; offset += RECEIPT_BATCH_SIZE) {
    const batch = hashes.slice(offset, offset + RECEIPT_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((hash) => client.getTransactionReceipt({ hash: hash as Hash })),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        receipts.set(batch[index], result.value);
      }
    });
  }

  return receipts;
}

export interface FetchLevelOptions {
  readonly enrichReceipts?: boolean;
}

async function manifestForBlock(
  blockNumber: bigint,
  tip: bigint,
  options: FetchLevelOptions,
): Promise<LevelManifestV1> {
  const client = baseClient();
  const block = await client.getBlock({
    blockNumber,
    includeTransactions: true,
  });
  const baseManifest = createBaseManifest(block, { tip });

  if (!options.enrichReceipts) {
    return baseManifest;
  }

  const receipts = await enrichReceipts(baseManifest.pieces.map((piece) => piece.hash));
  return createBaseManifest(block, { tip, receipts });
}

export async function fetchLatestBaseLevel(
  options: FetchLevelOptions = {},
): Promise<LevelManifestV1> {
  const client = baseClient();
  const tip = await client.getBlockNumber({ cacheTime: 0 });
  const blockNumber = tip > SAFE_BLOCK_DEPTH ? tip - SAFE_BLOCK_DEPTH : ZERO;

  return manifestForBlock(blockNumber, tip, options);
}

export async function fetchBaseLevel(
  blockNumber: bigint,
  options: FetchLevelOptions = {},
): Promise<LevelManifestV1> {
  if (blockNumber < ZERO) {
    throw new RangeError("Block number must be non-negative.");
  }

  const client = baseClient();
  const tip = await client.getBlockNumber({ cacheTime: 0 });

  if (blockNumber > tip) {
    throw new RangeError("Block number is ahead of the current Base tip.");
  }

  return manifestForBlock(blockNumber, tip, options);
}

export async function latestLevelOrPractice(
  options: FetchLevelOptions = {},
): Promise<LevelManifestV1> {
  try {
    return await fetchLatestBaseLevel(options);
  } catch (error) {
    return createPracticeManifest({
      reason:
        error instanceof BaseRpcConfigurationError
          ? error.message
          : "Base data is temporarily unavailable. This deterministic practice level is not ranked.",
    });
  }
}

export async function blockLevelOrPractice(
  blockNumber: bigint,
  options: FetchLevelOptions = {},
): Promise<LevelManifestV1> {
  try {
    return await fetchBaseLevel(blockNumber, options);
  } catch (error) {
    return createPracticeManifest({
      reason:
        error instanceof BaseRpcConfigurationError
          ? error.message
          : `Base block ${blockNumber.toString(10)} could not be loaded. This deterministic fallback is practice-only.`,
      requestedBlockNumber: blockNumber,
    });
  }
}

import {
  createPublicClient,
  fallback,
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
const PUBLIC_BASE_RPC_HOSTS = new Set([
  "mainnet.base.org",
  "mainnet-preconf.base.org",
]);

export class BaseRpcConfigurationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "A dedicated Base RPC URL is required in production. Base's public RPC is development-only.",
    );
    this.name = "BaseRpcConfigurationError";
  }
}

type RpcEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "BASE_RPC_HTTP_URL" | "BASE_RPC_HTTP_URLS" | "NODE_ENV"
  >
>;

function parsedRpcUrl(value: string, production: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BaseRpcConfigurationError(
      "Base RPC configuration contains an invalid URL.",
    );
  }

  const localHttp =
    !production &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new BaseRpcConfigurationError(
      "Base RPC URLs must use HTTPS in production.",
    );
  }

  return url;
}

export function resolveBaseRpcUrls(
  environment: RpcEnvironment = process.env,
): readonly string[] {
  const production = environment.NODE_ENV === "production";
  const configured = [
    ...(environment.BASE_RPC_HTTP_URLS?.split(",") ?? []),
    environment.BASE_RPC_HTTP_URL ?? "",
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const urls = [...new Set(configured)];

  if (urls.length === 0 && !production) {
    return [DEVELOPMENT_RPC_URL];
  }

  if (urls.length === 0) {
    throw new BaseRpcConfigurationError();
  }

  const parsed = urls.map((value) => parsedRpcUrl(value, production));
  if (
    production &&
    parsed.every((url) => PUBLIC_BASE_RPC_HOSTS.has(url.hostname))
  ) {
    throw new BaseRpcConfigurationError(
      "Production needs a dedicated Base node provider; Base's public endpoints are rate-limited.",
    );
  }

  return urls;
}

function baseClient() {
  const transports = resolveBaseRpcUrls().map((url) =>
    http(url, {
      batch: {
        batchSize: RECEIPT_BATCH_SIZE,
        wait: 0,
      },
      retryCount: RPC_RETRY_COUNT,
      retryDelay: 350,
      timeout: RPC_TIMEOUT_MS,
    }),
  );

  return createPublicClient({
    chain: baseChain,
    transport:
      transports.length === 1
        ? transports[0]
        : fallback(transports, { rank: true }),
  });
}

async function enrichReceipts(
  client: ReturnType<typeof baseClient>,
  hashes: readonly HexString[],
): Promise<ReadonlyMap<HexString, TransactionReceipt>> {
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
  client: ReturnType<typeof baseClient>,
  blockNumber: bigint,
  tip: bigint,
  options: FetchLevelOptions,
): Promise<LevelManifestV1> {
  const block = await client.getBlock({
    blockNumber,
    includeTransactions: true,
  });
  const baseManifest = createBaseManifest(block, { tip });

  if (!options.enrichReceipts) {
    return baseManifest;
  }

  const receipts = await enrichReceipts(
    client,
    baseManifest.pieces.map((piece) => piece.hash),
  );
  return createBaseManifest(block, { tip, receipts });
}

export async function fetchLatestBaseLevel(
  options: FetchLevelOptions = {},
): Promise<LevelManifestV1> {
  const client = baseClient();
  const tip = await client.getBlockNumber({ cacheTime: 0 });
  const blockNumber = tip > SAFE_BLOCK_DEPTH ? tip - SAFE_BLOCK_DEPTH : ZERO;

  return manifestForBlock(client, blockNumber, tip, options);
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

  return manifestForBlock(client, blockNumber, tip, options);
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

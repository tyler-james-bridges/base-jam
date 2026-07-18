import {
  concatHex,
  type GetBlockReturnType,
  keccak256,
  stringToHex,
  type TransactionReceipt,
} from "viem";
import { baseChain } from "./chain";

import {
  BASE_CHAIN_ID,
  LEVEL_SCHEMA_VERSION,
  MAX_LEVEL_PIECES,
  SQSH_RULESET_VERSION,
  type HexString,
  type LevelManifestV1,
  type LevelPieceV1,
} from "./types";

type FullBlock = GetBlockReturnType<typeof baseChain, true, "latest">;
type FullTransaction = FullBlock["transactions"][number];
const ZERO = BigInt(0);

export interface BaseManifestOptions {
  readonly tip: bigint;
  readonly receipts?: ReadonlyMap<HexString, TransactionReceipt>;
}

export interface PracticeManifestOptions {
  readonly reason: string;
  readonly requestedBlockNumber?: bigint;
  readonly now?: Date;
}

function bigintOrNull(value: unknown): string | null {
  return typeof value === "bigint" ? value.toString(10) : null;
}

function inputBytes(input: HexString): number {
  return Math.max(0, (input.length - 2) / 2);
}

function selectorFor(input: HexString): HexString | null {
  return input.length >= 10 ? (input.slice(0, 10) as HexString) : null;
}

function isDepositTransaction(transaction: FullTransaction): boolean {
  return (
    transaction.typeHex?.toLowerCase() === "0x7e" ||
    transaction.type.toLowerCase() === "deposit" ||
    transaction.type.toLowerCase() === "0x7e"
  );
}

function sampleTransactions(
  blockHash: HexString,
  transactions: readonly FullTransaction[],
): readonly FullTransaction[] {
  const eligible = transactions.filter((transaction) => !isDepositTransaction(transaction));

  if (eligible.length <= MAX_LEVEL_PIECES) {
    return [...eligible].sort((a, b) => a.transactionIndex - b.transactionIndex);
  }

  return eligible
    .map((transaction) => ({
      transaction,
      sortKey: keccak256(concatHex([blockHash, transaction.hash])),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(0, MAX_LEVEL_PIECES)
    .map(({ transaction }) => transaction)
    .sort((a, b) => a.transactionIndex - b.transactionIndex);
}

function transactionToPiece(
  transaction: FullTransaction,
  receipt?: TransactionReceipt,
): LevelPieceV1 {
  const gasPrice =
    "maxFeePerGas" in transaction
      ? bigintOrNull(transaction.maxFeePerGas)
      : "gasPrice" in transaction
        ? bigintOrNull(transaction.gasPrice)
        : null;
  const priorityFee =
    "maxPriorityFeePerGas" in transaction
      ? bigintOrNull(transaction.maxPriorityFeePerGas)
      : null;

  return {
    id: transaction.transactionIndex.toString(10),
    hash: transaction.hash,
    type: transaction.typeHex ?? transaction.type,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value.toString(10),
    calldataBytes: inputBytes(transaction.input),
    selector: selectorFor(transaction.input),
    gasLimit: transaction.gas.toString(10),
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: priorityFee,
    ...(receipt
      ? {
          actualGasUsed: receipt.gasUsed.toString(10),
          status: receipt.status,
        }
      : {}),
  };
}

function manifestDigest(input: {
  readonly source: LevelManifestV1["source"];
  readonly seed: HexString;
  readonly pieces: readonly LevelPieceV1[];
}): HexString {
  const canonicalPieces = input.pieces.map((piece) => ({
    id: piece.id,
    hash: piece.hash,
    type: piece.type,
    from: piece.from,
    to: piece.to,
    value: piece.value,
    calldataBytes: piece.calldataBytes,
    selector: piece.selector,
    gasLimit: piece.gasLimit,
    maxFeePerGas: piece.maxFeePerGas,
    maxPriorityFeePerGas: piece.maxPriorityFeePerGas,
  }));

  return keccak256(
    stringToHex(
      JSON.stringify({
        schemaVersion: LEVEL_SCHEMA_VERSION,
        rulesetVersion: SQSH_RULESET_VERSION,
        chainId: BASE_CHAIN_ID,
        source: input.source,
        seed: input.seed,
        pieces: canonicalPieces,
      }),
    ),
  );
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }

  return value;
}

export function createBaseManifest(
  block: FullBlock,
  options: BaseManifestOptions,
): LevelManifestV1 {
  const confirmations =
    options.tip >= block.number ? Number(options.tip - block.number) : 0;
  const source = {
    kind: "base" as const,
    number: block.number.toString(10),
    hash: block.hash,
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    gasUsed: block.gasUsed.toString(10),
    gasLimit: block.gasLimit.toString(10),
    baseFeePerGas: (block.baseFeePerGas ?? ZERO).toString(10),
    txCount: block.transactions.length,
    explorerUrl: `https://basescan.org/block/${block.number.toString(10)}`,
    confirmations,
  };
  const seed = keccak256(
    concatHex([block.hash, block.parentHash, block.transactionsRoot]),
  );
  const pieces = sampleTransactions(block.hash, block.transactions).map((transaction) =>
    transactionToPiece(transaction, options.receipts?.get(transaction.hash)),
  );
  const digest = manifestDigest({ source, seed, pieces });
  const ranked = confirmations >= 3;

  return deepFreeze({
    schemaVersion: LEVEL_SCHEMA_VERSION,
    rulesetVersion: SQSH_RULESET_VERSION,
    chainId: BASE_CHAIN_ID,
    ranked,
    source,
    seed,
    digest,
    pieces,
    generatedAt: source.timestamp,
    ...(!ranked
      ? {
          fallbackReason:
            "This Base block is fewer than three blocks behind the RPC tip, so this run is practice-only.",
        }
      : {}),
  });
}

function practicePiece(seed: HexString, index: number): LevelPieceV1 {
  const hash = keccak256(concatHex([seed, stringToHex(`piece:${index}`)]));
  const addressSeed = keccak256(concatHex([hash, seed]));
  const address = `0x${addressSeed.slice(-40)}` as HexString;
  const targetSeed = keccak256(concatHex([addressSeed, hash]));
  const target = `0x${targetSeed.slice(-40)}` as HexString;
  const numeric = BigInt(`0x${hash.slice(2, 18)}`);
  const calldataBytes = Number(numeric % BigInt(512));

  return {
    id: `practice-${index}`,
    hash,
    type: index % 5 === 0 ? "0x0" : "0x2",
    from: address,
    to: index % 7 === 0 ? null : target,
    value: (numeric % BigInt("10000000000000000")).toString(10),
    calldataBytes,
    selector: calldataBytes >= 4 ? (`0x${hash.slice(2, 10)}` as HexString) : null,
    gasLimit: (BigInt(21_000) + (numeric % BigInt(2_000_000))).toString(10),
    maxFeePerGas: (
      BigInt(1_000_000) + (numeric % BigInt(10_000_000))
    ).toString(10),
    maxPriorityFeePerGas: (numeric % BigInt(1_000_000)).toString(10),
  };
}

export function createPracticeManifest(
  options: PracticeManifestOptions,
): LevelManifestV1 {
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const seedLabel = options.requestedBlockNumber
    ? `${day}:requested:${options.requestedBlockNumber.toString(10)}`
    : `${day}:latest`;
  const seed = keccak256(stringToHex(`sqsh-practice:${seedLabel}`));
  const pieces = Array.from({ length: 18 }, (_, index) => practicePiece(seed, index));
  const timestamp = `${day}T00:00:00.000Z`;
  const source = {
    kind: "practice" as const,
    number: options.requestedBlockNumber
      ? `practice-${day}-for-${options.requestedBlockNumber.toString(10)}`
      : `practice-${day}`,
    hash: keccak256(concatHex([seed, stringToHex("not-a-base-block")])),
    timestamp,
    gasUsed: "0",
    gasLimit: "0",
    baseFeePerGas: "0",
    txCount: pieces.length,
    explorerUrl: "",
    confirmations: 0,
  };
  const digest = manifestDigest({ source, seed, pieces });

  return deepFreeze({
    schemaVersion: LEVEL_SCHEMA_VERSION,
    rulesetVersion: SQSH_RULESET_VERSION,
    chainId: BASE_CHAIN_ID,
    ranked: false,
    source,
    seed,
    digest,
    pieces,
    generatedAt: timestamp,
    fallbackReason: options.reason,
  });
}

import { Xoshiro128StarStar, normalizeBlockHash } from "./prng";
import {
  MAX_PIECES,
  type Cell,
  type CompactTransactionFeatures,
  type Piece,
  type PieceKind,
  type QuarterTurn,
  SimulationError,
} from "./types";

interface PieceTemplate {
  readonly kind: PieceKind;
  readonly cells: readonly Cell[];
}

const PIECE_TEMPLATES: readonly PieceTemplate[] = [
  { kind: "MONO", cells: [{ x: 0, y: 0 }] },
  {
    kind: "DOMINO",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  },
  {
    kind: "TRI_I",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  },
  {
    kind: "TRI_L",
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    kind: "TET_I",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ],
  },
  {
    kind: "TET_O",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    kind: "TET_T",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
    ],
  },
  {
    kind: "TET_L",
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ],
  },
  {
    kind: "TET_J",
    cells: [
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ],
  },
  {
    kind: "TET_S",
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  },
  {
    kind: "TET_Z",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
  },
  {
    kind: "PENTA_P",
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
    ],
  },
  {
    kind: "PENTA_U",
    cells: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
  },
  {
    kind: "PENTA_V",
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
  },
] as const;

function assertBucket(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new SimulationError(
      "INVALID_TRANSACTION_FEATURE",
      `${name} must be an integer from 0 through ${max}.`,
    );
  }
}

export function validateTransactionFeatures(
  features: CompactTransactionFeatures,
): void {
  assertBucket("gasBucket", features.gasBucket, 15);
  assertBucket("feeBucket", features.feeBucket, 15);
  assertBucket("inputBucket", features.inputBucket, 7);
  assertBucket("valueBucket", features.valueBucket, 7);
}

function normalized(cells: readonly Cell[]): readonly Cell[] {
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));

  return cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
}

export function rotateCells(
  cells: readonly Cell[],
  rotation: QuarterTurn,
): readonly Cell[] {
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
    throw new SimulationError(
      "INVALID_ROTATION",
      "Rotation must be an integer quarter-turn from 0 through 3.",
    );
  }

  let rotated = cells.map((cell) => ({ ...cell }));
  for (let turn = 0; turn < rotation; turn += 1) {
    rotated = rotated.map((cell) => ({ x: -cell.y, y: cell.x }));
  }

  return normalized(rotated);
}

function templateIndex(
  features: CompactTransactionFeatures,
  entropy: number,
): number {
  const featureMix =
    features.gasBucket * 97 +
    features.feeBucket * 53 +
    features.inputBucket * 29 +
    features.valueBucket * 11;
  return (((featureMix >>> 0) ^ entropy) >>> 0) % PIECE_TEMPLATES.length;
}

export function generatePieces(
  blockHash: string,
  transactions: readonly CompactTransactionFeatures[],
  pieceLimit = MAX_PIECES,
): readonly Piece[] {
  normalizeBlockHash(blockHash);
  if (!Number.isInteger(pieceLimit) || pieceLimit < 0 || pieceLimit > MAX_PIECES) {
    throw new SimulationError(
      "INVALID_PIECE_LIMIT",
      `Piece limit must be an integer from 0 through ${MAX_PIECES}.`,
    );
  }

  const selected = transactions.slice(0, pieceLimit);
  const prng = new Xoshiro128StarStar(blockHash);

  return selected.map((source, index) => {
    validateTransactionFeatures(source);
    const template = PIECE_TEMPLATES[templateIndex(source, prng.nextUint32())];
    return {
      id: `tx-${index.toString(36).padStart(2, "0")}`,
      kind: template.kind,
      cells: template.cells.map((cell) => ({ ...cell })),
      source: { ...source },
    };
  });
}

export function getPieceTemplate(kind: PieceKind): readonly Cell[] {
  const template = PIECE_TEMPLATES.find((candidate) => candidate.kind === kind);
  if (!template) {
    throw new SimulationError("UNKNOWN_PIECE", `Unknown piece kind: ${kind}`);
  }
  return template.cells.map((cell) => ({ ...cell }));
}

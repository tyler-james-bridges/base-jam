import { generatePieces, rotateCells } from "./pieces";
import { normalizeBlockHash } from "./prng";
import {
  BOARD_CELLS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_PIECES,
  type CompactTransactionFeatures,
  type GameState,
  type Placement,
  type PlacementValidation,
  type QuarterTurn,
  type ReplayAction,
  type ScoreBreakdown,
  type SealGrade,
  type UndoCheckpoint,
  SimulationError,
} from "./types";

const PLACEMENT_POINTS_PER_CELL = 100;
const ADJACENCY_POINTS_PER_EDGE = 25;
const LINE_POINTS = 1_000;
const SPILL_PENALTY_PER_CELL = 25;

export interface CreateGameOptions {
  readonly blockHash: string;
  readonly transactions: readonly CompactTransactionFeatures[];
  readonly pieceLimit?: number;
}

function emptyScore(): ScoreBreakdown {
  return {
    placement: 0,
    adjacency: 0,
    lines: 0,
    spillPenalty: 0,
    total: 0,
  };
}

export function createGame(options: CreateGameOptions): GameState {
  const blockHash = normalizeBlockHash(options.blockHash);
  const pieceLimit = options.pieceLimit ?? MAX_PIECES;
  const transactions = options.transactions
    .slice(0, pieceLimit)
    .map((features) => ({ ...features }));
  const pieces = generatePieces(blockHash, transactions, pieceLimit);

  return {
    blockHash,
    transactions,
    pieces,
    board: Array<string | null>(BOARD_CELLS).fill(null),
    cursor: 0,
    placements: [],
    spilled: [],
    completedRows: Array<boolean>(BOARD_HEIGHT).fill(false),
    completedColumns: Array<boolean>(BOARD_WIDTH).fill(false),
    score: emptyScore(),
    undoAvailable: true,
    undoCheckpoint: null,
    sealed: false,
    sealGrade: null,
    actions: [],
  };
}

export function currentPiece(state: GameState) {
  return state.pieces[state.cursor] ?? null;
}

function boardIndex(x: number, y: number): number {
  return y * BOARD_WIDTH + x;
}

function absoluteCells(
  state: GameState,
  x: number,
  y: number,
  rotation: QuarterTurn,
) {
  const piece = currentPiece(state);
  if (!piece) {
    return [];
  }
  return rotateCells(piece.cells, rotation).map((cell) => ({
    x: x + cell.x,
    y: y + cell.y,
  }));
}

export function validatePlacement(
  state: GameState,
  pieceId: string,
  x: number,
  y: number,
  rotation: QuarterTurn,
): PlacementValidation {
  if (state.sealed) {
    return { valid: false, code: "GAME_SEALED" };
  }

  const piece = currentPiece(state);
  if (!piece) {
    return { valid: false, code: "NO_CURRENT_PIECE" };
  }
  if (piece.id !== pieceId) {
    return { valid: false, code: "WRONG_PIECE" };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { valid: false, code: "INVALID_COORDINATE" };
  }
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) {
    return { valid: false, code: "INVALID_ROTATION" };
  }

  const cells = absoluteCells(state, x, y, rotation);
  if (
    cells.some(
      (cell) =>
        cell.x < 0 ||
        cell.x >= BOARD_WIDTH ||
        cell.y < 0 ||
        cell.y >= BOARD_HEIGHT,
    )
  ) {
    return { valid: false, code: "OUT_OF_BOUNDS", cells };
  }
  if (cells.some((cell) => state.board[boardIndex(cell.x, cell.y)] !== null)) {
    return { valid: false, code: "OCCUPIED", cells };
  }

  return { valid: true, cells };
}

function checkpoint(state: GameState): UndoCheckpoint {
  return {
    board: [...state.board],
    cursor: state.cursor,
    placements: [...state.placements],
    spilled: [...state.spilled],
    completedRows: [...state.completedRows],
    completedColumns: [...state.completedColumns],
    score: { ...state.score },
  };
}

function rowIsFull(board: readonly (string | null)[], row: number): boolean {
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    if (board[boardIndex(x, row)] === null) {
      return false;
    }
  }
  return true;
}

function columnIsFull(
  board: readonly (string | null)[],
  column: number,
): boolean {
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    if (board[boardIndex(column, y)] === null) {
      return false;
    }
  }
  return true;
}

function countAdjacentEdges(
  board: readonly (string | null)[],
  cells: readonly { readonly x: number; readonly y: number }[],
): number {
  const occupiedBeforePlacement = new Set<string>();
  board.forEach((pieceId, index) => {
    if (pieceId !== null) {
      occupiedBeforePlacement.add(
        `${index % BOARD_WIDTH},${Math.floor(index / BOARD_WIDTH)}`,
      );
    }
  });

  let edges = 0;
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const cell of cells) {
    for (const [dx, dy] of directions) {
      if (occupiedBeforePlacement.has(`${cell.x + dx},${cell.y + dy}`)) {
        edges += 1;
      }
    }
  }
  return edges;
}

function scoreTotal(parts: Omit<ScoreBreakdown, "total">): number {
  return Math.max(
    0,
    parts.placement + parts.adjacency + parts.lines - parts.spillPenalty,
  );
}

export function placePiece(
  state: GameState,
  pieceId: string,
  x: number,
  y: number,
  rotation: QuarterTurn,
): GameState {
  const validation = validatePlacement(state, pieceId, x, y, rotation);
  if (!validation.valid || !validation.cells) {
    throw new SimulationError(
      validation.code ?? "INVALID_PLACEMENT",
      `Cannot place ${pieceId}: ${validation.code ?? "INVALID_PLACEMENT"}.`,
    );
  }

  const piece = currentPiece(state);
  if (!piece) {
    throw new SimulationError("NO_CURRENT_PIECE", "No piece is available.");
  }

  const nextBoard = [...state.board];
  const adjacentEdges = countAdjacentEdges(state.board, validation.cells);
  validation.cells.forEach((cell) => {
    nextBoard[boardIndex(cell.x, cell.y)] = piece.id;
  });

  const completedRows = [...state.completedRows];
  const completedColumns = [...state.completedColumns];
  let newLines = 0;
  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    if (!completedRows[row] && rowIsFull(nextBoard, row)) {
      completedRows[row] = true;
      newLines += 1;
    }
  }
  for (let column = 0; column < BOARD_WIDTH; column += 1) {
    if (!completedColumns[column] && columnIsFull(nextBoard, column)) {
      completedColumns[column] = true;
      newLines += 1;
    }
  }

  const placementPoints =
    validation.cells.length * PLACEMENT_POINTS_PER_CELL;
  const adjacencyPoints = adjacentEdges * ADJACENCY_POINTS_PER_EDGE;
  const linePoints = newLines * LINE_POINTS;
  const parts = {
    placement: state.score.placement + placementPoints,
    adjacency: state.score.adjacency + adjacencyPoints,
    lines: state.score.lines + linePoints,
    spillPenalty: state.score.spillPenalty,
  };
  const points = placementPoints + adjacencyPoints + linePoints;
  const placement: Placement = {
    pieceId,
    x,
    y,
    rotation,
    cells: validation.cells,
    points,
  };
  const action: ReplayAction = { type: "place", pieceId, x, y, rotation };

  return {
    ...state,
    board: nextBoard,
    cursor: state.cursor + 1,
    placements: [...state.placements, placement],
    completedRows,
    completedColumns,
    score: { ...parts, total: scoreTotal(parts) },
    undoCheckpoint: state.undoAvailable ? checkpoint(state) : null,
    actions: [...state.actions, action],
  };
}

export function spillPiece(state: GameState, pieceId: string): GameState {
  if (state.sealed) {
    throw new SimulationError("GAME_SEALED", "A sealed game cannot be changed.");
  }
  const piece = currentPiece(state);
  if (!piece) {
    throw new SimulationError("NO_CURRENT_PIECE", "No piece is available.");
  }
  if (piece.id !== pieceId) {
    throw new SimulationError(
      "WRONG_PIECE",
      `${pieceId} is not the current piece.`,
    );
  }

  const spillPenalty = piece.cells.length * SPILL_PENALTY_PER_CELL;
  const parts = {
    placement: state.score.placement,
    adjacency: state.score.adjacency,
    lines: state.score.lines,
    spillPenalty: state.score.spillPenalty + spillPenalty,
  };
  const action: ReplayAction = { type: "spill", pieceId };

  return {
    ...state,
    cursor: state.cursor + 1,
    spilled: [...state.spilled, pieceId],
    score: { ...parts, total: scoreTotal(parts) },
    undoCheckpoint: state.undoAvailable ? checkpoint(state) : null,
    actions: [...state.actions, action],
  };
}

export function undoLastAction(state: GameState): GameState {
  if (state.sealed) {
    throw new SimulationError("GAME_SEALED", "A sealed game cannot be changed.");
  }
  if (!state.undoAvailable || !state.undoCheckpoint) {
    throw new SimulationError(
      "UNDO_UNAVAILABLE",
      "The single undo is not available.",
    );
  }

  const previous = state.undoCheckpoint;
  return {
    ...state,
    board: [...previous.board],
    cursor: previous.cursor,
    placements: [...previous.placements],
    spilled: [...previous.spilled],
    completedRows: [...previous.completedRows],
    completedColumns: [...previous.completedColumns],
    score: { ...previous.score },
    undoAvailable: false,
    undoCheckpoint: null,
    actions: [...state.actions, { type: "undo" }],
  };
}

export function packedCellCount(state: GameState): number {
  return state.board.reduce(
    (count, pieceId) => count + (pieceId === null ? 0 : 1),
    0,
  );
}

export function packedPercentage(state: GameState): number {
  return packedCellCount(state);
}

export function gradeGame(state: GameState): SealGrade {
  const packed = packedPercentage(state);
  if (packed >= 90 && state.spilled.length === 0) return "S";
  if (packed >= 80) return "A";
  if (packed >= 70) return "B";
  if (packed >= 60) return "C";
  if (packed >= 45) return "D";
  return "F";
}

export function sealGame(state: GameState): GameState {
  if (state.sealed) {
    throw new SimulationError("GAME_SEALED", "The game is already sealed.");
  }
  if (state.cursor !== state.pieces.length) {
    throw new SimulationError(
      "PIECES_REMAIN",
      "Every piece must be placed or spilled before sealing.",
    );
  }

  return {
    ...state,
    sealed: true,
    sealGrade: gradeGame(state),
    undoCheckpoint: null,
    actions: [...state.actions, { type: "seal" }],
  };
}

export function applyAction(
  state: GameState,
  action: ReplayAction,
): GameState {
  switch (action.type) {
    case "place":
      return placePiece(
        state,
        action.pieceId,
        action.x,
        action.y,
        action.rotation,
      );
    case "spill":
      return spillPiece(state, action.pieceId);
    case "undo":
      return undoLastAction(state);
    case "seal":
      return sealGame(state);
    default: {
      const exhaustive: never = action;
      throw new SimulationError(
        "UNKNOWN_ACTION",
        `Unknown replay action: ${String(exhaustive)}`,
      );
    }
  }
}

export function cellAt(
  state: GameState,
  x: number,
  y: number,
): string | null {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= BOARD_WIDTH ||
    y < 0 ||
    y >= BOARD_HEIGHT
  ) {
    throw new SimulationError(
      "OUT_OF_BOUNDS",
      "Board coordinates must be integers from 0 through 9.",
    );
  }
  return state.board[boardIndex(x, y)];
}

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 10;
export const BOARD_CELLS = BOARD_WIDTH * BOARD_HEIGHT;
export const MAX_PIECES = 64;
export const REPLAY_VERSION = 1 as const;

export type QuarterTurn = 0 | 1 | 2 | 3;
export type SealGrade = "S" | "A" | "B" | "C" | "D" | "F";

export interface Cell {
  readonly x: number;
  readonly y: number;
}

/**
 * Small, transport-safe transaction values. Data adapters should bucket raw
 * RPC values before they cross into the deterministic simulation.
 */
export interface CompactTransactionFeatures {
  readonly gasBucket: number;
  readonly feeBucket: number;
  readonly inputBucket: number;
  readonly valueBucket: number;
}

export type PieceKind =
  | "MONO"
  | "DOMINO"
  | "TRI_I"
  | "TRI_L"
  | "TET_I"
  | "TET_O"
  | "TET_T"
  | "TET_L"
  | "TET_J"
  | "TET_S"
  | "TET_Z"
  | "PENTA_P"
  | "PENTA_U"
  | "PENTA_V";

export interface Piece {
  readonly id: string;
  readonly kind: PieceKind;
  readonly cells: readonly Cell[];
  readonly source: CompactTransactionFeatures;
}

export interface Placement {
  readonly pieceId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: QuarterTurn;
  readonly cells: readonly Cell[];
  readonly points: number;
}

export type PlacementErrorCode =
  | "GAME_SEALED"
  | "NO_CURRENT_PIECE"
  | "WRONG_PIECE"
  | "INVALID_COORDINATE"
  | "INVALID_ROTATION"
  | "OUT_OF_BOUNDS"
  | "OCCUPIED";

export interface PlacementValidation {
  readonly valid: boolean;
  readonly code?: PlacementErrorCode;
  readonly cells?: readonly Cell[];
}

export interface PlaceAction {
  readonly type: "place";
  readonly pieceId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: QuarterTurn;
}

export interface SpillAction {
  readonly type: "spill";
  readonly pieceId: string;
}

export interface UndoAction {
  readonly type: "undo";
}

export interface SealAction {
  readonly type: "seal";
}

export type ReplayAction =
  | PlaceAction
  | SpillAction
  | UndoAction
  | SealAction;

export interface ScoreBreakdown {
  readonly placement: number;
  readonly adjacency: number;
  readonly lines: number;
  readonly spillPenalty: number;
  readonly total: number;
}

export interface UndoCheckpoint {
  readonly board: readonly (string | null)[];
  readonly cursor: number;
  readonly placements: readonly Placement[];
  readonly spilled: readonly string[];
  readonly completedRows: readonly boolean[];
  readonly completedColumns: readonly boolean[];
  readonly score: ScoreBreakdown;
}

export interface GameState {
  readonly blockHash: string;
  readonly transactions: readonly CompactTransactionFeatures[];
  readonly pieces: readonly Piece[];
  readonly board: readonly (string | null)[];
  readonly cursor: number;
  readonly placements: readonly Placement[];
  readonly spilled: readonly string[];
  readonly completedRows: readonly boolean[];
  readonly completedColumns: readonly boolean[];
  readonly score: ScoreBreakdown;
  readonly undoAvailable: boolean;
  readonly undoCheckpoint: UndoCheckpoint | null;
  readonly sealed: boolean;
  readonly sealGrade: SealGrade | null;
  readonly actions: readonly ReplayAction[];
}

export interface ReplayExpectation {
  readonly score: number;
  readonly packedPercentage: number;
  readonly sealGrade: SealGrade;
  readonly fingerprint: string;
}

export interface GameReplay {
  readonly version: typeof REPLAY_VERSION;
  readonly blockHash: string;
  readonly transactions: readonly CompactTransactionFeatures[];
  readonly actions: readonly ReplayAction[];
  readonly expected: ReplayExpectation;
}

export interface ReplayError {
  readonly actionIndex: number | null;
  readonly code: string;
  readonly message: string;
}

export type ReplayVerification =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly fingerprint: string;
    }
  | {
      readonly ok: false;
      readonly error: ReplayError;
    };

export class SimulationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SimulationError";
    this.code = code;
  }
}

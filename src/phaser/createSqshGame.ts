import * as Phaser from "phaser";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  createGame,
  currentPiece,
  packedPercentage,
  placePiece,
  rotateCells,
  sealGame,
  spillPiece,
  undoLastAction,
  validatePlacement,
  type CompactTransactionFeatures,
  type GameState,
  type QuarterTurn,
} from "@/game/simulation";

const GAME_SIZE = 640;
const BOARD_PADDING = 50;
const CELL_SIZE = 54;
const BOARD_SIZE = CELL_SIZE * BOARD_WIDTH;
const PALETTE = [0x1456f0, 0xff5b45, 0xb6d81d, 0x181818, 0x8f62d8];

export interface SqshGameInput {
  blockHash: string;
  transactions: readonly CompactTransactionFeatures[];
}

export interface SqshGameBridge {
  onStateChange: (state: GameState) => void;
  onInvalidPlacement?: (message: string) => void;
  onComplete: (state: GameState) => void;
}

export interface SqshGameController {
  rotate: () => void;
  undo: () => void;
  spill: () => void;
  place: () => void;
  finish: () => void;
  destroy: () => void;
  capture: () => string | null;
}

function pieceColor(state: GameState, pieceId: string): number {
  const index = state.pieces.findIndex((piece) => piece.id === pieceId);
  const piece = state.pieces[index];
  if (!piece) return PALETTE[3];
  return PALETTE[
    (piece.source.inputBucket + piece.source.valueBucket + index) %
      PALETTE.length
  ];
}

class SqshScene extends Phaser.Scene {
  private readonly inputData: SqshGameInput;
  private readonly bridge: SqshGameBridge;
  private state: GameState;
  private ink!: Phaser.GameObjects.Graphics;
  private ghostX = 0;
  private ghostY = 0;
  private rotation: QuarterTurn = 0;

  constructor(input: SqshGameInput, bridge: SqshGameBridge) {
    super({ key: "sqsh-board" });
    this.inputData = input;
    this.bridge = bridge;
    this.state = createGame({
      blockHash: input.blockHash,
      transactions: input.transactions,
      pieceLimit: 24,
    });
  }

  create() {
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
    this.ink = this.add.graphics();
    this.input.on("pointermove", this.moveGhost, this);
    this.input.on("pointerdown", this.placeCurrent, this);
    this.input.keyboard?.on("keydown-R", this.rotateCurrent, this);
    this.input.keyboard?.on("keydown-Z", this.undo, this);
    this.input.keyboard?.on("keydown-X", this.spill, this);
    this.input.keyboard?.on("keydown-SPACE", this.placeCurrent, this);
    this.input.keyboard?.on("keydown-LEFT", () => this.nudge(-1, 0));
    this.input.keyboard?.on("keydown-RIGHT", () => this.nudge(1, 0));
    this.input.keyboard?.on("keydown-UP", () => this.nudge(0, -1));
    this.input.keyboard?.on("keydown-DOWN", () => this.nudge(0, 1));
    this.draw();
    this.bridge.onStateChange(this.state);
  }

  private nudge(dx: number, dy: number) {
    this.ghostX = Phaser.Math.Clamp(
      this.ghostX + dx,
      0,
      BOARD_WIDTH - 1,
    );
    this.ghostY = Phaser.Math.Clamp(
      this.ghostY + dy,
      0,
      BOARD_HEIGHT - 1,
    );
    this.draw();
  }

  private moveGhost(pointer: Phaser.Input.Pointer) {
    this.ghostX = Phaser.Math.Clamp(
      Math.floor((pointer.x - BOARD_PADDING) / CELL_SIZE),
      0,
      BOARD_WIDTH - 1,
    );
    this.ghostY = Phaser.Math.Clamp(
      Math.floor((pointer.y - BOARD_PADDING) / CELL_SIZE),
      0,
      BOARD_HEIGHT - 1,
    );
    this.draw();
  }

  rotateCurrent = () => {
    if (this.state.sealed) return;
    this.rotation = ((this.rotation + 1) % 4) as QuarterTurn;
    this.draw();
  };

  placeCurrent = () => {
    if (this.state.sealed) return;
    const piece = currentPiece(this.state);
    if (!piece) return;
    const validation = validatePlacement(
      this.state,
      piece.id,
      this.ghostX,
      this.ghostY,
      this.rotation,
    );
    if (!validation.valid) {
      this.cameras.main.shake(90, 0.006);
      this.bridge.onInvalidPlacement?.(
        validation.code === "OCCUPIED"
          ? "That space is already inked."
          : "That shape hangs outside the block.",
      );
      this.draw();
      return;
    }
    this.state = placePiece(
      this.state,
      piece.id,
      this.ghostX,
      this.ghostY,
      this.rotation,
    );
    this.rotation = 0;
    this.cameras.main.flash(70, 20, 86, 240, false);
    this.afterAction();
  };

  spill = () => {
    if (this.state.sealed) return;
    const piece = currentPiece(this.state);
    if (!piece) return;
    this.state = spillPiece(this.state, piece.id);
    this.afterAction();
  };

  undo = () => {
    if (!this.state.undoAvailable || !this.state.undoCheckpoint) {
      this.bridge.onInvalidPlacement?.("Your one undo has already been used.");
      return;
    }
    this.state = undoLastAction(this.state);
    this.afterAction(false);
  };

  finish = () => {
    if (this.state.sealed) return;
    while (currentPiece(this.state)) {
      const piece = currentPiece(this.state);
      if (!piece) break;
      this.state = spillPiece(this.state, piece.id);
    }
    this.complete();
  };

  private afterAction(autoComplete = true) {
    if (autoComplete && !currentPiece(this.state)) {
      this.complete();
      return;
    }
    this.draw();
    this.bridge.onStateChange(this.state);
  }

  private complete() {
    if (!this.state.sealed) {
      this.state = sealGame(this.state);
    }
    this.draw();
    this.bridge.onStateChange(this.state);
    this.time.delayedCall(240, () => this.bridge.onComplete(this.state));
  }

  private drawCell(
    x: number,
    y: number,
    color: number,
    alpha = 1,
    inset = 3,
  ) {
    const px = BOARD_PADDING + x * CELL_SIZE + inset;
    const py = BOARD_PADDING + y * CELL_SIZE + inset;
    const size = CELL_SIZE - inset * 2;
    this.ink.fillStyle(color, alpha);
    this.ink.fillRoundedRect(px, py, size, size, 6);
    this.ink.lineStyle(1, 0x111111, Math.min(alpha, 0.18));
    this.ink.strokeRoundedRect(px, py, size, size, 6);
  }

  private draw() {
    if (!this.ink) return;
    this.ink.clear();

    this.ink.fillStyle(0xf4eedb, 0.94);
    this.ink.fillRoundedRect(
      BOARD_PADDING - 10,
      BOARD_PADDING - 10,
      BOARD_SIZE + 20,
      BOARD_SIZE + 20,
      18,
    );
    this.ink.lineStyle(2, 0x181818, 0.85);
    this.ink.strokeRoundedRect(
      BOARD_PADDING - 10,
      BOARD_PADDING - 10,
      BOARD_SIZE + 20,
      BOARD_SIZE + 20,
      18,
    );

    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const id = this.state.board[y * BOARD_WIDTH + x];
        if (id) {
          this.drawCell(x, y, pieceColor(this.state, id));
        } else {
          this.ink.lineStyle(1, 0x181818, 0.1);
          this.ink.strokeRoundedRect(
            BOARD_PADDING + x * CELL_SIZE + 3,
            BOARD_PADDING + y * CELL_SIZE + 3,
            CELL_SIZE - 6,
            CELL_SIZE - 6,
            6,
          );
        }
      }
    }

    const piece = currentPiece(this.state);
    if (!piece || this.state.sealed) return;
    const placement = validatePlacement(
      this.state,
      piece.id,
      this.ghostX,
      this.ghostY,
      this.rotation,
    );
    const cells =
      placement.cells ??
      rotateCells(piece.cells, this.rotation).map((cell) => ({
        x: this.ghostX + cell.x,
        y: this.ghostY + cell.y,
      }));
    for (const cell of cells) {
      if (
        cell.x >= 0 &&
        cell.x < BOARD_WIDTH &&
        cell.y >= 0 &&
        cell.y < BOARD_HEIGHT
      ) {
        this.drawCell(
          cell.x,
          cell.y,
          placement.valid ? pieceColor(this.state, piece.id) : 0xff5b45,
          0.42,
          7,
        );
      }
    }
  }

  public snapshot() {
    return {
      state: this.state,
      packed: packedPercentage(this.state),
    };
  }
}

export function createSqshGame(
  parent: HTMLElement,
  input: SqshGameInput,
  bridge: SqshGameBridge,
): SqshGameController {
  let scene: SqshScene | null = new SqshScene(input, bridge);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_SIZE,
    height: GAME_SIZE,
    transparent: true,
    antialias: true,
    pixelArt: false,
    render: {
      powerPreference: "high-performance",
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene,
    input: {
      activePointers: 2,
    },
  });

  return {
    rotate: () => scene?.rotateCurrent(),
    undo: () => scene?.undo(),
    spill: () => scene?.spill(),
    place: () => scene?.placeCurrent(),
    finish: () => scene?.finish(),
    destroy: () => {
      game.destroy(true);
      scene = null;
    },
    capture: () => {
      try {
        return game.canvas?.toDataURL("image/png") ?? null;
      } catch {
        return null;
      }
    },
  };
}

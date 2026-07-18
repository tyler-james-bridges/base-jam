import * as Phaser from "phaser";
import { RhythmAudioEngine } from "@/audio/rhythmAudio";
import {
  advanceRhythmState,
  createRhythmState,
  finishRhythmState,
  GOOD_WINDOW_SECONDS,
  judgeRhythmHit,
  RHYTHM_LANES,
  selectRhythmLane,
  type RhythmChart,
  type RhythmColumn,
  type RhythmLane,
  type RhythmState,
} from "@/game/rhythm";

const GAME_WIDTH = 960;
const GAME_HEIGHT = 620;
const HIT_X = 132;
const HORIZON_X = 920;
const LOOKAHEAD_SECONDS = 5.5;
const LANE_COLORS = [0x181818, 0xb6d81d, 0x1456f0, 0x8f62d8] as const;
const PAPER = 0xf4eedb;
const CORAL = 0xff5b45;

export interface BaseJamRhythmGameInput {
  readonly chart: RhythmChart;
  readonly audioContext: AudioContext | null;
}

export interface BaseJamRhythmBridge {
  readonly onComplete: (state: RhythmState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
  readonly onStateChange: (state: RhythmState) => void;
}

export interface BaseJamRhythmController {
  readonly capture: () => string | null;
  readonly destroy: () => void;
  readonly finish: () => void;
  readonly hit: (column: RhythmColumn) => void;
  readonly moveLane: (delta: -1 | 1) => void;
  readonly selectLane: (lane: RhythmLane) => void;
  readonly toggleMuted: () => void;
}

interface Burst {
  readonly lane: RhythmLane;
  readonly column: RhythmColumn;
  readonly startedAt: number;
  readonly color: number;
}

class BaseJamRhythmScene extends Phaser.Scene {
  private readonly inputData: BaseJamRhythmGameInput;
  private readonly bridge: BaseJamRhythmBridge;
  private state: RhythmState = createRhythmState();
  private ink!: Phaser.GameObjects.Graphics;
  private audio!: RhythmAudioEngine;
  private feedbackText!: Phaser.GameObjects.Text;
  private blockText!: Phaser.GameObjects.Text;
  private signalText!: Phaser.GameObjects.Text;
  private readyText!: Phaser.GameObjects.Text;
  private songTime = -1;
  private lastBar = -1;
  private completed = false;
  private bursts: Burst[] = [];
  private sealFlashUntil = 0;

  constructor(
    input: BaseJamRhythmGameInput,
    bridge: BaseJamRhythmBridge,
  ) {
    super({ key: "base-jam-rhythm" });
    this.inputData = input;
    this.bridge = bridge;
  }

  create() {
    this.cameras.main.setBackgroundColor("rgba(244,238,219,0)");
    this.ink = this.add.graphics();
    this.feedbackText = this.add
      .text(HIT_X + 34, 68, "", {
        color: "#1456f0",
        fontFamily: "Arial Black, sans-serif",
        fontSize: "26px",
        fontStyle: "bold",
      })
      .setDepth(3);
    this.blockText = this.add
      .text(28, 24, "", {
        color: "#181818",
        fontFamily: "Courier New, monospace",
        fontSize: "14px",
        fontStyle: "bold",
      })
      .setDepth(3);
    this.signalText = this.add
      .text(28, GAME_HEIGHT - 34, "", {
        color: "#1456f0",
        fontFamily: "Courier New, monospace",
        fontSize: "11px",
        fontStyle: "bold",
      })
      .setDepth(3);
    this.readyText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "READY", {
        align: "center",
        backgroundColor: "#f4eedb",
        color: "#181818",
        fontFamily: "Arial Black, sans-serif",
        fontSize: "52px",
        fontStyle: "bold",
        padding: { x: 24, y: 14 },
      })
      .setOrigin(0.5)
      .setDepth(4);

    this.audio = new RhythmAudioEngine(
      this.inputData.audioContext,
      this.inputData.chart.keyIndex,
      () => this.state,
    );
    this.audio.start();

    this.input.keyboard?.on("keydown-A", () => this.moveLane(-1));
    this.input.keyboard?.on("keydown-LEFT", () => this.moveLane(-1));
    this.input.keyboard?.on("keydown-W", () => this.moveLane(-1));
    this.input.keyboard?.on("keydown-D", () => this.moveLane(1));
    this.input.keyboard?.on("keydown-RIGHT", () => this.moveLane(1));
    this.input.keyboard?.on("keydown-S", () => this.moveLane(1));
    this.input.keyboard?.on("keydown-J", () => this.hit(0));
    this.input.keyboard?.on("keydown-K", () => this.hit(1));
    this.input.keyboard?.on("keydown-L", () => this.hit(2));
    this.input.keyboard?.on("keydown-ONE", () => this.hit(0));
    this.input.keyboard?.on("keydown-TWO", () => this.hit(1));
    this.input.keyboard?.on("keydown-THREE", () => this.hit(2));
    this.input.keyboard?.on("keydown-M", () => this.toggleMuted());

    this.draw();
    this.bridge.onStateChange(this.state);
    this.bridge.onReady();
  }

  update() {
    if (this.completed) return;
    this.audio.update();
    this.songTime = this.audio.songTime();
    this.readyText.setVisible(this.songTime < 0);
    if (this.songTime < 0) {
      this.readyText.setText(
        this.songTime < -0.58
          ? "READY"
          : this.songTime < -0.28
            ? "SET"
            : "JAM",
      );
      this.draw();
      return;
    }

    const previous = this.state;
    this.state = advanceRhythmState(
      this.inputData.chart,
      this.state,
      this.songTime,
    );
    if (this.state.currentBar !== this.lastBar) {
      this.lastBar = this.state.currentBar;
      this.sealFlashUntil = performance.now() + 190;
    }
    if (this.state !== previous) {
      this.bridge.onStateChange(this.state);
    }
    if (this.songTime >= this.inputData.chart.durationSeconds) {
      this.finish();
      return;
    }
    this.draw();
  }

  hit = (column: RhythmColumn) => {
    if (this.completed || this.songTime < 0) return;
    const previous = this.state;
    const next = judgeRhythmHit(
      this.inputData.chart,
      previous,
      column,
      this.songTime,
    );
    this.state = next;
    const judgement = next.lastJudgement ?? "miss";
    if (judgement === "miss") {
      this.audio.miss();
      this.feedbackText.setColor("#ff5b45");
      this.feedbackText.setText("MISS");
      this.bridge.onFeedback("Miss · stay with the pulse");
      this.cameras.main.shake(45, 0.002);
    } else {
      this.audio.hit(next.selectedLane, column, judgement);
      this.feedbackText.setColor(
        judgement === "perfect" ? "#1456f0" : "#181818",
      );
      this.feedbackText.setText(
        judgement === "perfect"
          ? "PERFECT"
          : `${next.lastDeltaMs && next.lastDeltaMs < 0 ? "EARLY" : "LATE"} · GOOD`,
      );
      this.bridge.onFeedback(
        `${judgement === "perfect" ? "Perfect" : "Good"} · ${RHYTHM_LANES[next.selectedLane].name} +${next.score - previous.score}`,
      );
      this.bursts.push({
        lane: next.selectedLane,
        column,
        startedAt: performance.now(),
        color: LANE_COLORS[next.selectedLane],
      });
      if (next.captures > previous.captures) {
        this.audio.capture(next.selectedLane);
        this.feedbackText.setText(
          `${RHYTHM_LANES[next.selectedLane].name} CAPTURED`,
        );
        this.feedbackText.setColor("#1456f0");
        this.cameras.main.flash(90, 20, 86, 240, false);
      }
    }
    this.bridge.onStateChange(this.state);
    this.draw();
  };

  selectLane = (lane: RhythmLane) => {
    if (this.completed) return;
    this.state = selectRhythmLane(this.state, lane);
    this.bridge.onFeedback(
      `${RHYTHM_LANES[lane].name} rail · hit J K L`,
    );
    this.bridge.onStateChange(this.state);
    this.draw();
  };

  moveLane = (delta: -1 | 1) => {
    const next = ((this.state.selectedLane + delta + 4) % 4) as RhythmLane;
    this.selectLane(next);
  };

  toggleMuted = () => {
    const muted = this.audio.toggleMuted();
    this.bridge.onMutedChange(muted);
    this.bridge.onFeedback(muted ? "Audio muted" : "Audio live");
  };

  finish = () => {
    if (this.completed) return;
    this.completed = true;
    this.state = finishRhythmState(this.state);
    this.audio.stop();
    this.bridge.onStateChange(this.state);
    this.draw();
    const image = this.capture();
    this.time.delayedCall(260, () => this.bridge.onComplete(this.state, image));
  };

  capture(): string | null {
    try {
      return this.game.canvas?.toDataURL("image/png") ?? null;
    } catch {
      return null;
    }
  }

  shutdown() {
    this.audio?.stop();
  }

  private laneY(lane: RhythmLane, x: number): number {
    const leftY = 162 + lane * 108;
    const horizonY = 228 + lane * 56;
    const progress = Phaser.Math.Clamp(
      (x - HIT_X) / (HORIZON_X - HIT_X),
      0,
      1,
    );
    return Phaser.Math.Linear(leftY, horizonY, progress);
  }

  private notePosition(
    lane: RhythmLane,
    column: RhythmColumn,
    time: number,
  ) {
    const secondsAhead = time - Math.max(0, this.songTime);
    const progress = secondsAhead / LOOKAHEAD_SECONDS;
    const x = HIT_X + progress * (HORIZON_X - HIT_X);
    const perspective = Phaser.Math.Clamp(progress, 0, 1);
    const columnOffset = Phaser.Math.Linear(
      (column - 1) * 28,
      (column - 1) * 12,
      perspective,
    );
    return {
      x,
      y: this.laneY(lane, x) + columnOffset,
      size: Phaser.Math.Linear(25, 10, perspective),
    };
  }

  private drawLane(lane: RhythmLane) {
    const selected = this.state.selectedLane === lane;
    const active = this.state.capturedUntilBar[lane] > this.state.currentBar;
    const color = LANE_COLORS[lane];
    const leftY = this.laneY(lane, HIT_X);
    const rightY = this.laneY(lane, HORIZON_X);
    const leftHalf = 44;
    const rightHalf = 20;

    this.ink.fillStyle(color, selected ? 0.1 : active ? 0.075 : 0.018);
    this.ink.fillPoints(
      [
        new Phaser.Geom.Point(HIT_X, leftY - leftHalf),
        new Phaser.Geom.Point(HORIZON_X, rightY - rightHalf),
        new Phaser.Geom.Point(HORIZON_X, rightY + rightHalf),
        new Phaser.Geom.Point(HIT_X, leftY + leftHalf),
      ],
      true,
    );
    this.ink.lineStyle(selected ? 3 : 1, color, selected ? 0.92 : 0.34);
    this.ink.strokePoints(
      [
        new Phaser.Geom.Point(HIT_X, leftY - leftHalf),
        new Phaser.Geom.Point(HORIZON_X, rightY - rightHalf),
        new Phaser.Geom.Point(HORIZON_X, rightY + rightHalf),
        new Phaser.Geom.Point(HIT_X, leftY + leftHalf),
      ],
      true,
    );

    for (let column = 0; column < 3; column += 1) {
      const leftOffset = (column - 1) * 28;
      const rightOffset = (column - 1) * 12;
      this.ink.lineStyle(1, color, selected ? 0.2 : 0.09);
      this.ink.lineBetween(
        HIT_X,
        leftY + leftOffset,
        HORIZON_X,
        rightY + rightOffset,
      );
    }

    this.ink.fillStyle(color, selected ? 1 : 0.48);
    this.ink.fillRoundedRect(28, leftY - 28, 82, 56, 4);
    if (active) {
      this.ink.lineStyle(3, color, 0.95);
      this.ink.strokeRoundedRect(23, leftY - 33, 92, 66, 5);
    }
  }

  private drawBlockDividers() {
    const startBar = Math.max(0, Math.floor(Math.max(0, this.songTime) / 2));
    for (let bar = startBar; bar <= startBar + 3; bar += 1) {
      const time = bar * 2;
      const secondsAhead = time - Math.max(0, this.songTime);
      const x = HIT_X + (secondsAhead / LOOKAHEAD_SECONDS) * (HORIZON_X - HIT_X);
      if (x < HIT_X - 10 || x > HORIZON_X + 10) continue;
      this.ink.lineStyle(2, 0x181818, 0.18);
      this.ink.lineBetween(x, 104, x, 578);
      this.ink.fillStyle(0x181818, 0.55);
      this.ink.fillRect(x - 2, 96, 4, 8);
    }
  }

  private drawNotes() {
    const now = Math.max(0, this.songTime);
    this.inputData.chart.notes.forEach((note) => {
      const delta = note.time - now;
      if (delta < -GOOD_WINDOW_SECONDS - 0.18 || delta > LOOKAHEAD_SECONDS) {
        return;
      }
      const result = this.state.noteResults[note.id];
      if (result === "perfect" || result === "good") return;
      const { x, y, size } = this.notePosition(
        note.lane,
        note.column,
        note.time,
      );
      const selected = note.lane === this.state.selectedLane;
      const color = result === "miss" ? CORAL : LANE_COLORS[note.lane];
      this.ink.fillStyle(color, selected ? 0.98 : 0.45);
      this.ink.fillRoundedRect(
        x - size,
        y - size,
        size * 2,
        size * 2,
        Math.max(2, size * 0.2),
      );
      this.ink.lineStyle(1, 0x181818, selected ? 0.9 : 0.35);
      this.ink.strokeRoundedRect(
        x - size,
        y - size,
        size * 2,
        size * 2,
        Math.max(2, size * 0.2),
      );
    });
  }

  private drawBursts() {
    const now = performance.now();
    this.bursts = this.bursts.filter((burst) => now - burst.startedAt < 360);
    this.bursts.forEach((burst) => {
      const age = (now - burst.startedAt) / 360;
      const y =
        this.laneY(burst.lane, HIT_X) + (burst.column - 1) * 28;
      this.ink.lineStyle(3, burst.color, 1 - age);
      this.ink.strokeCircle(HIT_X, y, 18 + age * 58);
      this.ink.lineStyle(1, burst.color, 0.65 * (1 - age));
      this.ink.strokeCircle(HIT_X, y, 10 + age * 88);
    });
  }

  private draw() {
    if (!this.ink) return;
    this.ink.clear();
    this.ink.fillStyle(PAPER, 0.92);
    this.ink.fillRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 12);
    this.ink.lineStyle(2, 0x181818, 0.75);
    this.ink.strokeRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 12);

    this.ink.fillStyle(0x1456f0, 0.045);
    this.ink.fillTriangle(
      HIT_X,
      95,
      HORIZON_X,
      200,
      HORIZON_X,
      470,
    );
    this.drawBlockDividers();
    ([0, 1, 2, 3] as const).forEach((lane) => this.drawLane(lane));

    if (performance.now() < this.sealFlashUntil) {
      this.ink.fillStyle(0xff5b45, 0.12);
      this.ink.fillRect(HIT_X - 12, 88, 24, 500);
    }
    this.ink.lineStyle(5, 0x181818, 0.95);
    this.ink.lineBetween(HIT_X, 92, HIT_X, 586);
    this.ink.lineStyle(2, 0xff5b45, 0.9);
    this.ink.lineBetween(HIT_X + 8, 92, HIT_X + 8, 586);

    this.drawNotes();
    this.drawBursts();

    const bar = this.inputData.chart.bars[this.state.currentBar];
    this.blockText.setText(
      `BAR ${String(this.state.currentBar + 1).padStart(2, "0")} / ${this.inputData.chart.bars.length}   BASE #${bar?.blockNumber ?? "SYNCING"}`,
    );
    const nearest = this.inputData.chart.notes
      .filter(
        (note) =>
          note.lane === this.state.selectedLane &&
          !this.state.noteResults[note.id] &&
          note.time >= Math.max(0, this.songTime) - GOOD_WINDOW_SECONDS,
      )
      .sort((left, right) => left.time - right.time)[0];
    this.signalText.setText(
      nearest
        ? `LIVE TX ${nearest.txHash.slice(0, 10)}…  ·  ${nearest.calldataBytes} BYTES`
        : "SEALING CURRENT BLOCK SIGNAL",
    );
    if (performance.now() - (this.bursts.at(-1)?.startedAt ?? 0) > 680) {
      this.feedbackText.setText("");
    }
  }
}

export function createBaseJamRhythmGame(
  parent: HTMLElement,
  input: BaseJamRhythmGameInput,
  bridge: BaseJamRhythmBridge,
): BaseJamRhythmController {
  let scene: BaseJamRhythmScene | null = new BaseJamRhythmScene(input, bridge);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
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
      activePointers: 3,
    },
  });

  return {
    capture: () => scene?.capture() ?? null,
    destroy: () => {
      scene?.shutdown();
      game.destroy(true);
      scene = null;
    },
    finish: () => scene?.finish(),
    hit: (column) => scene?.hit(column),
    moveLane: (delta) => scene?.moveLane(delta),
    selectLane: (lane) => scene?.selectLane(lane),
    toggleMuted: () => scene?.toggleMuted(),
  };
}

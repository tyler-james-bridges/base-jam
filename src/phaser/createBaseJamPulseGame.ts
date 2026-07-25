import * as Phaser from "phaser";
import { PulseAudioEngine } from "@/audio/pulseAudio";
import {
  advancePulseState,
  createPulseState,
  finishPulseState,
  judgePulseRoute,
  pulseExpectedRoute,
  pulseLayerForFace,
  PULSE_LAYERS,
  type PulseChart,
  type PulseEvent,
  type PulseRoute,
  type PulseState,
} from "@/game/pulse";

const GAME_WIDTH = 960;
const GAME_HEIGHT = 620;
const PRE_ROLL_SECONDS = 1.8;
const TARGET_X = 230;
const TARGET_Y = 305;
const STREAM_END_X = 920;
const LOOKAHEAD_SECONDS = 4.25;
const PAPER = 0xf4eedb;
const INK = 0x181818;
const BLUE = 0x1456f0;
const CORAL = 0xff5b45;
const ACID = 0xb6d81d;
const LAYER_COLORS = [INK, ACID, BLUE, 0x8f62d8] as const;

export interface BaseJamPulseGameInput {
  readonly chart: PulseChart;
  readonly audioContext: AudioContext | null;
}

export interface BaseJamPulseBridge {
  readonly onComplete: (state: PulseState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
  readonly onStateChange: (state: PulseState) => void;
}

export interface BaseJamPulseController {
  readonly capture: () => string | null;
  readonly destroy: () => void;
  readonly finish: () => void;
  readonly route: (
    direction: PulseRoute,
    pointerStartedAt?: number,
  ) => void;
  readonly tap: () => void;
  readonly toggleMuted: () => void;
}

interface PulseBurst {
  readonly startedAt: number;
  readonly color: number;
  readonly perfect: boolean;
}

function hexByte(hash: string, index: number): number {
  const offset = 2 + (index % 32) * 2;
  const value = Number.parseInt(hash.slice(offset, offset + 2), 16);
  return Number.isFinite(value) ? value : 0;
}

class BaseJamPulseScene extends Phaser.Scene {
  private readonly inputData: BaseJamPulseGameInput;
  private readonly bridge: BaseJamPulseBridge;
  private state: PulseState = createPulseState();
  private audio!: PulseAudioEngine;
  private ink!: Phaser.GameObjects.Graphics;
  private feedbackText!: Phaser.GameObjects.Text;
  private cueText!: Phaser.GameObjects.Text;
  private blockText!: Phaser.GameObjects.Text;
  private signalText!: Phaser.GameObjects.Text;
  private incomingText!: Phaser.GameObjects.Text;
  private readyText!: Phaser.GameObjects.Text;
  private songTime = -1;
  private started = false;
  private completed = false;
  private feedbackUntil = 0;
  private bursts: PulseBurst[] = [];

  constructor(input: BaseJamPulseGameInput, bridge: BaseJamPulseBridge) {
    super({ key: "base-jam-pulse" });
    this.inputData = input;
    this.bridge = bridge;
  }

  create() {
    this.cameras.main.setBackgroundColor("rgba(244,238,219,0)");
    this.ink = this.add.graphics();
    this.blockText = this.add
      .text(28, 24, "", {
        color: "#181818",
        fontFamily: "Courier New, monospace",
        fontSize: "13px",
        fontStyle: "bold",
      })
      .setDepth(5);
    this.signalText = this.add
      .text(28, GAME_HEIGHT - 34, "", {
        color: "#1456f0",
        fontFamily: "Courier New, monospace",
        fontSize: "11px",
        fontStyle: "bold",
      })
      .setDepth(5);
    this.feedbackText = this.add
      .text(TARGET_X, 104, "", {
        align: "center",
        color: "#1456f0",
        fontFamily: "Arial Black, sans-serif",
        fontSize: "38px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.cueText = this.add
      .text(TARGET_X, TARGET_Y, "TAP", {
        align: "center",
        color: "#181818",
        fontFamily: "Arial Black, sans-serif",
        fontSize: "42px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.incomingText = this.add
      .text(0, 0, "", {
        align: "center",
        color: "#181818",
        fontFamily: "Courier New, monospace",
        fontSize: "11px",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0)
      .setDepth(5);
    this.readyText = this.add
      .text(GAME_WIDTH / 2, 112, "TAP THE BLOCK\nWHEN IT HITS THE RING", {
        align: "center",
        backgroundColor: "#f4eedb",
        color: "#181818",
        fontFamily: "Arial Black, sans-serif",
        fontSize: "24px",
        fontStyle: "bold",
        lineSpacing: 4,
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(7);

    this.audio = new PulseAudioEngine(
      this.inputData.audioContext,
      this.inputData.chart,
      () => this.state,
    );
    this.songTime = -PRE_ROLL_SECONDS;
    this.state = advancePulseState(
      this.inputData.chart,
      this.state,
      this.songTime,
    );

    this.draw();
    this.bridge.onStateChange(this.state);
    this.bridge.onReady();
  }

  update() {
    if (this.completed || !this.started) return;
    this.audio.update();
    this.songTime = this.audio.songTime();
    this.readyText.setVisible(this.songTime < -0.08);

    const previous = this.state;
    this.state = advancePulseState(
      this.inputData.chart,
      this.state,
      this.songTime,
    );
    if (this.state !== previous) {
      this.bridge.onStateChange(this.state);
    }
    if (this.state.misses > previous.misses) {
      const completedEvent = this.inputData.chart.events.find(
        (event) =>
          !previous.eventResults[event.id] &&
          Boolean(this.state.eventResults[event.id]),
      );
      const phraseSealed =
        completedEvent &&
        (this.state.eventResults[completedEvent.id] === "perfect" ||
          this.state.eventResults[completedEvent.id] === "good")
          ? completedEvent
          : undefined;
      const phraseDropped =
        completedEvent &&
        this.state.eventResults[completedEvent.id] === "flow"
          ? completedEvent
          : undefined;
      this.audio.miss("late");
      if (phraseSealed) {
        this.audio.capture(phraseSealed.signalLayer);
      }
      this.feedbackText.setColor("#ff5b45");
      this.feedbackText.setText("LATE");
      this.feedbackUntil = performance.now() + 720;
      this.bridge.onFeedback(
        phraseSealed
          ? `LATE · PHRASE SEALED · ${PULSE_LAYERS[phraseSealed.signalLayer].name} LIVE`
          : phraseDropped
            ? `LATE · ${PULSE_LAYERS[phraseDropped.signalLayer].name} CHANNEL DROPPED`
            : "LATE",
      );
    }
    if (this.songTime < 0) {
      this.draw();
      return;
    }
    if (this.songTime >= this.inputData.chart.durationSeconds) {
      this.finish();
      return;
    }
    this.draw();
  }

  route = (direction: PulseRoute, pointerStartedAt?: number) => {
    if (this.completed) return;
    if (!this.started) {
      if (direction !== 0) {
        this.bridge.onFeedback("TAP TO START");
        return;
      }
      this.started = true;
      this.audio.start(PRE_ROLL_SECONDS);
      this.songTime = -PRE_ROLL_SECONDS;
      this.state = advancePulseState(
        this.inputData.chart,
        this.state,
        this.songTime,
      );
      this.feedbackText.setColor("#1456f0");
      this.feedbackText.setText("SIGNAL ARMED");
      this.feedbackUntil = performance.now() + 780;
      this.bridge.onFeedback("Signal armed · follow the first block");
      this.bridge.onStateChange(this.state);
      this.vibrate(8);
      this.draw();
      return;
    }
    const inputSongTime = this.songTimeAtPointer(pointerStartedAt);
    // Input can land between Phaser frames, especially on throttled phones.
    // Resolve any already-expired cues first so an older miss cannot erase
    // the combo from the command the player just hit.
    const beforeAdvance = this.state;
    const previous = advancePulseState(
      this.inputData.chart,
      beforeAdvance,
      inputSongTime,
    );
    const autoSealedEvent = this.inputData.chart.events.find(
      (candidate) =>
        !beforeAdvance.eventResults[candidate.id] &&
        (previous.eventResults[candidate.id] === "perfect" ||
          previous.eventResults[candidate.id] === "good"),
    );
    if (autoSealedEvent) {
      this.audio.capture(autoSealedEvent.signalLayer);
    }
    this.state = previous;
    const next = judgePulseRoute(
      this.inputData.chart,
      previous,
      inputSongTime,
      direction,
    );
    this.state = next;
    const cue = this.inputData.chart.cues.find(
      (candidate) =>
        !previous.cueResults[candidate.id] &&
        Boolean(next.cueResults[candidate.id]),
    );
    const cueResult = cue ? next.cueResults[cue.id] : undefined;
    const completedEvent = this.inputData.chart.events.find(
      (candidate) =>
        !previous.eventResults[candidate.id] &&
        Boolean(next.eventResults[candidate.id]),
    );
    const phraseSealed =
      completedEvent &&
      (next.eventResults[completedEvent.id] === "perfect" ||
        next.eventResults[completedEvent.id] === "good")
        ? completedEvent
        : undefined;
    const phraseDropped =
      completedEvent && next.eventResults[completedEvent.id] === "flow"
        ? completedEvent
        : undefined;

    if (!cue || !cueResult) {
      const nearest = this.inputData.chart.cues
        .filter((candidate) => !previous.cueResults[candidate.id])
        .map((candidate) => ({
          delta: inputSongTime - candidate.time,
          cue: candidate,
        }))
        .sort(
          (left, right) => Math.abs(left.delta) - Math.abs(right.delta),
        )[0];
      const early = !nearest || nearest.delta < 0;
      // Exploratory input before a cue is useful learning, not a punishment.
      // Keep it silent so the first thing a new player hears is the groove.
      if (!early) {
        this.audio.miss("late");
      }
      this.feedbackText.setColor("#ff5b45");
      this.feedbackText.setText(early ? "EARLY" : "LATE");
      this.feedbackUntil = performance.now() + 820;
      this.bridge.onFeedback(early ? "EARLY" : "LATE");
      this.vibrate(early ? 5 : [5, 18, 5]);
      this.bridge.onStateChange(this.state);
      this.draw();
      return;
    }

    if (cueResult === "wrong") {
      const expected = pulseExpectedRoute(cue, previous);
      const expectedLabel =
        expected === 0 ? "TAP" : expected < 0 ? "LEFT" : "RIGHT";
      this.audio.miss("wrong");
      if (phraseSealed) {
        this.audio.capture(phraseSealed.signalLayer);
      }
      this.feedbackText.setColor("#ff5b45");
      this.feedbackText.setText("WRONG");
      this.feedbackUntil = performance.now() + 760;
      this.vibrate([7, 18, 7]);
      this.bridge.onFeedback(
        phraseSealed
          ? `WRONG · PHRASE SEALED · ${PULSE_LAYERS[phraseSealed.signalLayer].name} LIVE`
          : phraseDropped
            ? `WRONG · ${PULSE_LAYERS[phraseDropped.signalLayer].name} CHANNEL DROPPED`
            : `WRONG · ${expectedLabel}`,
      );
      this.bridge.onStateChange(this.state);
      this.draw();
      return;
    }

    if (cueResult === "miss") {
      this.audio.miss("late");
      this.feedbackText.setColor("#ff5b45");
      this.feedbackText.setText("LATE");
      this.feedbackUntil = performance.now() + 760;
      this.vibrate([5, 18, 5]);
      this.bridge.onFeedback("LATE");
      this.bridge.onStateChange(this.state);
      this.draw();
      return;
    }

    const event = this.inputData.chart.events[cue.eventIndex];
    const routedLayer =
      event?.signalLayer ?? pulseLayerForFace(next.activeFace);
    const judgement = cueResult;
    this.audio.hit(routedLayer, cue.lane, judgement);
    if (phraseSealed) {
      this.audio.capture(phraseSealed.signalLayer);
    }
    const judgementLabel = judgement === "perfect" ? "PERFECT" : "GOOD";
    this.feedbackText.setColor(
      judgement === "perfect" ? "#1456f0" : "#181818",
    );
    this.feedbackText.setText(judgementLabel);
    this.feedbackUntil = performance.now() + 680;
    this.bursts.push({
      startedAt: performance.now(),
      color: LAYER_COLORS[routedLayer],
      perfect: judgement === "perfect",
    });
    this.cameras.main.flash(
      judgement === "perfect" ? 120 : 70,
      20,
      86,
      240,
      false,
    );
    this.vibrate(judgement === "perfect" ? [12, 22, 12] : 10);
    this.bridge.onFeedback(
      phraseSealed
        ? `${judgementLabel} · PHRASE SEALED · ${PULSE_LAYERS[phraseSealed.signalLayer].name} LIVE`
        : phraseDropped
          ? `${judgementLabel} · ${PULSE_LAYERS[phraseDropped.signalLayer].name} CHANNEL DROPPED`
          : judgementLabel,
    );
    this.bridge.onStateChange(this.state);
    this.draw();
  };

  tap = () => {
    this.route(0);
  };

  toggleMuted = () => {
    const muted = this.audio.toggleMuted();
    this.bridge.onMutedChange(muted);
    this.bridge.onFeedback(muted ? "Audio muted" : "Audio live");
  };

  finish = () => {
    if (this.completed) return;
    this.completed = true;
    this.state = finishPulseState(this.inputData.chart, this.state);
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

  private songTimeAtPointer(pointerStartedAt?: number) {
    const currentSongTime = Math.max(0, this.songTime);
    if (pointerStartedAt === undefined || !Number.isFinite(pointerStartedAt)) {
      return currentSongTime;
    }
    const gestureDurationMs = performance.now() - pointerStartedAt;
    if (gestureDurationMs < 0 || gestureDurationMs > 1_500) {
      return currentSongTime;
    }
    return Math.max(0, currentSongTime - gestureDurationMs / 1_000);
  }

  private vibrate(pattern: number | number[]) {
    if (typeof navigator === "undefined") return;
    navigator.vibrate?.(pattern);
  }

  private eventPosition(event: PulseEvent) {
    const delta = event.time - Math.max(0, this.songTime);
    const x =
      delta >= 0
        ? TARGET_X +
          Phaser.Math.Clamp(delta / LOOKAHEAD_SECONDS, 0, 1) *
            (STREAM_END_X - TARGET_X)
        : TARGET_X + delta * 190;
    const perspective = Phaser.Math.Clamp(
      (x - TARGET_X) / (STREAM_END_X - TARGET_X),
      0,
      1,
    );
    const hashWave = (hexByte(event.blockHash, event.index + 3) % 17) - 8;
    return {
      delta,
      x,
      y: TARGET_Y + hashWave * perspective * 1.8,
      size: Phaser.Math.Linear(72, 34, perspective),
    };
  }

  private nearestOpenEvent() {
    return this.inputData.chart.events
      .filter(
        (event) =>
          !this.state.eventResults[event.id] &&
          event.time >= Math.max(0, this.songTime) - 0.55,
      )
      .sort((left, right) => left.time - right.time)[0];
  }

  private drawStream() {
    this.inputData.chart.events.forEach((event) => {
      const { delta, x, y, size } = this.eventPosition(event);
      if (delta < -0.7 || delta > LOOKAHEAD_SECONDS) return;
      const result = this.state.eventResults[event.id];
      if (result === "perfect" || result === "good") return;
      const color = LAYER_COLORS[event.signalLayer];
      const alpha = result === "flow" ? 0.18 : 0.98;
      const particleCount = Math.min(9, 3 + (event.txCount % 7));

      for (let index = 0; index < particleCount; index += 1) {
        const byte = hexByte(event.signalHash, index + event.index);
        const particleX = x + size + 24 + index * (17 + (byte % 7));
        const particleY = y + ((byte % 9) - 4) * 9;
        const particleSize = 5 + (byte % 8);
        this.ink.fillStyle(
          LAYER_COLORS[(event.signalLayer + index) % 4],
          alpha * (0.34 + (particleCount - index) / particleCount / 2),
        );
        this.ink.fillRect(
          particleX,
          particleY - particleSize / 2,
          particleSize,
          particleSize,
        );
      }

      this.ink.fillStyle(color, alpha);
      this.ink.fillRoundedRect(
        x - size,
        y - size,
        size * 2,
        size * 2,
        Math.max(5, size * 0.12),
      );
      this.ink.lineStyle(3, INK, alpha);
      this.ink.strokeRoundedRect(
        x - size,
        y - size,
        size * 2,
        size * 2,
        Math.max(5, size * 0.12),
      );
      this.ink.fillStyle(PAPER, 0.84 * alpha);
      const cell = size * 0.33;
      this.ink.fillRect(x - cell * 1.45, y - cell * 1.45, cell, cell);
      this.ink.fillRect(x + cell * 0.45, y - cell * 1.45, cell, cell * 2);
      this.ink.fillRect(x - cell * 1.45, y + cell * 0.45, cell * 2, cell);
    });

    const nearest = this.nearestOpenEvent();
    if (nearest) {
      const position = this.eventPosition(nearest);
      this.incomingText
        .setPosition(position.x, position.y + position.size + 12)
        .setText(`#${nearest.blockNumber}`)
        .setVisible(position.x > TARGET_X + 80);
    } else {
      this.incomingText.setVisible(false);
    }
  }

  private drawTarget() {
    const nearest = this.nearestOpenEvent();
    const delta = nearest
      ? Math.abs(nearest.time - Math.max(0, this.songTime))
      : 1;
    const pulse = Phaser.Math.Clamp(1 - delta / 0.62, 0, 1);
    const guide = nearest?.index !== undefined && nearest.index < 3;
    const ringColor = nearest
      ? LAYER_COLORS[nearest.signalLayer]
      : BLUE;

    this.ink.fillStyle(PAPER, 0.96);
    this.ink.fillCircle(TARGET_X, TARGET_Y, 78);
    this.ink.lineStyle(3 + pulse * 7, ringColor, 0.92);
    this.ink.strokeCircle(TARGET_X, TARGET_Y, 78 + pulse * 8);
    this.ink.lineStyle(2, INK, 0.42);
    this.ink.strokeCircle(TARGET_X, TARGET_Y, 103 + pulse * 18);
    this.ink.lineStyle(1, ringColor, 0.26);
    this.ink.strokeCircle(TARGET_X, TARGET_Y, 126 + pulse * 28);

    this.cueText.setVisible(
      Boolean(nearest) &&
        Math.abs((nearest?.time ?? 0) - Math.max(0, this.songTime)) < 0.66 &&
        (guide || this.state.sealed === 0),
    );
    this.cueText.setScale(1 + pulse * 0.18);
  }

  private drawBursts() {
    const now = performance.now();
    this.bursts = this.bursts.filter((burst) => now - burst.startedAt < 560);
    this.bursts.forEach((burst) => {
      const age = (now - burst.startedAt) / 560;
      this.ink.lineStyle(
        burst.perfect ? 6 : 4,
        burst.color,
        Math.max(0, 1 - age),
      );
      this.ink.strokeCircle(TARGET_X, TARGET_Y, 85 + age * 180);
      for (let index = 0; index < 12; index += 1) {
        const angle = (Math.PI * 2 * index) / 12;
        const distance = 70 + age * (130 + (index % 3) * 22);
        const size = 10 * (1 - age) + 2;
        this.ink.fillStyle(
          LAYER_COLORS[index % LAYER_COLORS.length],
          Math.max(0, 0.9 - age),
        );
        this.ink.fillRect(
          TARGET_X + Math.cos(angle) * distance - size / 2,
          TARGET_Y + Math.sin(angle) * distance - size / 2,
          size,
          size,
        );
      }
    });
  }

  private drawProgress() {
    const startX = 282;
    const width = 630;
    const gap = width / Math.max(1, this.inputData.chart.events.length - 1);
    this.ink.lineStyle(2, INK, 0.18);
    this.ink.lineBetween(startX, 548, startX + width, 548);
    this.inputData.chart.events.forEach((event, index) => {
      const result = this.state.eventResults[event.id];
      const x = startX + index * gap;
      const color =
        result === "perfect" || result === "good"
          ? LAYER_COLORS[event.signalLayer]
          : INK;
      this.ink.fillStyle(
        color,
        result === "perfect" || result === "good"
          ? 1
          : result === "flow"
            ? 0.18
            : 0.45,
      );
      this.ink.fillCircle(x, 548, result ? 8 : 6);
      if (result === "perfect") {
        this.ink.lineStyle(2, color, 0.6);
        this.ink.strokeCircle(x, 548, 13);
      }
    });

    for (let layer = 0; layer < 4; layer += 1) {
      this.ink.fillStyle(
        LAYER_COLORS[layer],
        layer < this.state.layersUnlocked ? 1 : 0.12,
      );
      this.ink.fillRect(28 + layer * 30, 540, 18, 18);
    }
  }

  private draw() {
    if (!this.ink) return;
    this.ink.clear();
    this.ink.fillStyle(PAPER, 0.94);
    this.ink.fillRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 14);
    this.ink.lineStyle(2, INK, 0.72);
    this.ink.strokeRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 14);

    for (let x = 40; x < GAME_WIDTH; x += 72) {
      this.ink.lineStyle(1, INK, 0.045);
      this.ink.lineBetween(x, 72, x, 524);
    }
    this.ink.lineStyle(3, INK, 0.2);
    this.ink.lineBetween(116, TARGET_Y, STREAM_END_X, TARGET_Y);
    this.ink.lineStyle(1, CORAL, 0.65);
    this.ink.lineBetween(TARGET_X, 164, TARGET_X, 448);

    this.drawStream();
    this.drawTarget();
    this.drawBursts();
    this.drawProgress();

    const event =
      this.inputData.chart.events[this.state.currentEvent] ??
      this.inputData.chart.events[0];
    this.blockText.setText(
      `${this.inputData.chart.ranked ? "LIVE BASE" : "PRACTICE"}  ·  BLOCK ${Math.min(this.state.currentEvent + 1, this.inputData.chart.events.length)} / ${this.inputData.chart.events.length}`,
    );
    this.signalText.setText(
      event
        ? `#${event.blockNumber}  ·  ${event.txCount} TX  ·  ${(event.gasRatio * 100).toFixed(1)}% GAS`
        : "READING THE NEXT BASE BLOCK",
    );
    if (performance.now() > this.feedbackUntil) {
      this.feedbackText.setText("");
    }
  }
}

export function createBaseJamPulseGame(
  parent: HTMLElement,
  input: BaseJamPulseGameInput,
  bridge: BaseJamPulseBridge,
): BaseJamPulseController {
  let scene: BaseJamPulseScene | null = new BaseJamPulseScene(input, bridge);
  const game = new Phaser.Game({
    // Phaser owns the proven timing/controller loop; React Three Fiber owns
    // every visible pixel. HEADLESS prevents a second hidden renderer and GPU
    // context from competing with the actual playfield on phones.
    type: Phaser.HEADLESS,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scene,
    input: false,
  });

  return {
    capture: () => scene?.capture() ?? null,
    destroy: () => {
      scene?.shutdown();
      game.destroy(true);
      scene = null;
    },
    finish: () => scene?.finish(),
    route: (direction, pointerStartedAt) =>
      scene?.route(direction, pointerStartedAt),
    tap: () => scene?.tap(),
    toggleMuted: () => scene?.toggleMuted(),
  };
}

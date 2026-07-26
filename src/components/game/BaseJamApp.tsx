"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { armPulseAudio } from "@/audio/pulseAudio";
import { WalletButton } from "@/components/WalletButton";
import {
  createPulseChart,
  PULSE_LAYERS,
  PULSE_RUN_SECONDS,
  PULSE_STEP_SECONDS,
  pulseComboMultiplier,
  pulseExpectedRoute,
  pulseResult,
  type PulseChart,
  type PulseState,
} from "@/game/pulse";
import type {
  LevelApiResponse,
  LevelManifestV1,
  MixApiResponse,
} from "@/lib/base/types";
import type { BaseJamPulseController } from "@/phaser/createBaseJamPulseGame";
import { BaseJamPulseBoard } from "./BaseJamPulseBoard";

type Phase = "home" | "loading" | "playing" | "result" | "error";

function numberLabel(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US").format(numeric)
    : value;
}

async function loadLevel(blockNumber?: string | null): Promise<LevelApiResponse> {
  const endpoint = blockNumber
    ? `/api/levels/${encodeURIComponent(blockNumber)}`
    : "/api/levels/latest";
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Base is busy. Give the sequencer a few seconds."
        : "Could not load a Base block.",
    );
  }
  return response.json() as Promise<LevelApiResponse>;
}

async function loadMix(): Promise<MixApiResponse> {
  const response = await fetch("/api/mixes/latest", {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error("Could not sequence the latest Base blocks.");
  }
  return response.json() as Promise<MixApiResponse>;
}

async function loadPracticeLevel(
  blockNumber?: string | null,
): Promise<LevelApiResponse> {
  const query = blockNumber
    ? `?block=${encodeURIComponent(blockNumber)}`
    : "";
  const response = await fetch(`/api/levels/practice${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error("Could not prepare the practice mix.");
  }
  return response.json() as Promise<LevelApiResponse>;
}

function Header({ mode = "home" }: { mode?: Phase }) {
  return (
    <header className="site-header">
      <button
        aria-label="Return to BASE JAM home"
        className="brand"
        onClick={() => {
          if (mode !== "home") window.location.assign("/");
        }}
        type="button"
      >
        <Image alt="" height={38} src="/mark.svg" width={38} />
        <span>BASE JAM</span>
        <sup>8453</sup>
      </button>
      <div className="header-meta">
        <span className="chain-pill">
          <i />
          Base mainnet
        </span>
        <WalletButton compact />
      </div>
    </header>
  );
}

function HomeMixPreview({
  challengeBlock,
  level,
  loading,
  onPlay,
}: {
  challengeBlock?: string | null;
  level?: LevelManifestV1;
  loading: boolean;
  onPlay: () => void;
}) {
  const signals = level?.pieces.slice(0, 18) ?? [];

  return (
    <div
      className="home-mix-preview home-pulse-preview"
      data-testid="home-mix-preview"
    >
      <div className="pulse-preview-grid" aria-hidden />
      <div className="pulse-preview-track" aria-hidden />
      <div className="pulse-preview-target" aria-hidden>
        <i />
        <span>TAP</span>
      </div>
      <div className="pulse-preview-block" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="pulse-preview-transactions" aria-hidden>
        {signals.map((signal, index) => {
          const hashByte =
            Number.parseInt(
              signal.hash.slice(
                2 + (index % 12) * 2,
                4 + (index % 12) * 2,
              ),
              16,
            ) ||
            index * 13;
          const layer = PULSE_LAYERS[index % PULSE_LAYERS.length];
          return (
            <i
              key={`${signal.id}-${index}`}
              style={
                {
                  "--signal-color": layer.color,
                  "--signal-x": `${54 + (hashByte % 38)}%`,
                  "--signal-y": `${36 + (hashByte % 30)}%`,
                  "--signal-size": `${5 + (hashByte % 10)}px`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="mix-preview-start">
        <small>
          {level?.ranked ? "10 confirmed Base blocks" : "Practice feed ready"}
        </small>
        <strong>
          {challengeBlock
            ? `Challenge #${numberLabel(challengeBlock)}`
            : "One thumb. Live chain."}
        </strong>
        <button
          className="button button--primary"
          disabled={loading}
          onClick={onPlay}
          type="button"
        >
          <span>{loading ? "Reading Base…" : "Tap to start"}</span>
          <b aria-hidden>↗</b>
        </button>
        <em>No wallet · 20 seconds · 31 live commands</em>
      </div>
    </div>
  );
}

function HomeView({
  challengeBlock,
  level,
  levelError,
  loading,
  onPlay,
}: {
  challengeBlock?: string | null;
  level?: LevelManifestV1;
  levelError?: Error | null;
  loading: boolean;
  onPlay: () => void;
}) {
  return (
    <main className="home-shell rhythm-home">
      <Header />
      <section className="arcade-home rhythm-arcade-home">
        <div className="arcade-brief rhythm-brief">
          <p className="eyebrow">
            The one-thumb Base rhythm game
            <span> / 120 BPM</span>
          </p>
          <h1>
            JAM
            <br />
            THE CHAIN.
          </h1>
          <p className="hero-deck">
            Ride the Base signal tunnel. Tap, flick left, or flick right as
            each command reaches the capture line. Clear a block phrase and
            its music channel joins the mix.
          </p>
          <div className="ready-block" aria-live="polite">
            <span>Now sequencing</span>
            <strong>
              {level
                ? `Block ${numberLabel(level.source.number)}`
                : levelError
                  ? "Practice feed available"
                  : "Reading Base…"}
            </strong>
            <small>
              {level
                ? `${level.pieces.length} transaction signals`
                : "Quantizing the latest blocks"}
            </small>
          </div>
        </div>

        <section className="ready-stage rhythm-ready-stage">
          <div className="ready-stage__top">
            <div>
              <span>Live sequencer</span>
              <strong>
                {level
                  ? `#${numberLabel(level.source.number)}`
                  : "Synchronizing"}
              </strong>
            </div>
            <span
              className={`ready-rank ${level?.ranked ? "ready-rank--ranked" : ""}`}
            >
              <i />
              {level?.ranked ? "Canonical Base data" : "Practice capable"}
            </span>
          </div>
          <HomeMixPreview
            challengeBlock={challengeBlock}
            level={level}
            loading={loading}
            onPlay={onPlay}
          />
          <div className="ready-stage__bottom">
            <span>Tap to stay · flick left or right to switch tracks</span>
            <a
              href={level?.source.explorerUrl ?? "https://basescan.org"}
              rel="noreferrer"
              target="_blank"
            >
              Inspect source ↗
            </a>
          </div>
        </section>

        <aside className="ready-queue rhythm-queue pulse-queue">
          <div className="ready-timer" aria-label="20 second live set">
            <span>{PULSE_RUN_SECONDS}</span>
            <small>seconds / 10 live blocks</small>
          </div>
          <p className="eyebrow">One thumb / growing mix</p>
          <div className="stem-stack pulse-layer-stack">
            {PULSE_LAYERS.map((layer, index) => (
              <div key={layer.id}>
                <i style={{ background: layer.color }} />
                <small>0{index + 1}</small>
                <strong>{layer.name}</strong>
              </div>
            ))}
          </div>
          <div className="ready-rules">
            <span>Tap · left · right</span>
            <span>Misses reset combo</span>
            <span>Live Base data</span>
          </div>
        </aside>

        <div className="daily-poster rhythm-poster" aria-label="BASE JAM art">
          <Image
            alt=""
            fill
            priority
            sizes="(max-width: 800px) 92vw, 28vw"
            src="/art/base-jam-riso.png"
          />
          <div className="art-stamp">
            <span>{level ? numberLabel(level.source.number) : "BASE"}</span>
            <small>{level?.ranked ? "live signal" : "practice ready"}</small>
          </div>
        </div>
      </section>

      <details className="field-guide">
        <summary>
          <span>Field guide</span>
          <strong>How to play the chain</strong>
          <b aria-hidden>+</b>
        </summary>
        <div className="steps">
          <article>
            <span>01</span>
            <h2>Read the block.</h2>
            <p>
              Every phrase comes from a confirmed Base block. Its
              transactions, gas, and calldata shape the command pattern,
              energy, and sound.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Hit the capture bar.</h2>
            <p>
              Follow the bright command: tap, flick left, or flick right as
              it enters the lime capture line. The first four hits teach every
              move.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Make it bloom.</h2>
            <p>
              Hit at least three quarters of a block phrase to bring its music
              channel live. A miss breaks combo, never the run, so the next
              command is always a clean recovery.
            </p>
          </article>
        </div>
      </details>

      <footer className="site-footer">
        <strong>BASE JAM / 8453</strong>
        <span>Live chain data. Procedural audio. Local beta scoring.</span>
        <a href="https://base.org" rel="noreferrer" target="_blank">
          Base ↗
        </a>
      </footer>
    </main>
  );
}

function LoadingView() {
  return (
    <main className="stage-shell">
      <Header mode="loading" />
      <section className="loading-press rhythm-loading">
        <div className="press-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Building the live set</p>
        <h1>BUILDING 10 PHRASES.</h1>
        <p>
          Turning confirmed Base activity into 31 readable rhythm commands.
        </p>
      </section>
    </main>
  );
}

type PendingPulseInput =
  | { readonly kind: "tap" }
  | {
      readonly kind: "route";
      readonly direction: -1 | 0 | 1;
      readonly pointerStartedAt?: number;
    };

type GestureLabel = "none" | "tap" | "flick-left" | "flick-right";

interface PointerGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startedAt: number;
}

const INPUT_DEBOUNCE_MS = 90;

function GameView({
  audioContext,
  chart,
  onComplete,
}: {
  audioContext: AudioContext | null;
  chart: PulseChart;
  onComplete: (state: PulseState, image: string | null) => void;
}) {
  const controllerRef = useRef<BaseJamPulseController | null>(null);
  const pendingInputsRef = useRef<PendingPulseInput[]>([]);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const runtimeReadyRef = useRef(false);
  const sceneReadyRef = useRef(false);
  const autoStartedRef = useRef(false);
  const startAttemptFrameRef = useRef<number | null>(null);
  const pendingFlushFrameRef = useRef<number | null>(null);
  const lastInputAtRef = useRef(-Infinity);
  const feedbackTimerRef = useRef<number | null>(null);
  const [state, setState] = useState<PulseState | null>(null);
  const [notice, setNotice] = useState(
    "Get ready · tap, flick left, or flick right",
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [lastGesture, setLastGesture] = useState<GestureLabel>("none");
  const handleComplete = useCallback(
    (finished: PulseState, image: string | null) => {
      onComplete(finished, image);
    },
    [onComplete],
  );

  const sendInput = useCallback((input: PendingPulseInput) => {
    const controller = controllerRef.current;
    if (!runtimeReadyRef.current || !controller) {
      pendingInputsRef.current.push(input);
      return;
    }
    // The controller is deliberately constructed before WebGL is ready. Do not
    // let a tap on the still-loading surface bypass the first-render gate.
    if (!autoStartedRef.current) return;
    if (input.kind === "tap") {
      controller.tap();
      return;
    }
    controller.route(input.direction, input.pointerStartedAt);
  }, []);

  const triggerInput = useCallback(
    (input: PendingPulseInput, gesture: Exclude<GestureLabel, "none">) => {
      const now = performance.now();
      if (now - lastInputAtRef.current < INPUT_DEBOUNCE_MS) return false;
      lastInputAtRef.current = now;
      setLastGesture(gesture);
      sendInput(input);
      return true;
    },
    [sendInput],
  );

  const triggerTap = useCallback(() => {
    return triggerInput({ kind: "tap" }, "tap");
  }, [triggerInput]);

  const triggerRoute = useCallback(
    (direction: -1 | 1, pointerStartedAt?: number) => {
      return triggerInput(
        { direction, kind: "route", pointerStartedAt },
        direction < 0 ? "flick-left" : "flick-right",
      );
    },
    [triggerInput],
  );

  const triggerPointerTap = useCallback(
    (pointerStartedAt: number) => {
      return triggerInput(
        { direction: 0, kind: "route", pointerStartedAt },
        "tap",
      );
    },
    [triggerInput],
  );

  const scheduleStartAttempt = useCallback(() => {
    if (startAttemptFrameRef.current !== null) return;
    startAttemptFrameRef.current = requestAnimationFrame(() => {
      startAttemptFrameRef.current = null;
      const controller = controllerRef.current;
      if (
        !controller ||
        !runtimeReadyRef.current ||
        !sceneReadyRef.current ||
        autoStartedRef.current
      ) {
        return;
      }

      autoStartedRef.current = true;
      controller.tap();
      const pendingInputs = pendingInputsRef.current.splice(0);
      if (pendingInputs.length === 0) return;

      pendingFlushFrameRef.current = requestAnimationFrame(() => {
        pendingFlushFrameRef.current = null;
        if (controllerRef.current !== controller) return;
        pendingInputs.forEach((input) => {
          if (input.kind === "tap") {
            controller.tap();
          } else {
            controller.route(input.direction, input.pointerStartedAt);
          }
        });
      });
    });
  }, []);

  const handleReady = useCallback(() => {
    runtimeReadyRef.current = true;
    setNotice(
      sceneReadyRef.current
        ? "Follow the command line"
        : "Preparing the signal tunnel",
    );
    scheduleStartAttempt();
  }, [scheduleStartAttempt]);

  const handleSceneReady = useCallback(
    (mode: "rendered" | "fallback" | "timeout") => {
      sceneReadyRef.current = true;
      setNotice(
        mode === "rendered"
          ? "Follow the command line"
          : "Graphics fallback · follow the command line",
      );
      scheduleStartAttempt();
    },
    [scheduleStartAttempt],
  );

  const handleSurfaceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if ([" ", "enter", "j"].includes(key)) {
        event.preventDefault();
        triggerTap();
      } else if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        triggerRoute(-1, performance.now());
      } else if (key === "arrowright" || key === "d") {
        event.preventDefault();
        triggerRoute(1, performance.now());
      }
    },
    [triggerRoute, triggerTap],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const startedAt = performance.now();
      pointerGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt,
      };
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events do not always register as active pointers.
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = pointerGestureRef.current;
      if (
        !event.isPrimary ||
        !gesture ||
        gesture.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      pointerGestureRef.current = null;
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // A system-level pointer cancellation may already have released it.
      }
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const flickThreshold = Math.min(
        44,
        Math.max(28, window.innerWidth * 0.08),
      );
      if (
        Math.abs(deltaX) >= flickThreshold &&
        Math.abs(deltaX) > Math.abs(deltaY)
      ) {
        triggerRoute(deltaX < 0 ? -1 : 1, gesture.startedAt);
        return;
      }
      triggerPointerTap(gesture.startedAt);
    },
    [triggerPointerTap, triggerRoute],
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerGestureRef.current?.pointerId !== event.pointerId) return;
      pointerGestureRef.current = null;
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // A system-level pointer cancellation may already have released it.
      }
    },
    [],
  );

  const handleState = useCallback((next: PulseState) => {
    setState(next);
  }, []);
  const handleFeedback = useCallback((message: string) => {
    setNotice(message);
    setFeedback(message);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, 1_050);
  }, []);
  const handleMuted = useCallback((next: boolean) => {
    setMuted(next);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "m") {
        controllerRef.current?.toggleMuted();
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'button, a, input, select, textarea, [contenteditable="true"]',
        )
      ) {
        return;
      }
      if ([" ", "enter", "j"].includes(key)) {
        event.preventDefault();
        triggerTap();
      } else if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        triggerRoute(-1, performance.now());
      } else if (key === "arrowright" || key === "d") {
        event.preventDefault();
        triggerRoute(1, performance.now());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerRoute, triggerTap]);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (startAttemptFrameRef.current !== null) {
        window.cancelAnimationFrame(startAttemptFrameRef.current);
        startAttemptFrameRef.current = null;
      }
      if (pendingFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingFlushFrameRef.current);
        pendingFlushFrameRef.current = null;
      }
    },
    [],
  );

  const currentEvent = state?.currentEvent ?? 0;
  const songTime = (state?.currentStep ?? -16) * PULSE_STEP_SECONDS;
  const elapsed = Math.max(0, songTime);
  const remaining = Math.max(0, Math.ceil(chart.durationSeconds - elapsed));
  const event = chart.events[currentEvent] ?? chart.events[0];
  const sealed = state?.sealed ?? 0;
  const tutorialStep = state?.tutorialStep ?? 0;
  const activeChannel = (state?.activeFace ?? 0) % PULSE_LAYERS.length;
  const currentCue = chart.cues[state?.currentCue ?? 0];
  const expectedRoute = currentCue
    ? pulseExpectedRoute(currentCue, tutorialStep)
    : 0;
  const expectedRouteLabel =
    expectedRoute < 0 ? "left" : expectedRoute > 0 ? "right" : "tap";
  const phraseCues = chart.cues.filter(
    (cue) => cue.eventIndex === currentEvent,
  );
  const hits = (state?.perfect ?? 0) + (state?.good ?? 0);
  const multiplier = pulseComboMultiplier(state?.streak ?? 0);
  const scoreReadout =
    (state?.streak ?? 0) > 0
      ? `${state?.streak ?? 0} combo · ${multiplier}×`
      : `${hits}/${chart.cues.length} hits`;

  return (
    <main className="game-shell pulse-game-shell">
      <Header mode="playing" />
      <section
        className="pulse-game-layout"
        data-active-face={state?.activeFace ?? 0}
        data-combo={state?.streak ?? 0}
        data-current-cue={state?.currentCue ?? 0}
        data-current-event={currentEvent}
        data-current-step={state?.currentStep ?? -16}
        data-expected-route={expectedRouteLabel}
        data-hits={hits}
        data-last-gesture={lastGesture}
        data-misses={state?.misses ?? 0}
        data-muted={muted}
        data-play-mode="tap-flick"
        data-sealed={sealed}
        data-tutorial-step={tutorialStep}
        data-visual-version="amplitude"
        data-wrong={state?.wrong ?? 0}
      >
        <div className="pulse-game-hud">
          <div className="pulse-live-chip">
            <span>
              <i className={chart.ranked ? "ranked" : ""} />
              {chart.ranked ? "Live Base" : "Practice"}
            </span>
            <h1 className="pulse-live-chip__desktop">
              {chart.ranked
                ? `BASE #${numberLabel(event.blockNumber)}`
                : "PRACTICE SIGNAL"}
            </h1>
            <h1
              className="pulse-live-chip__mobile"
              title={`Base block ${numberLabel(event.blockNumber)}`}
            >
              {chart.ranked ? "BLOCK" : "PRACTICE"}{" "}
              {Math.min(currentEvent + 1, chart.events.length)}/
              {chart.events.length}
            </h1>
            <div
              aria-label="Temporary music channels"
              className="pulse-channel-statuses"
            >
              {PULSE_LAYERS.map((layer, index) => {
                const captures = state?.channelCaptures[index] ?? 0;
                const isLive =
                  (state?.capturedUntilBar[index] ?? 0) > currentEvent;
                return (
                  <span
                    aria-label={`${layer.name}: ${
                      isLive ? "live" : "off"
                    }${activeChannel === index ? ", selected" : ""}`}
                    className={[
                      isLive ? "is-live" : "",
                      captures > 0 && !isLive ? "is-expired" : "",
                      activeChannel === index ? "is-active" : "",
                      state?.lastRoutedLayer === index ? "is-routed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-captures={captures}
                    data-live={isLive}
                    data-stem={layer.name.toLowerCase()}
                    key={layer.id}
                    style={{ "--layer-color": layer.color } as CSSProperties}
                  >
                    <i />
                    <b>{layer.name}</b>
                    <small>{isLive ? "LIVE" : "OFF"}</small>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="pulse-center-hud">
            <div
              aria-label={`Block phrase ${currentEvent + 1} progress`}
              className="pulse-phrase-status"
            >
              <strong>
                PHRASE {Math.min(currentEvent + 1, chart.events.length)}/
                {chart.events.length}
              </strong>
              <span>
                {phraseCues.map((cue) => {
                  const result = state?.cueResults[cue.id];
                  return (
                    <i
                      className={[
                        result === "perfect" || result === "good"
                          ? "is-hit"
                          : "",
                        result === "wrong" || result === "miss"
                          ? "is-miss"
                          : "",
                        cue.index === (state?.currentCue ?? 0)
                          ? "is-current"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={cue.id}
                    />
                  );
                })}
              </span>
            </div>
          </div>
          <div
            aria-label={`${remaining} seconds remaining; ${scoreReadout}`}
            className="pulse-clock"
            role="timer"
          >
            <span>{remaining.toString().padStart(2, "0")}</span>
            <small>{scoreReadout}</small>
          </div>
        </div>

        <section
          aria-label="Tap to stay on this channel. Flick left or right to switch channels."
          className="pulse-tap-surface"
          onKeyDown={handleSurfaceKeyDown}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          role="button"
          tabIndex={0}
        >
          <BaseJamPulseBoard
            audioContext={audioContext}
            chart={chart}
            controllerRef={controllerRef}
            feedback={feedback}
            onComplete={handleComplete}
            onFeedback={handleFeedback}
            onMutedChange={handleMuted}
            onReady={handleReady}
            onSceneReady={handleSceneReady}
            onStateChange={handleState}
          />
        </section>

        <footer className="pulse-game-footer">
          <p aria-live="polite" className="pulse-notice">
            {notice}
          </p>
          <button
            aria-label={muted ? "Sound off" : "Sound on"}
            aria-pressed={!muted}
            className="pulse-mute"
            data-muted={muted}
            onClick={() => controllerRef.current?.toggleMuted()}
            title={muted ? "Turn sound on (M)" : "Mute sound (M)"}
            type="button"
          >
            <span aria-hidden className="pulse-mute__icon">
              ♪
            </span>
            <kbd>M</kbd>
          </button>
        </footer>
      </section>
    </main>
  );
}

function ResultReceipt({
  chart,
  state,
}: {
  chart: PulseChart;
  state: PulseState;
}) {
  const result = pulseResult(state);

  return (
    <div className="mix-receipt pulse-receipt" aria-label="Your Base pulse receipt">
      <div className="mix-receipt__top">
        <span>BASE JAM</span>
        <small>BLOCK PULSE / 8453</small>
      </div>
      <div className="mix-receipt__wave" aria-hidden>
        {chart.cues.map((cue) => {
          const event = chart.events[cue.eventIndex];
          const judged = state.cueResults[cue.id];
          return (
            <i
              className={judged === "perfect" || judged === "good" ? "is-hit" : ""}
              key={cue.id}
              style={
                {
                  "--bar-height": `${28 + Math.round(cue.energy * 72)}%`,
                  "--bar-color":
                    PULSE_LAYERS[event?.signalLayer ?? 0].color,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="mix-receipt__blocks">
        {chart.events.map((event, index) => (
          <span key={event.id}>
            {index % 2 === 0 ? numberLabel(event.blockNumber) : "•"}
          </span>
        ))}
      </div>
      <div className="mix-receipt__bottom">
        <strong>{result.accuracy}%</strong>
        <div>
          <span>{result.vibe}</span>
          <small>
            {state.perfect + state.good} of {chart.cues.length} commands hit
          </small>
        </div>
        <b>{state.maxStreak}×</b>
      </div>
    </div>
  );
}

function ResultView({
  chart,
  onRetry,
  state,
}: {
  chart: PulseChart;
  onRetry: () => void;
  state: PulseState;
}) {
  const [shareState, setShareState] = useState("Share the mix");
  const result = pulseResult(state);
  const hits = state.perfect + state.good;

  async function share() {
    const first = chart.events[0]?.blockNumber;
    const last = chart.events.at(-1)?.blockNumber;
    const text = `I hit ${hits}/${chart.cues.length} live Base commands on BASE JAM — ${result.vibe} with a ${state.maxStreak}× combo across blocks ${first}–${last}.`;
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My BASE JAM mix", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
      }
      setShareState("Mix link ready ✓");
    } catch {
      setShareState("Share cancelled");
    }
  }

  return (
    <main className="result-shell rhythm-result-shell">
      <Header mode="result" />
      <section className="result-layout rhythm-result-layout">
        <div className="result-copy">
          <p className="eyebrow">
            Pulse complete / {chart.events.length} Base blocks
          </p>
          <h1>{result.vibe}.</h1>
          <p>
            You hit {hits} live commands and cleared {state.sealed} of{" "}
            {chart.events.length} block phrases. The Base data supplied the
            chart; your timing built the mix. You landed {state.perfect} perfect
            and {state.good} good hits, with {state.wrong + state.misses} clean
            recoveries.
          </p>
          <div className="result-stats rhythm-result-stats">
            <div>
              <span>Commands hit</span>
              <strong>{hits}/{chart.cues.length}</strong>
            </div>
            <div>
              <span>Perfect</span>
              <strong>{state.perfect}</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{state.score.toLocaleString()}</strong>
            </div>
            <div>
              <span>Best chain</span>
              <strong>{state.maxStreak}× chain</strong>
            </div>
          </div>
          <div className="result-actions">
            <button className="button button--primary" onClick={onRetry} type="button">
              Run it back
              <b aria-hidden>↻</b>
            </button>
            <button className="button button--ink" onClick={share} type="button">
              {shareState}
            </button>
          </div>
          <p className="verification-state">
            {chart.ranked
              ? "✓ Canonical Base data · local beta score"
              : "Practice data · local beta score"}
          </p>
        </div>
        <ResultReceipt chart={chart} state={state} />
      </section>
    </main>
  );
}

function ErrorView({
  message,
  onPractice,
  onRetry,
}: {
  message: string;
  onPractice: () => void;
  onRetry: () => void;
}) {
  return (
    <main className="stage-shell">
      <Header mode="error" />
      <section className="error-card">
        <span className="error-code">RPC / PAUSE</span>
        <h1>THE FEED LOST BASE.</h1>
        <p>{message}</p>
        <div>
          <button className="button button--primary" onClick={onRetry} type="button">
            Retry Base
          </button>
          <button className="button button--ink" onClick={onPractice} type="button">
            Use practice mix
          </button>
        </div>
      </section>
    </main>
  );
}

export function BaseJamApp() {
  const [phase, setPhase] = useState<Phase>("home");
  const [level, setLevel] = useState<LevelManifestV1 | null>(null);
  const [chart, setChart] = useState<PulseChart | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [finishedState, setFinishedState] = useState<PulseState | null>(null);
  const [fatalError, setFatalError] = useState("Base did not answer in time.");
  const [requestedBlock, setRequestedBlock] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("block");
    if (value && /^\d{1,24}$/.test(value)) {
      setRequestedBlock(value);
    }
  }, []);

  const levelQuery = useQuery({
    queryKey: ["level", requestedBlock ?? "latest"],
    queryFn: () => loadLevel(requestedBlock),
    enabled: phase === "home",
    retry: 1,
  });

  useEffect(() => {
    if (levelQuery.data?.level) setLevel(levelQuery.data.level);
  }, [levelQuery.data]);

  const start = useCallback(
    async (
      forcedLevel?: LevelManifestV1,
      forcedAudio?: AudioContext | null,
      forcePractice = false,
    ) => {
      const armedAudio =
        forcedAudio === undefined ? armPulseAudio() : forcedAudio;
      setAudioContext(armedAudio);
      setPhase("loading");
      setFinishedState(null);

      try {
        let levels: readonly LevelManifestV1[];
        if (forcedLevel) {
          levels = [forcedLevel];
        } else if (requestedBlock) {
          const selected =
            level?.source.number === requestedBlock
              ? level
              : (await loadLevel(requestedBlock)).level;
          levels = [selected];
        } else if (forcePractice) {
          levels = [(await loadPracticeLevel()).level];
        } else {
          levels = (await loadMix()).levels;
        }
        if (levels.length === 0) {
          throw new Error("The Base sequencer returned an empty mix.");
        }
        const selected = levels.at(-1) ?? levels[0];
        setLevel(selected);
        setChart(createPulseChart(levels));
        setPhase("playing");
      } catch (error) {
        setFatalError(
          error instanceof Error ? error.message : "Could not start the mix.",
        );
        setPhase("error");
      }
    },
    [level, requestedBlock],
  );

  const startPractice = useCallback(() => {
    const armedAudio = armPulseAudio();
    void loadPracticeLevel(requestedBlock)
      .then(({ level: practice }) => start(practice, armedAudio, true))
      .catch((error: unknown) => {
        setFatalError(
          error instanceof Error
            ? error.message
            : "Could not prepare the practice mix.",
        );
        setPhase("error");
      });
  }, [requestedBlock, start]);

  const complete = useCallback((state: PulseState) => {
    setFinishedState(state);
    setPhase("result");
    try {
      const best = Number(localStorage.getItem("base-jam-pulse-best") ?? "0");
      if (state.score > best) {
        localStorage.setItem("base-jam-pulse-best", String(state.score));
      }
    } catch {
      // Local storage is an enhancement; finishing the set never depends on it.
    }
  }, []);
  const retryChart = useCallback(() => {
    setFinishedState(null);
    setPhase("playing");
    void audioContext?.resume();
  }, [audioContext]);

  if (phase === "loading") return <LoadingView />;
  if (phase === "playing" && chart) {
    return (
      <GameView
        audioContext={audioContext}
        chart={chart}
        onComplete={complete}
      />
    );
  }
  if (phase === "result" && chart && finishedState) {
    return (
      <ResultView
        chart={chart}
        onRetry={retryChart}
        state={finishedState}
      />
    );
  }
  if (phase === "error") {
    return (
      <ErrorView
        message={fatalError}
        onPractice={startPractice}
        onRetry={() => void start()}
      />
    );
  }

  return (
    <HomeView
      challengeBlock={requestedBlock}
      level={level ?? undefined}
      levelError={(levelQuery.error as Error | null) ?? undefined}
      loading={levelQuery.isLoading && !level}
      onPlay={() => void start()}
    />
  );
}

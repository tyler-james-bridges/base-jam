"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { armRhythmAudio } from "@/audio/rhythmAudio";
import { WalletButton } from "@/components/WalletButton";
import {
  createRhythmChart,
  RHYTHM_LANES,
  RHYTHM_RUN_SECONDS,
  RHYTHM_STEP_SECONDS,
  rhythmAccuracy,
  rhythmResult,
  type RhythmChart,
  type RhythmColumn,
  type RhythmLane,
  type RhythmState,
} from "@/game/rhythm";
import type {
  LevelApiResponse,
  LevelManifestV1,
  MixApiResponse,
} from "@/lib/base/types";
import type { BaseJamRhythmController } from "@/phaser/createBaseJamRhythmGame";
import { BaseJamRhythmBoard } from "./BaseJamRhythmBoard";

type Phase = "home" | "loading" | "playing" | "result" | "error";

function numberLabel(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US").format(numeric)
    : value;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
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
    <div className="home-mix-preview" data-testid="home-mix-preview">
      <div className="mix-preview-grid" aria-hidden>
        {Array.from({ length: 6 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
      <div className="mix-preview-hitline" aria-hidden>
        <span>HIT</span>
      </div>
      <div className="mix-preview-rails" aria-hidden>
        {RHYTHM_LANES.map((lane) => (
          <div className="mix-preview-rail" key={lane.id}>
            <b style={{ background: lane.color }}>{lane.name}</b>
            <span style={{ borderColor: lane.color }} />
          </div>
        ))}
      </div>
      <div className="mix-preview-signals" aria-hidden>
        {signals.map((signal, index) => {
          const hashByte =
            Number.parseInt(signal.hash.slice(2 + (index % 12) * 2, 4 + (index % 12) * 2), 16) ||
            index * 13;
          const lane = (index % 4) as RhythmLane;
          return (
            <i
              key={`${signal.id}-${index}`}
              style={
                {
                  "--lane": lane,
                  "--signal-color": RHYTHM_LANES[lane].color,
                  "--signal-x": `${31 + (hashByte % 57)}%`,
                  "--signal-y": `${20 + lane * 20}%`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="mix-preview-start">
        <small>
          {level?.ranked ? "15 confirmed Base blocks" : "Practice feed ready"}
        </small>
        <strong>
          {challengeBlock
            ? `Challenge #${numberLabel(challengeBlock)}`
            : "Start the live mix"}
        </strong>
        <button
          className="button button--primary"
          disabled={loading}
          onClick={onPlay}
          type="button"
        >
          <span>{loading ? "Reading Base…" : "Drop into the set"}</span>
          <b aria-hidden>↗</b>
        </button>
        <em>No wallet required · sound on</em>
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
            The live Base rhythm game
            <span> / 120 BPM</span>
          </p>
          <h1>
            JAM
            <br />
            THE CHAIN.
          </h1>
          <p className="hero-deck">
            Real Base transactions become notes. Jump between four instrument
            rails and capture each stem before its block seals.
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
            <span>A / D switch rails · J K L hit · M mute</span>
            <a
              href={level?.source.explorerUrl ?? "https://basescan.org"}
              rel="noreferrer"
              target="_blank"
            >
              Inspect source ↗
            </a>
          </div>
        </section>

        <aside className="ready-queue rhythm-queue">
          <div className="ready-timer" aria-label="30 second live set">
            <span>{RHYTHM_RUN_SECONDS}</span>
            <small>seconds / 15 Base bars</small>
          </div>
          <p className="eyebrow">Four rails / one mix</p>
          <div className="stem-stack">
            {RHYTHM_LANES.map((lane, index) => (
              <div key={lane.id}>
                <i style={{ background: lane.color }} />
                <small>0{index + 1}</small>
                <strong>{lane.name}</strong>
              </div>
            ))}
          </div>
          <div className="ready-rules">
            <span>Same blocks</span>
            <span>Same chart</span>
            <span>Your timing</span>
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
              Each two-second bar is a confirmed Base block. Transaction hash,
              calldata, gas, and fees decide the notes.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Capture a stem.</h2>
            <p>
              Switch to a rail, then hit its three-note phrase with J, K, and
              L. A clean phrase brings that instrument into the mix.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Keep it alive.</h2>
            <p>
              Captured stems play for four bars. Move with the chain, rebuild
              the mix, and leave with a block-by-block performance receipt.
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
        <h1>SYNCING 15 BARS.</h1>
        <p>
          Quantizing confirmed Base transactions into a 120 BPM rhythm chart.
        </p>
      </section>
    </main>
  );
}

function GameView({
  audioContext,
  chart,
  onComplete,
}: {
  audioContext: AudioContext | null;
  chart: RhythmChart;
  onComplete: (state: RhythmState, image: string | null) => void;
}) {
  const controllerRef = useRef<BaseJamRhythmController | null>(null);
  const [state, setState] = useState<RhythmState | null>(null);
  const [notice, setNotice] = useState(
    "A / D switch rails · J K L hit the three note columns",
  );
  const [muted, setMuted] = useState(false);
  const handleComplete = useCallback(
    (finished: RhythmState, image: string | null) => {
      onComplete(finished, image);
    },
    [onComplete],
  );
  const handleReady = useCallback(() => {
    setNotice("Follow the pulse · complete a phrase to capture its stem");
  }, []);
  const handleState = useCallback((next: RhythmState) => {
    setState(next);
  }, []);
  const handleFeedback = useCallback((message: string) => {
    setNotice(message);
  }, []);
  const handleMuted = useCallback((next: boolean) => {
    setMuted(next);
  }, []);

  const currentBar = state?.currentBar ?? 0;
  const elapsed = (state?.currentStep ?? 0) * RHYTHM_STEP_SECONDS;
  const remaining = Math.max(0, Math.ceil(chart.durationSeconds - elapsed));
  const accuracy = state ? rhythmAccuracy(state) : 0;
  const progress = Math.min(100, (elapsed / chart.durationSeconds) * 100);
  const activeStems = state
    ? state.capturedUntilBar.filter((until) => until > currentBar).length
    : 0;
  const bar = chart.bars[currentBar] ?? chart.bars[0];

  function hit(column: RhythmColumn) {
    controllerRef.current?.hit(column);
  }

  return (
    <main className="game-shell rhythm-game-shell">
      <Header mode="playing" />
      <section className="rhythm-game-layout">
        <aside className="rhythm-hud">
          <div className="rhythm-hud__block">
            <p className="eyebrow">Live mix / bar {currentBar + 1}</p>
            <h1>BASE #{numberLabel(bar.blockNumber)}</h1>
            <a href={bar.explorerUrl} rel="noreferrer" target="_blank">
              {shortHash(bar.blockHash)} ↗
            </a>
          </div>
          <dl>
            <div>
              <dt>Score</dt>
              <dd>{state?.score.toLocaleString() ?? "0"}</dd>
            </div>
            <div>
              <dt>Combo</dt>
              <dd>{state?.combo ?? 0}×</dd>
            </div>
            <div>
              <dt>Stems</dt>
              <dd>{activeStems}/4</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{accuracy}%</dd>
            </div>
          </dl>
          <div className="rhythm-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="rhythm-chain-state">
            <i className={chart.ranked ? "ranked" : ""} />
            {chart.ranked ? "Confirmed Base sequence" : "Practice sequence"}
          </p>
        </aside>

        <section className="rhythm-stage">
          <div className={`rhythm-clock ${remaining <= 5 ? "is-urgent" : ""}`}>
            <span>{remaining.toString().padStart(2, "0")}</span>
            <small>seconds</small>
          </div>
          <BaseJamRhythmBoard
            audioContext={audioContext}
            chart={chart}
            controllerRef={controllerRef}
            onComplete={handleComplete}
            onFeedback={handleFeedback}
            onMutedChange={handleMuted}
            onReady={handleReady}
            onStateChange={handleState}
          />
          <p className="rhythm-notice" aria-live="polite">
            {notice}
          </p>
        </section>

        <aside className="rhythm-lane-panel">
          <p className="eyebrow">Instrument rails</p>
          <div className="rhythm-lane-buttons">
            {RHYTHM_LANES.map((lane, index) => {
              const selected = (state?.selectedLane ?? 0) === lane.id;
              const active =
                (state?.capturedUntilBar[lane.id] ?? 0) > currentBar;
              return (
                <button
                  aria-pressed={selected}
                  className={`${selected ? "is-selected" : ""} ${active ? "is-active" : ""}`}
                  key={lane.id}
                  onClick={() => controllerRef.current?.selectLane(lane.id)}
                  style={{ "--lane-color": lane.color } as CSSProperties}
                  type="button"
                >
                  <small>0{index + 1}</small>
                  <strong>{lane.name}</strong>
                  <span>{active ? "LIVE" : selected ? "ARMED" : "OFF"}</span>
                </button>
              );
            })}
          </div>
          <button
            className="rhythm-mute"
            onClick={() => controllerRef.current?.toggleMuted()}
            type="button"
          >
            {muted ? "Sound off · unmute" : "Sound on · mute"}
            <kbd>M</kbd>
          </button>
        </aside>

        <div className="rhythm-control-dock" aria-label="Rhythm controls">
          <button
            aria-label="Previous instrument rail"
            onClick={() => controllerRef.current?.moveLane(-1)}
            type="button"
          >
            <b>←</b>
            <small>A</small>
          </button>
          {(["J", "K", "L"] as const).map((key, column) => (
            <button
              className="rhythm-hit-button"
              key={key}
              onPointerDown={(event) => {
                event.preventDefault();
                hit(column as RhythmColumn);
              }}
              type="button"
            >
              <b>{key}</b>
              <small>HIT {column + 1}</small>
            </button>
          ))}
          <button
            aria-label="Next instrument rail"
            onClick={() => controllerRef.current?.moveLane(1)}
            type="button"
          >
            <b>→</b>
            <small>D</small>
          </button>
        </div>
      </section>
    </main>
  );
}

function ResultReceipt({
  chart,
  state,
}: {
  chart: RhythmChart;
  state: RhythmState;
}) {
  const result = rhythmResult(state);
  const receiptNotes = chart.notes.filter((_, index) => index % 3 === 0);

  return (
    <div className="mix-receipt" aria-label="Your Base mix receipt">
      <div className="mix-receipt__top">
        <span>BASE JAM</span>
        <small>LIVE MIX / 8453</small>
      </div>
      <div className="mix-receipt__wave" aria-hidden>
        {receiptNotes.map((note) => {
          const judged = state.noteResults[note.id];
          return (
            <i
              className={judged === "perfect" || judged === "good" ? "is-hit" : ""}
              key={note.id}
              style={
                {
                  "--bar-height": `${20 + Math.round(note.velocity * 80)}%`,
                  "--bar-color": RHYTHM_LANES[note.lane].color,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="mix-receipt__blocks">
        {chart.bars.map((bar, index) => (
          <span key={`${bar.blockHash}-${index}`}>
            {index % 3 === 0 ? numberLabel(bar.blockNumber) : "•"}
          </span>
        ))}
      </div>
      <div className="mix-receipt__bottom">
        <strong>{result.accuracy}%</strong>
        <div>
          <span>{chart.bars.length} CONFIRMED BARS</span>
          <small>{state.captures} stem captures</small>
        </div>
        <b>{result.grade}</b>
      </div>
    </div>
  );
}

function ResultView({
  chart,
  onRetry,
  state,
}: {
  chart: RhythmChart;
  onRetry: () => void;
  state: RhythmState;
}) {
  const [shareState, setShareState] = useState("Share the mix");
  const result = rhythmResult(state);

  async function share() {
    const first = chart.bars[0]?.blockNumber;
    const last = chart.bars.at(-1)?.blockNumber;
    const text = `I scored ${state.score.toLocaleString()} on BASE JAM — ${result.accuracy}% timing across Base blocks ${first}–${last}.`;
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
          <p className="eyebrow">Set complete / 15 Base blocks</p>
          <h1>{result.grade === "F" ? "FIND THE PULSE." : "MIX SEALED."}</h1>
          <p>
            You brought {state.captures} stems into the session and held a
            {` ${state.maxCombo}×`} max combo. The chain supplied the chart;
            your timing made the mix.
          </p>
          <div className="result-stats rhythm-result-stats">
            <div>
              <span>Grade</span>
              <strong>{result.grade}</strong>
            </div>
            <div>
              <span>Accuracy</span>
              <strong>{result.accuracy}%</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{state.score.toLocaleString()}</strong>
            </div>
            <div>
              <span>Max combo</span>
              <strong>{state.maxCombo}×</strong>
            </div>
          </div>
          <div className="result-actions">
            <button className="button button--primary" onClick={share} type="button">
              {shareState}
              <b aria-hidden>↗</b>
            </button>
            <button className="button button--ink" onClick={onRetry} type="button">
              Run it back
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
  const [chart, setChart] = useState<RhythmChart | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [finishedState, setFinishedState] = useState<RhythmState | null>(null);
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
        forcedAudio === undefined ? armRhythmAudio() : forcedAudio;
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
        setChart(createRhythmChart(levels));
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
    const armedAudio = armRhythmAudio();
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

  const complete = useCallback((state: RhythmState) => {
    setFinishedState(state);
    setPhase("result");
    try {
      const best = Number(localStorage.getItem("base-jam-rhythm-best") ?? "0");
      if (state.score > best) {
        localStorage.setItem("base-jam-rhythm-best", String(state.score));
      }
    } catch {
      // Local storage is an enhancement; finishing the set never depends on it.
    }
  }, []);

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
        onRetry={() => void start()}
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

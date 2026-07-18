"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { WalletButton } from "@/components/WalletButton";
import {
  createReplay,
  currentPiece,
  packedPercentage,
  type GameReplay,
  type GameState,
  type Piece,
} from "@/game/simulation";
import {
  type LevelApiResponse,
  type LevelManifestV1,
  type ShareRunPayloadV1,
} from "@/lib/base/types";
import { levelToSimulationTransactions } from "@/lib/base/simulation";
import type { SqshGameController } from "@/phaser/createSqshGame";
import { SqshBoard } from "./SqshBoard";

type Phase = "home" | "loading" | "playing" | "result" | "error";

interface StartRunResponse {
  ticket: string;
  expiresAt: string;
  ranked: boolean;
}

interface FinishRunResponse {
  shareToken?: string;
  token?: string;
  result?: ShareRunPayloadV1;
  share?: ShareRunPayloadV1;
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

const RUN_SECONDS = 60;
const FALLBACK_BLOCK_HASH =
  "0x8f31a843fc6cd24af9e31f153b712bf3a4b95800997d580cc5f21f1c889ca07f";

function numberLabel(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("en-US").format(numeric)
    : value;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function pieceColor(piece: Piece, index: number) {
  const colors = ["#1456f0", "#ff5b45", "#b6d81d", "#181818", "#8f62d8"];
  return colors[
    (piece.source.inputBucket + piece.source.valueBucket + index) %
      colors.length
  ];
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
        ? "Base is busy. Give the press a few seconds."
        : "Could not load a Base block.",
    );
  }
  return response.json() as Promise<LevelApiResponse>;
}

function Header({ mode = "home" }: { mode?: Phase }) {
  return (
    <header className="site-header">
      <button
        aria-label="Return to SQSH home"
        className="brand"
        onClick={() => {
          if (mode !== "home") window.location.assign("/");
        }}
        type="button"
      >
        <Image alt="" height={38} src="/mark.svg" width={38} />
        <span>SQSH</span>
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
    <main className="home-shell">
      <Header />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            The daily block packing game
            <span> / Base 8453</span>
          </p>
          <h1>
            SQSH
            <br />
            THE BLOCK.
          </h1>
          <p className="hero-deck">
            Real Base transactions become one shared set of shapes. You get
            60 seconds and one undo to pack them tighter than everyone else.
          </p>
          <div className="hero-actions">
            <button
              className="button button--primary"
              disabled={loading}
              onClick={onPlay}
              type="button"
            >
              <span>
                {loading
                  ? "Loading Base…"
                  : challengeBlock
                    ? `Play challenge #${numberLabel(challengeBlock)}`
                    : "Play latest block"}
              </span>
              <b aria-hidden>↗</b>
            </button>
            <span className="no-wallet">No wallet required</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden>
          <Image
            alt=""
            fill
            priority
            sizes="(max-width: 800px) 92vw, 45vw"
            src="/art/sqsh-riso.png"
          />
          <div className="art-stamp">
            <span>{level ? numberLabel(level.source.number) : "BASE"}</span>
            <small>
              {level?.ranked ? "canonical block" : "practice ready"}
            </small>
          </div>
        </div>
      </section>

      <section className="live-strip" aria-live="polite">
        <div>
          <span>Now pressing</span>
          <strong>
            {level
              ? `Block ${numberLabel(level.source.number)}`
              : levelError
                ? "Cached practice block"
                : "Reading Base…"}
          </strong>
        </div>
        <div>
          <span>Transaction pieces</span>
          <strong>{level?.pieces.length ?? 24}</strong>
        </div>
        <div>
          <span>Rules</span>
          <strong>Same bag · same board</strong>
        </div>
        <a
          href={level?.source.explorerUrl ?? "https://basescan.org"}
          rel="noreferrer"
          target="_blank"
        >
          Inspect source ↗
        </a>
      </section>

      <section className="how">
        <div className="section-kicker">01 / How it works</div>
        <div className="steps">
          <article>
            <span>01</span>
            <h2>Read the block.</h2>
            <p>
              Gas, calldata, fees, and value shape each transaction tile. No
              invented level data is passed off as ranked.
            </p>
          </article>
          <article>
            <span>02</span>
            <h2>Pack it clean.</h2>
            <p>
              Move the ghost, rotate the shape, and press it into a 10×10
              block. Full lines and tight edges score more.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Seal your SQSH.</h2>
            <p>
              Your inputs are replayed by the server. Share the verified
              mosaic and challenge somebody on the exact same block.
            </p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <strong>SQSH / 8453</strong>
        <span>Built from Base block data. Game state is offchain by design.</span>
        <a href="https://base.org" rel="noreferrer" target="_blank">
          Base ↗
        </a>
      </footer>
    </main>
  );
}

function LoadingView({ message }: { message: string }) {
  return (
    <main className="stage-shell">
      <Header mode="loading" />
      <section className="loading-press">
        <div className="press-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Preparing the plate</p>
        <h1>{message}</h1>
        <p>Fetching one immutable Base block and cutting its transactions.</p>
      </section>
    </main>
  );
}

function GameView({
  level,
  onComplete,
  seconds,
}: {
  level: LevelManifestV1;
  onComplete: (state: GameState, image: string | null) => void;
  seconds: number;
}) {
  const controllerRef = useRef<SqshGameController | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [notice, setNotice] = useState(
    "Tap a cell to press · R rotates · Space places",
  );
  const transactions = useMemo(
    () => levelToSimulationTransactions(level),
    [level],
  );

  const handleComplete = useCallback(
    (finished: GameState) => {
      onComplete(finished, controllerRef.current?.capture() ?? null);
    },
    [onComplete],
  );
  const handleInvalid = useCallback((message: string) => {
    setNotice(message);
  }, []);
  const handleState = useCallback((nextState: GameState) => {
    setState(nextState);
    const piece = currentPiece(nextState);
    setNotice(
      piece
        ? `${piece.kind.replaceAll("_", " ")} · ${piece.cells.length} cells`
        : "Sealing your SQSH…",
    );
  }, []);

  useEffect(() => {
    if (seconds <= 0) {
      controllerRef.current?.finish();
    }
  }, [seconds]);

  const piece = state ? currentPiece(state) : null;
  const percent = state ? packedPercentage(state) : 0;
  const progress = state
    ? Math.round((state.cursor / Math.max(state.pieces.length, 1)) * 100)
    : 0;

  return (
    <main className="game-shell">
      <Header mode="playing" />
      <section className="game-layout">
        <aside className="game-brief">
          <p className="eyebrow">Live plate</p>
          <h1>Block {numberLabel(level.source.number)}</h1>
          <a
            href={level.source.explorerUrl}
            rel="noreferrer"
            target="_blank"
          >
            {shortHash(level.source.hash)} ↗
          </a>
          <dl>
            <div>
              <dt>Packed</dt>
              <dd>{percent}%</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{state?.score.total.toLocaleString() ?? "0"}</dd>
            </div>
            <div>
              <dt>Piece</dt>
              <dd>
                {state?.cursor ?? 0}/{state?.pieces.length ?? 24}
              </dd>
            </div>
          </dl>
          <div className="game-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="rank-state">
            <i className={level.ranked ? "ranked" : ""} />
            {level.ranked ? "Replay verified" : "Unranked practice"}
          </p>
        </aside>

        <div className="board-wrap">
          <div className={`timer ${seconds <= 10 ? "timer--urgent" : ""}`}>
            <span>{seconds.toString().padStart(2, "0")}</span>
            <small>seconds</small>
          </div>
          <SqshBoard
            blockHash={level.source.hash || FALLBACK_BLOCK_HASH}
            controllerRef={controllerRef}
            onComplete={handleComplete}
            onInvalid={handleInvalid}
            onStateChange={handleState}
            transactions={transactions}
          />
          <p className="game-notice" aria-live="polite">
            {notice}
          </p>
        </div>

        <aside className="piece-controls">
          <p className="eyebrow">In the press</p>
          <div className="piece-preview" aria-label="Current shape">
            {piece ? (
              <MiniPiece piece={piece} />
            ) : (
              <span className="piece-loading">Cutting…</span>
            )}
          </div>
          <button
            className="control-button control-button--rotate"
            onClick={() => controllerRef.current?.rotate()}
            type="button"
          >
            <span>Rotate</span>
            <kbd>R</kbd>
          </button>
          <button
            className="control-button"
            onClick={() => controllerRef.current?.place()}
            type="button"
          >
            <span>Press here</span>
            <kbd>Space</kbd>
          </button>
          <button
            className="control-button"
            disabled={!state?.undoAvailable || !state.undoCheckpoint}
            onClick={() => controllerRef.current?.undo()}
            type="button"
          >
            <span>Undo once</span>
            <kbd>Z</kbd>
          </button>
          <button
            className="control-button control-button--quiet"
            onClick={() => controllerRef.current?.spill()}
            type="button"
          >
            <span>Spill piece</span>
            <kbd>X</kbd>
          </button>
        </aside>
      </section>
    </main>
  );
}

function MiniPiece({ piece }: { piece: Piece }) {
  const maxX = Math.max(...piece.cells.map((cell) => cell.x)) + 1;
  const maxY = Math.max(...piece.cells.map((cell) => cell.y)) + 1;
  return (
    <div
      className="mini-piece"
      style={{
        gridTemplateColumns: `repeat(${maxX}, 1fr)`,
        gridTemplateRows: `repeat(${maxY}, 1fr)`,
      }}
    >
      {piece.cells.map((cell) => (
        <span
          key={`${cell.x}-${cell.y}`}
          style={{
            background: pieceColor(piece, 0),
            gridColumn: cell.x + 1,
            gridRow: cell.y + 1,
          }}
        />
      ))}
    </div>
  );
}

function ResultMosaic({ state }: { state: GameState }) {
  return (
    <div className="result-mosaic" aria-label="Your sealed transaction mosaic">
      {state.board.map((pieceId, index) => {
        const pieceIndex = state.pieces.findIndex(
          (candidate) => candidate.id === pieceId,
        );
        const piece = state.pieces[pieceIndex];
        return (
          <span
            key={index}
            style={{
              background:
                piece && pieceId ? pieceColor(piece, pieceIndex) : "transparent",
            }}
          />
        );
      })}
    </div>
  );
}

function ResultView({
  level,
  onRetry,
  shareToken,
  state,
  submitError,
  verifying,
}: {
  level: LevelManifestV1;
  onRetry: () => void;
  shareToken: string | null;
  state: GameState;
  submitError: string | null;
  verifying: boolean;
}) {
  const [shareState, setShareState] = useState("Challenge a friend");
  const percent = packedPercentage(state);
  const shareUrl = shareToken
    ? `${window.location.origin}/run/${shareToken}`
    : window.location.href;

  async function share() {
    const text = `I SQSH'd ${percent}% of Base block ${level.source.number}. Beat this plate.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My SQSH", text, url: shareUrl });
      } else {
        await navigator.clipboard.writeText(`${text} ${shareUrl}`);
      }
      setShareState("Challenge ready ✓");
    } catch {
      setShareState("Share cancelled");
    }
  }

  return (
    <main className="result-shell">
      <Header mode="result" />
      <section className="result-layout">
        <div className="result-copy">
          <p className="eyebrow">Plate sealed / Base {level.source.number}</p>
          <h1>
            {state.sealGrade === "F" ? "THE BLOCK SPILLED." : "THAT’LL PRESS."}
          </h1>
          <p>
            {state.sealGrade === "F"
              ? "Not enough blockspace made it onto the plate. The same bag is waiting."
              : `${percent}% packed with ${state.spilled.length} spill${state.spilled.length === 1 ? "" : "s"}. Your layout is now the challenge.`}
          </p>
          <div className="result-stats">
            <div>
              <span>Grade</span>
              <strong>{state.sealGrade}</strong>
            </div>
            <div>
              <span>Packed</span>
              <strong>{percent}%</strong>
            </div>
            <div>
              <span>Score</span>
              <strong>{state.score.total.toLocaleString()}</strong>
            </div>
          </div>
          <div className="result-actions">
            <button
              className="button button--primary"
              disabled={verifying}
              onClick={share}
              type="button"
            >
              {verifying ? "Verifying replay…" : shareState}
              <b aria-hidden>↗</b>
            </button>
            <button className="button button--ink" onClick={onRetry} type="button">
              SQSH again
            </button>
          </div>
          <p className="verification-state" aria-live="polite">
            {verifying
              ? "Replaying every input server-side…"
              : shareToken
                ? "✓ Verified replay · share score cannot be edited"
                : submitError ?? "Local result · share verification unavailable"}
          </p>
        </div>
        <div className="result-card">
          <div className="result-card__top">
            <span>SQSH</span>
            <small>BASE / 8453</small>
          </div>
          <ResultMosaic state={state} />
          <div className="result-card__bottom">
            <strong>{percent}%</strong>
            <div>
              <span>BLOCK {numberLabel(level.source.number)}</span>
              <small>{shortHash(level.source.hash)}</small>
            </div>
            <b>{state.sealGrade}</b>
          </div>
        </div>
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
        <h1>THE PRESS LOST BASE.</h1>
        <p>{message}</p>
        <div>
          <button className="button button--primary" onClick={onRetry} type="button">
            Retry Base
          </button>
          <button className="button button--ink" onClick={onPractice} type="button">
            Use practice plate
          </button>
        </div>
      </section>
    </main>
  );
}

export function SqshApp() {
  const [phase, setPhase] = useState<Phase>("home");
  const [level, setLevel] = useState<LevelManifestV1 | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(RUN_SECONDS);
  const [finishedState, setFinishedState] = useState<GameState | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState("Base did not answer in time.");
  const [requestedBlock, setRequestedBlock] = useState<string | null>(null);
  const startedAt = useRef(0);

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

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const issueTicket = useCallback(async (selected: LevelManifestV1) => {
    const response = await fetch("/api/runs/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        levelDigest: selected.digest,
        levelNumber: selected.source.number,
        levelHash: selected.source.hash,
        practice: !selected.ranked,
      }),
    });
    if (!response.ok) {
      throw new Error("The run verifier is not ready.");
    }
    return response.json() as Promise<StartRunResponse>;
  }, []);

  const start = useCallback(
    async (forcedLevel?: LevelManifestV1) => {
      setPhase("loading");
      setSubmitError(null);
      setShareToken(null);
      try {
        let selected = forcedLevel ?? level;
        if (!selected) {
          selected = (await loadLevel(requestedBlock)).level;
          setLevel(selected);
        }
        const run = await issueTicket(selected);
        setTicket(run.ticket);
        setSeconds(RUN_SECONDS);
        startedAt.current = Date.now();
        setPhase("playing");
      } catch (error) {
        setFatalError(
          error instanceof Error ? error.message : "Could not start the press.",
        );
        setPhase("error");
      }
    },
    [issueTicket, level, requestedBlock],
  );

  const complete = useCallback(
    (state: GameState) => {
      const elapsed = Math.max(1_000, Date.now() - startedAt.current);
      setDurationMs(elapsed);
      setFinishedState(state);
      setPhase("result");
      try {
        const best = Number(localStorage.getItem("sqsh-best") ?? "0");
        if (state.score.total > best) {
          localStorage.setItem("sqsh-best", String(state.score.total));
        }
      } catch {
        // Storage is an enhancement; the run remains valid without it.
      }
    },
    [],
  );

  useEffect(() => {
    if (phase !== "result" || !finishedState || !ticket || shareToken) return;
    const replay: GameReplay = createReplay(finishedState);
    setVerifying(true);
    void fetch("/api/runs/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket, durationMs, replay }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response
            .json()
            .catch(() => null)) as ApiErrorResponse | null;
          throw new Error(
            payload?.error?.message ?? "Replay verification failed.",
          );
        }
        return response.json() as Promise<FinishRunResponse>;
      })
      .then((payload) => {
        setShareToken(payload.shareToken ?? payload.token ?? null);
      })
      .catch((error: unknown) => {
        setSubmitError(
          error instanceof Error ? error.message : "Replay verification failed.",
        );
      })
      .finally(() => setVerifying(false));
  }, [durationMs, finishedState, phase, shareToken, ticket]);

  function practiceLevel(): LevelManifestV1 {
    const existing = level;
    if (existing) {
      return { ...existing, ranked: false, fallbackReason: "User chose practice." };
    }
    throw new Error("Practice manifest is still loading.");
  }

  if (phase === "loading") return <LoadingView message="CUTTING TRANSACTIONS." />;
  if (phase === "playing" && level) {
    return <GameView level={level} onComplete={complete} seconds={seconds} />;
  }
  if (phase === "result" && level && finishedState) {
    return (
      <ResultView
        level={level}
        onRetry={() => void start(level)}
        shareToken={shareToken}
        state={finishedState}
        submitError={submitError}
        verifying={verifying}
      />
    );
  }
  if (phase === "error") {
    return (
      <ErrorView
        message={fatalError}
        onPractice={() => {
          try {
            void start(practiceLevel());
          } catch {
            setPhase("home");
          }
        }}
        onRetry={() => {
          void levelQuery.refetch().then((result) => {
            if (result.data?.level) void start(result.data.level);
          });
        }}
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

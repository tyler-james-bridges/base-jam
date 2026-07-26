"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { BaseJamBlockCore } from "@/components/game/BaseJamBlockCore";
import { BaseJamFrequencyCameraRig } from "@/components/game/BaseJamFrequencyCameraRig";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
  frequencyRibbonForFace,
  frequencyRibbonRouteEase,
} from "@/components/game/BaseJamFrequencyGeometry";
import { BaseJamFrequencyPlayfield } from "@/components/game/BaseJamFrequencyPlayfield";
import { BaseJamSignalAtmosphere } from "@/components/game/BaseJamSignalAtmosphere";
import { BaseJamSignalTunnel } from "@/components/game/BaseJamSignalTunnel";
import { BaseJamStemRibbons } from "@/components/game/BaseJamStemRibbons";
import {
  PULSE_STEP_SECONDS,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  pulseHitWindowForCue,
  type PulseChart,
  type PulseRoute,
  type PulseState,
} from "@/game/pulse";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const BASE_JAM_SCENE_READY_TIMEOUT_MS = 5_000;

export type BaseJamSceneReadyMode = "rendered" | "fallback" | "timeout";
type BaseJamRendererSupport = "checking" | "supported" | "fallback";

function routeLabel(route: PulseRoute) {
  return route === -1 ? "LEFT" : route === 1 ? "RIGHT" : "TAP";
}

function feedbackTitle(message: string | null) {
  if (!message) return null;
  const normalized = message.trim().toUpperCase();
  if (normalized.startsWith("PERFECT")) return "PERFECT";
  if (normalized.startsWith("GOOD")) return "GOOD";
  if (normalized.startsWith("WRONG")) return "WRONG";
  if (
    normalized.startsWith("EARLY") ||
    normalized.startsWith("TOO EARLY")
  ) {
    return "EARLY";
  }
  if (
    normalized.startsWith("LATE") ||
    normalized.startsWith("A LITTLE LATE")
  ) {
    return "LATE";
  }
  if (
    normalized.startsWith("MISS") ||
    normalized.startsWith("BLOCK FLOWED")
  ) {
    return "MISS";
  }
  return null;
}

function phraseFeedbackTitle(message: string | null) {
  if (!message) return null;
  const match = message
    .trim()
    .toUpperCase()
    .match(/\b(BEAT|BASS|SYNTH|FX) LIVE\b/);
  return match?.[1] ? `${match[1]} ONLINE` : null;
}

function BaseJamFrequencyWorld({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  return (
    <>
      <color attach="background" args={["#020611"]} />
      <fog attach="fog" args={["#020611", 15, 38]} />
      <ambientLight intensity={0.065} />
      <hemisphereLight args={["#6f92e8", "#01030a", 0.22]} />
      <directionalLight
        color="#b8ccff"
        intensity={1.18}
        position={[-4, 7, 5]}
      />
      <pointLight
        color="#1456f0"
        decay={2}
        distance={14}
        intensity={6}
        position={[0, BASE_JAM_FREQUENCY_CENTER_Y, -18]}
      />

      <BaseJamFrequencyCameraRig
        activeFace={state.activeFace}
        hitCount={state.perfect + state.good}
        missCount={state.wrong + state.misses}
      >
        <BaseJamSignalAtmosphere state={state} />
        <BaseJamSignalTunnel
          currentStep={state.currentStep}
          layersUnlocked={state.layersUnlocked}
          sealed={state.sealed}
        />
        <BaseJamStemRibbons chart={chart} state={state} />
        <BaseJamBlockCore chart={chart} state={state} />
        <BaseJamFrequencyPlayfield chart={chart} state={state} />
      </BaseJamFrequencyCameraRig>
    </>
  );
}

function BaseJamRendererTelemetry({
  onRendered,
  stageRef,
}: {
  readonly onRendered: () => void;
  readonly stageRef: RefObject<HTMLDivElement | null>;
}) {
  const lastSampleAt = useRef(-1);
  const reportedFirstFrame = useRef(false);

  useFrame(({ gl }) => {
    if (!reportedFirstFrame.current && gl.info.render.calls > 0) {
      reportedFirstFrame.current = true;
      onRendered();
    }

    const now = performance.now();
    if (now - lastSampleAt.current < 1_000) return;
    lastSampleAt.current = now;

    const stage = stageRef.current;
    if (!stage) return;
    stage.dataset.drawCalls = String(gl.info.render.calls);
    stage.dataset.triangles = String(gl.info.render.triangles);
  });

  return null;
}

function writeStageData(
  stage: HTMLDivElement,
  key: keyof DOMStringMap,
  value: string,
) {
  if (stage.dataset[key] !== value) {
    stage.dataset[key] = value;
  }
}

function BaseJamRuntimeStageBridge({
  chart,
  fallback,
  stageRef,
}: {
  readonly chart: PulseChart;
  readonly fallback: {
    readonly deltaSeconds: number | null;
    readonly hitWindowSeconds: number;
    readonly ready: boolean;
    readonly route: PulseRoute;
    readonly soon: boolean;
    readonly targetFace: number;
  };
  readonly stageRef: RefObject<HTMLDivElement | null>;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();

  useFrame(() => {
    const stage = stageRef.current;
    const runtime = runtimeReader?.getSnapshot();
    if (!stage) return;

    const cue =
      runtime?.currentCueIndex === null ||
      runtime?.currentCueIndex === undefined
        ? undefined
        : chart.cues[runtime.currentCueIndex];
    const delta = runtime
      ? runtime.cueDeltaSeconds
      : fallback.deltaSeconds;
    const windowSeconds = runtime
      ? cue
        ? pulseHitWindowForCue(cue, runtime.state.tutorialStep)
        : 0
      : fallback.hitWindowSeconds;
    const ready = runtime
      ? runtime.phase === "playing" &&
        cue !== undefined &&
        runtime.cueDeltaSeconds !== null &&
        Math.abs(runtime.cueDeltaSeconds) <= windowSeconds
      : fallback.ready;
    const soon = runtime
      ? runtime.phase === "playing" &&
        runtime.cueDeltaSeconds !== null &&
        runtime.cueDeltaSeconds > windowSeconds &&
        runtime.cueDeltaSeconds <= 3.25
      : fallback.soon;
    const phase = ready ? "ready" : soon ? "soon" : "idle";
    const route =
      runtime?.expectedRoute === null
        ? "none"
        : routeLabel(runtime?.expectedRoute ?? fallback.route).toLowerCase();
    const targetFace = runtime?.targetFace ?? fallback.targetFace;
    const feedback = runtime?.lastFeedback;
    const feedbackAgeMs =
      feedback === undefined || feedback === null
        ? -1
        : Math.max(
            0,
            performance.now() - feedback.publishedAtPerformanceMs,
          );
    const routeSwitching =
      feedback !== undefined &&
      feedback !== null &&
      feedback.activeFace !== feedback.previousFace &&
      feedbackAgeMs < feedback.settleDurationMs;
    const rawRouteProgress = routeSwitching
      ? feedbackAgeMs / Math.max(1, feedback.settleDurationMs)
      : 1;
    const routeProgress = runtime?.reducedMotion
      ? 1
      : frequencyRibbonRouteEase(rawRouteProgress);
    const successfulPhrase =
      feedback?.phraseResult === "perfect" ||
      feedback?.phraseResult === "good";
    const successfulHit =
      feedback?.outcome === "perfect" || feedback?.outcome === "good";
    const rejected =
      feedback?.outcome === "wrong" || feedback?.outcome === "miss";
    const sceneState =
      successfulPhrase && feedbackAgeMs >= 0 && feedbackAgeMs < 1_500
        ? "phrase-seal"
        : rejected && feedbackAgeMs >= 0 && feedbackAgeMs < 460
          ? "reject"
          : routeSwitching
            ? "route-switch"
            : successfulHit && feedbackAgeMs >= 0 && feedbackAgeMs < 360
              ? "impact"
              : ready
                ? "ready"
                : soon
                  ? "anticipation"
                  : "idle";

    writeStageData(stage, "cueReady", ready ? "true" : "false");
    writeStageData(stage, "cuePhase", phase);
    writeStageData(stage, "cueRoute", route);
    writeStageData(stage, "targetFace", String(targetFace));
    writeStageData(
      stage,
      "activeRibbon",
      String(
        frequencyRibbonForFace(
          runtime?.state.activeFace ?? fallback.targetFace,
        ),
      ),
    );
    writeStageData(
      stage,
      "feedbackSequence",
      String(feedback?.sequence ?? 0),
    );
    writeStageData(
      stage,
      "feedbackAgeMs",
      String(Math.round(feedbackAgeMs)),
    );
    writeStageData(
      stage,
      "routeProgress",
      routeProgress.toFixed(3),
    );
    writeStageData(
      stage,
      "routeSettled",
      routeSwitching ? "false" : "true",
    );
    writeStageData(stage, "sceneState", sceneState);
    writeStageData(
      stage,
      "processorOpen",
      successfulPhrase && feedbackAgeMs >= 0 && feedbackAgeMs < 1_500
        ? "true"
        : "false",
    );
    writeStageData(
      stage,
      "visibleDecisions",
      String(runtime?.decisions.length ?? (cue ? 1 : 0)),
    );
    writeStageData(
      stage,
      "lastOutcome",
      feedback?.outcome ?? "none",
    );
    writeStageData(
      stage,
      "cueReadySource",
      runtime ? "runtime" : "react-fallback",
    );
    writeStageData(
      stage,
      "cueWindowMs",
      String(Math.floor(windowSeconds * 1_000)),
    );

    if (delta === null) {
      delete stage.dataset.cueDeltaMs;
    } else {
      writeStageData(
        stage,
        "cueDeltaMs",
        String(
          delta >= 0
            ? Math.ceil(delta * 1_000)
            : Math.floor(delta * 1_000),
        ),
      );
    }
  });

  return null;
}

export function BaseJamReactorStage({
  chart,
  correctionFeedback,
  onSceneReady,
  state,
}: {
  chart: PulseChart;
  correctionFeedback: string | null;
  onSceneReady?: (mode: BaseJamSceneReadyMode) => void;
  state: PulseState;
}) {
  const indexedCue = chart.cues[state.currentCue];
  const nextCue =
    indexedCue && !state.cueResults[indexedCue.id]
      ? indexedCue
      : chart.cues.find((candidate) => !state.cueResults[candidate.id]);
  const nextEvent = nextCue
    ? chart.events[nextCue.eventIndex]
    : chart.events[state.currentEvent] ?? chart.events[0];
  const expectedRoute = nextCue
    ? pulseExpectedRoute(nextCue, state)
    : 0;
  const expectedLabel = routeLabel(expectedRoute);
  const targetFace = pulseFaceAfterRoute(state.activeFace, expectedRoute);
  const phraseTitle = phraseFeedbackTitle(correctionFeedback);
  const correctionTitle = phraseTitle ?? feedbackTitle(correctionFeedback);
  const isPositiveFeedback =
    phraseTitle !== null ||
    correctionTitle === "PERFECT" ||
    correctionTitle === "GOOD";
  const isCorrectionFeedback =
    correctionTitle !== null && !isPositiveFeedback;
  const songTime = state.currentStep * PULSE_STEP_SECONDS;
  const nextDelta = nextCue ? nextCue.time - songTime : null;
  const hitWindow = nextCue
    ? pulseHitWindowForCue(nextCue, state.tutorialStep)
    : 0.5;
  // currentStep is quantized to an eighth note. Stop advertising NOW one
  // tick before the late edge so the visible promise always fits inside the
  // controller's higher-resolution scoring window.
  const visibleLateWindow = Math.max(
    0.08,
    hitWindow - PULSE_STEP_SECONDS,
  );
  const ready =
    nextDelta !== null &&
    nextDelta <= hitWindow &&
    nextDelta >= -visibleLateWindow;
  const soon =
    nextDelta !== null &&
    nextDelta > hitWindow &&
    nextDelta <= 3.25;
  const tutorialHint = [
    "TOUCH ANYWHERE AT THE LINE",
    "TOUCH AGAIN AT THE LINE",
    "SWIPE LEFT AT THE LINE",
    "SWIPE RIGHT AT THE LINE",
  ][state.tutorialStep];
  const correctionDetail =
    phraseTitle
      ? "BLOCK SEALED"
      : correctionTitle === "EARLY"
      ? "WAIT FOR THE LINE"
      : correctionTitle === "LATE"
        ? `NEXT ${expectedLabel}`
        : correctionTitle === "WRONG"
          ? `USE ${expectedLabel}`
          : correctionTitle === "MISS"
            ? `NEXT ${expectedLabel}`
            : correctionTitle === "PERFECT" ||
                correctionTitle === "GOOD"
              ? `${Math.abs(state.lastDeltaMs ?? 0)}MS`
              : null;
  const cueClass = phraseTitle
    ? "is-judged is-phrase"
    : correctionTitle
      ? `is-judged ${
          isPositiveFeedback ? "" : "is-correction"
        }`.trim()
    : ready
      ? "is-ready"
      : soon
        ? "is-soon"
        : "is-idle";
  const cueColor =
    BASE_JAM_FREQUENCY_LAYER_COLORS[nextEvent?.signalLayer ?? 1] ??
    "#b6d81d";
  const stageRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const sceneReadyRef = useRef(false);
  const [rendererSupport, setRendererSupport] =
    useState<BaseJamRendererSupport>("checking");
  const signalSceneReady = useCallback(
    (mode: BaseJamSceneReadyMode) => {
      if (sceneReadyRef.current) return;
      sceneReadyRef.current = true;
      onSceneReady?.(mode);
    },
    [onSceneReady],
  );
  const strongLabel =
    correctionTitle ??
    (ready ? expectedLabel : soon ? `NEXT: ${expectedLabel}` : "");
  const targetStyle: CSSProperties | undefined = isCorrectionFeedback
    ? {
        animation: "none",
        background: "rgba(3, 7, 20, 0.94)",
        border: "1px solid rgba(255, 115, 95, 0.86)",
        boxShadow: "0 0 0 2px rgba(2, 4, 12, 0.72), 0 10px 28px rgba(0, 0, 0, 0.58)",
        padding: "8px 12px 7px",
      }
    : phraseTitle
      ? {
          bottom: "auto",
          opacity: 0.88,
        }
    : soon && !ready
      ? { opacity: 0.68 }
      : undefined;

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !isCorrectionFeedback) return;
    const animation = target.animate(
      [
        { opacity: 1, transform: "translateX(-50%) scale(0.94)" },
        {
          opacity: 1,
          offset: 0.72,
          transform: "translateX(-50%) scale(1)",
        },
        { opacity: 0, transform: "translateX(-50%) scale(1)" },
      ],
      {
        duration: 560,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "forwards",
      },
    );
    return () => animation.cancel();
  }, [correctionTitle, isCorrectionFeedback]);

  useEffect(() => {
    const probe = document.createElement("canvas");
    let context: WebGL2RenderingContext | null = null;
    try {
      context = probe.getContext("webgl2", {
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      // A blocked or exhausted context is handled by the DOM command fallback.
    }
    if (!context) {
      setRendererSupport("fallback");
      signalSceneReady("fallback");
      return;
    }

    context.getExtension("WEBGL_lose_context")?.loseContext();
    setRendererSupport("supported");
  }, [signalSceneReady]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      signalSceneReady("timeout");
    }, BASE_JAM_SCENE_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [signalSceneReady]);

  return (
    <div
      className="base-jam-reactor-stage blockstream-stage"
      data-active-face={state.activeFace}
      data-camera-mode="first-person"
      data-draw-calls="0"
      data-impact={state.perfect + state.good}
      data-phrase-progress={nextCue?.phraseIndex ?? -1}
      data-triangles="0"
      ref={stageRef}
      style={{ "--stream-color": cueColor } as CSSProperties}
      aria-hidden
    >
      {rendererSupport === "supported" ? (
        <Canvas
          camera={{
            far: 60,
            fov: 58,
            near: 0.1,
            position: [0, BASE_JAM_FREQUENCY_CENTER_Y - 0.8, 8.1],
          }}
          dpr={[1, 1.25]}
          fallback={
            <span>
              3D renderer unavailable · rhythm commands remain playable
            </span>
          }
          frameloop="always"
          gl={{
            alpha: false,
            antialias: true,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
          }}
        >
          <BaseJamFrequencyWorld chart={chart} state={state} />
          <BaseJamRuntimeStageBridge
            chart={chart}
            fallback={{
              deltaSeconds: nextDelta,
              hitWindowSeconds: hitWindow,
              ready,
              route: expectedRoute,
              soon,
              targetFace,
            }}
            stageRef={stageRef}
          />
          <BaseJamRendererTelemetry
            onRendered={() => signalSceneReady("rendered")}
            stageRef={stageRef}
          />
        </Canvas>
      ) : (
        <div
          style={{
            alignItems: "center",
            background: "#020611",
            color: "rgba(230, 237, 255, 0.78)",
            display: "flex",
            fontFamily: "monospace",
            fontSize: 12,
            inset: 0,
            justifyContent: "center",
            letterSpacing: "0.08em",
            position: "absolute",
            textAlign: "center",
          }}
        >
          {rendererSupport === "fallback"
            ? "3D renderer unavailable · rhythm commands remain playable"
            : null}
        </div>
      )}
      <div className="blockstream-stage__vignette" />
      <div
        className={`blockstream-stage__target ${cueClass}`}
        key={`target-${state.currentCue}-${state.perfect}-${state.good}-${state.wrong}-${state.misses}-${state.activeFace}-${correctionTitle ?? "cue"}`}
        ref={targetRef}
        style={targetStyle}
      >
        <strong
          style={
            soon && !ready && correctionTitle === null
              ? { fontSize: "clamp(17px, 2vw, 28px)", opacity: 0.76 }
              : undefined
          }
        >
          {strongLabel}
        </strong>
        <span>
          {correctionDetail ??
            (ready
              ? tutorialHint
                ? `NOW · ${tutorialHint}`
                : "NOW · HIT THE LINE"
              : soon
                ? "GET READY"
                : "")}
        </span>
      </div>
      <style jsx>{`
        .blockstream-stage__target.is-phrase {
          top: clamp(92px, 12svh, 126px);
          bottom: auto;
          width: min(320px, calc(100vw - 36px));
          gap: 2px;
        }

        .blockstream-stage__target.is-phrase strong {
          font-size: clamp(18px, 2.15vw, 27px);
          letter-spacing: 0.035em;
        }

        .blockstream-stage__target.is-phrase span {
          font-size: 6px;
          letter-spacing: 0.12em;
        }

        .blockstream-stage__target.is-correction {
          opacity: 1 !important;
          min-width: 190px;
          padding: 10px 16px 9px !important;
          border: 2px solid rgba(255, 91, 69, 0.96) !important;
          background: rgba(13, 4, 12, 0.97) !important;
          box-shadow:
            0 0 0 2px rgba(2, 4, 12, 0.86),
            0 0 28px rgba(255, 91, 69, 0.3),
            0 12px 34px rgba(0, 0, 0, 0.72) !important;
          color: #ff806b !important;
          text-shadow: 0 0 14px rgba(255, 91, 69, 0.48) !important;
        }

        .blockstream-stage__target.is-correction strong {
          font-size: clamp(23px, 3vw, 34px);
          letter-spacing: 0.01em;
        }

        .blockstream-stage__target.is-correction span {
          color: rgba(255, 242, 236, 0.9) !important;
          font-size: 7px;
        }

        @media (max-width: 760px) {
          .blockstream-stage__target.is-phrase {
            top: clamp(150px, 20svh, 184px);
            width: min(250px, calc(100vw - 28px));
          }

          .blockstream-stage__target.is-phrase strong {
            font-size: clamp(16px, 5.2vw, 21px);
          }

          .blockstream-stage__target.is-correction {
            min-width: 176px;
            padding: 9px 14px 8px !important;
          }

          .blockstream-stage__target.is-correction strong {
            font-size: 25px;
          }
        }
      `}</style>
    </div>
  );
}

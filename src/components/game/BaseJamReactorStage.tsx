"use client";

import { Canvas } from "@react-three/fiber";
import type { CSSProperties } from "react";
import { BaseJamBlockCore } from "@/components/game/BaseJamBlockCore";
import { BaseJamFrequencyCameraRig } from "@/components/game/BaseJamFrequencyCameraRig";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
} from "@/components/game/BaseJamFrequencyGeometry";
import { BaseJamFrequencyPlayfield } from "@/components/game/BaseJamFrequencyPlayfield";
import { BaseJamSignalTunnel } from "@/components/game/BaseJamSignalTunnel";
import {
  PULSE_STEP_SECONDS,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  pulseHitWindowForCue,
  type PulseChart,
  type PulseRoute,
  type PulseState,
} from "@/game/pulse";

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
      <fog attach="fog" args={["#020611", 21, 37]} />
      <ambientLight intensity={0.22} />
      <hemisphereLight args={["#9bb7ff", "#020611", 0.48]} />
      <directionalLight
        color="#b9caff"
        intensity={1.15}
        position={[-3, 7, 6]}
      />

      <BaseJamFrequencyCameraRig
        activeFace={state.activeFace}
        sealed={state.sealed}
      >
        <BaseJamSignalTunnel
          layersUnlocked={state.layersUnlocked}
          sealed={state.sealed}
        />
        <BaseJamBlockCore chart={chart} state={state} />
        <BaseJamFrequencyPlayfield chart={chart} state={state} />
      </BaseJamFrequencyCameraRig>
    </>
  );
}

export function BaseJamReactorStage({
  chart,
  correctionFeedback,
  state,
}: {
  chart: PulseChart;
  correctionFeedback: string | null;
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
  const correctionTitle = feedbackTitle(correctionFeedback);
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
    correctionTitle === "EARLY"
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
  const cueClass = correctionTitle
    ? `is-judged ${
        correctionTitle === "PERFECT" || correctionTitle === "GOOD"
          ? ""
          : "is-correction"
      }`.trim()
    : ready
      ? "is-ready"
      : soon
        ? "is-soon"
        : "is-idle";
  const cueColor =
    BASE_JAM_FREQUENCY_LAYER_COLORS[nextEvent?.signalLayer ?? 1] ??
    "#b6d81d";

  return (
    <div
      className="base-jam-reactor-stage blockstream-stage"
      data-active-face={state.activeFace}
      data-cue-ready={ready ? "true" : "false"}
      data-cue-route={expectedLabel.toLowerCase()}
      data-impact={state.perfect + state.good}
      data-phrase-progress={nextCue?.phraseIndex ?? -1}
      data-target-face={targetFace}
      style={{ "--stream-color": cueColor } as CSSProperties}
      aria-hidden
    >
      <Canvas
        camera={{
          far: 60,
          fov: 58,
          near: 0.1,
          position: [0, BASE_JAM_FREQUENCY_CENTER_Y - 0.8, 8.1],
        }}
        dpr={[1, 1.25]}
        frameloop="always"
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        }}
      >
        <BaseJamFrequencyWorld chart={chart} state={state} />
      </Canvas>
      <div className="blockstream-stage__vignette" />
      <div
        className={`blockstream-stage__target ${cueClass}`}
        key={`target-${state.currentCue}-${state.perfect}-${state.good}-${state.wrong}-${state.misses}-${state.activeFace}-${correctionTitle ?? "cue"}`}
      >
        <strong>{correctionTitle ?? expectedLabel}</strong>
        <span>
          {correctionDetail ??
            (ready
              ? tutorialHint
                ? `NOW · ${tutorialHint}`
                : "NOW · HIT THE LINE"
              : soon
                ? tutorialHint ?? "GET READY"
                : "")}
        </span>
      </div>
    </div>
  );
}

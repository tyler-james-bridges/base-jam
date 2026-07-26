"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  createPulseState,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  type PulseRuntimeDecision,
  type PulseRuntimeSnapshot,
  type PulseState,
  type PulseTutorialStep,
} from "@/game/pulse";
import {
  createBaseJamPulseController,
  type BaseJamPulseController as RuntimePulseController,
  type BaseJamPulseGameInput,
} from "@/game/pulse/controller";
import {
  PulseRuntimeProvider,
  type PulseRuntimeReader,
} from "@/game/pulse/runtime-store";
import type { BaseJamPulseController as LegacyPulseController } from "@/phaser/createBaseJamPulseGame";
import {
  BaseJamReactorStage,
  type BaseJamSceneReadyMode,
} from "./BaseJamReactorStage";

interface BaseJamPulseBoardProps extends BaseJamPulseGameInput {
  readonly controllerRef: MutableRefObject<LegacyPulseController | null>;
  readonly feedback: string | null;
  readonly onComplete: (state: PulseState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
  readonly onSceneReady: (mode: BaseJamSceneReadyMode) => void;
  readonly onStateChange: (state: PulseState) => void;
}

export function BaseJamPulseBoard({
  audioContext,
  chart,
  controllerRef,
  feedback,
  onComplete,
  onFeedback,
  onMutedChange,
  onReady,
  onSceneReady,
  onStateChange,
}: BaseJamPulseBoardProps) {
  const runtimeControllerRef = useRef<RuntimePulseController | null>(null);
  const sceneReadyRef = useRef(false);
  const [visualState, setVisualState] = useState<PulseState>(() =>
    createPulseState(),
  );
  const visualStateRef = useRef(visualState);
  const [sceneReadyMode, setSceneReadyMode] =
    useState<BaseJamSceneReadyMode | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState(() => ({
    focused: true,
    phase: "idle" as PulseRuntimeSnapshot["phase"],
    reducedMotion: false,
  }));
  const handleStateChange = useCallback(
    (next: PulseState) => {
      visualStateRef.current = next;
      setVisualState(next);
      onStateChange(next);
    },
    [onStateChange],
  );
  const correctionFeedback =
    feedback &&
    /^(PERFECT|GOOD|WRONG|EARLY|LATE|MISS|PHRASE)\b/.test(feedback)
      ? feedback
      : null;
  const handleSceneReady = useCallback(
    (mode: BaseJamSceneReadyMode) => {
      if (sceneReadyRef.current) return;
      sceneReadyRef.current = true;
      setSceneReadyMode(mode);
      onSceneReady(mode);
    },
    [onSceneReady],
  );

  const runtimeReader = useMemo<PulseRuntimeReader>(
    () => ({
      getSnapshot: () => {
        const snapshot = runtimeControllerRef.current?.snapshot();
        if (snapshot) return snapshot;
        const state = visualStateRef.current;
        const currentCue = chart.cues.find(
          (cue) => state.cueResults[cue.id] === undefined,
        );
        const expectedRoute = currentCue
          ? pulseExpectedRoute(currentCue, state)
          : null;
        let targetFace = state.activeFace;
        const decisions: PulseRuntimeDecision[] = chart.cues
          .filter((cue) => state.cueResults[cue.id] === undefined)
          .slice(0, 3)
          .map((cue, index) => {
            const route = pulseExpectedRoute(
              cue,
              Math.min(
                4,
                state.tutorialStep + index,
              ) as PulseTutorialStep,
            );
            targetFace = pulseFaceAfterRoute(targetFace, route);
            return {
              cueId: cue.id,
              cueIndex: cue.index,
              timeSeconds: cue.time,
              deltaSeconds: cue.time,
              expectedRoute: route,
              targetFace,
              lane: cue.lane,
              energy: cue.energy,
            };
          });
        return {
          state,
          songTimeSeconds: 0,
          phase: "idle",
          pauseReason: null,
          focused: true,
          reducedMotion: false,
          muted: false,
          currentCueId: currentCue?.id ?? null,
          currentCueIndex: currentCue?.index ?? null,
          cueDeltaSeconds: currentCue?.time ?? null,
          expectedRoute,
          targetFace:
            expectedRoute === null
              ? state.activeFace
              : pulseFaceAfterRoute(state.activeFace, expectedRoute),
          decisions,
          lastFeedback: null,
        };
      },
    }),
    [chart],
  );

  useEffect(() => {
    const controller = createBaseJamPulseController(
      { audioContext, chart },
      {
        onComplete,
        onFeedback,
        onMutedChange,
        onReady,
        onRuntimeChange: (snapshot) => {
          setRuntimeStatus((current) => {
            if (
              current.focused === snapshot.focused &&
              current.phase === snapshot.phase &&
              current.reducedMotion === snapshot.reducedMotion
            ) {
              return current;
            }
            return {
              focused: snapshot.focused,
              phase: snapshot.phase,
              reducedMotion: snapshot.reducedMotion,
            };
          });
        },
        onStateChange: handleStateChange,
      },
    );
    runtimeControllerRef.current = controller;
    controllerRef.current = controller;

    return () => {
      controller.destroy();
      if (runtimeControllerRef.current === controller) {
        runtimeControllerRef.current = null;
      }
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    audioContext,
    chart,
    controllerRef,
    onComplete,
    onFeedback,
    handleStateChange,
    onMutedChange,
    onReady,
  ]);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const applyReducedMotion = () => {
      runtimeControllerRef.current?.setReducedMotion(reducedMotion.matches);
    };
    const applyFocus = () => {
      const visible = document.visibilityState !== "hidden";
      runtimeControllerRef.current?.setFocused(
        visible && document.hasFocus(),
        visible ? "focus" : "visibility",
      );
    };

    applyReducedMotion();
    applyFocus();
    reducedMotion.addEventListener?.("change", applyReducedMotion);
    window.addEventListener("blur", applyFocus);
    window.addEventListener("focus", applyFocus);
    document.addEventListener("visibilitychange", applyFocus);
    return () => {
      reducedMotion.removeEventListener?.("change", applyReducedMotion);
      window.removeEventListener("blur", applyFocus);
      window.removeEventListener("focus", applyFocus);
      document.removeEventListener("visibilitychange", applyFocus);
    };
  }, []);

  return (
    <div
      aria-label="Follow the center target. Tap to stay on this channel or flick sideways to switch."
      className="base-jam-pulse-canvas"
      data-active-face={visualState.activeFace}
      data-channel-captures={visualState.channelCaptures.join(",")}
      data-current-cue={visualState.currentCue}
      data-last-route={visualState.lastRoute ?? "none"}
      data-playback-phase={runtimeStatus.phase}
      data-reduced-motion={runtimeStatus.reducedMotion}
      data-runtime-focused={runtimeStatus.focused}
      data-scene-ready={sceneReadyMode !== null}
      data-scene-ready-mode={sceneReadyMode ?? "pending"}
      data-tutorial-step={visualState.tutorialStep}
      data-testid="base-jam-pulse"
      role="img"
    >
      <PulseRuntimeProvider reader={runtimeReader}>
        <BaseJamReactorStage
          chart={chart}
          correctionFeedback={correctionFeedback}
          onSceneReady={handleSceneReady}
          state={visualState}
        />
      </PulseRuntimeProvider>
    </div>
  );
}

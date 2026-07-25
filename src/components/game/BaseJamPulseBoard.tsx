"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createPulseState, type PulseState } from "@/game/pulse";
import type {
  BaseJamPulseController,
  BaseJamPulseGameInput,
} from "@/phaser/createBaseJamPulseGame";
import { BaseJamReactorStage } from "./BaseJamReactorStage";

interface BaseJamPulseBoardProps extends BaseJamPulseGameInput {
  readonly controllerRef: MutableRefObject<BaseJamPulseController | null>;
  readonly feedback: string | null;
  readonly onComplete: (state: PulseState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
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
  onStateChange,
}: BaseJamPulseBoardProps) {
  const phaserParentRef = useRef<HTMLDivElement>(null);
  const [visualState, setVisualState] = useState<PulseState>(() =>
    createPulseState(),
  );
  const handleStateChange = useCallback(
    (next: PulseState) => {
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

  useEffect(() => {
    if (!phaserParentRef.current) return;
    let disposed = false;

    void import("@/phaser/createBaseJamPulseGame").then(
      ({ createBaseJamPulseGame }) => {
        if (disposed || !phaserParentRef.current) return;
        controllerRef.current = createBaseJamPulseGame(
          phaserParentRef.current,
          { audioContext, chart },
          {
            onComplete,
            onFeedback,
            onMutedChange,
            onReady,
            onStateChange: handleStateChange,
          },
        );
      },
    );

    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
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

  return (
    <div
      aria-label="Follow the center target. Tap to stay on this channel or flick sideways to switch."
      className="base-jam-pulse-canvas"
      data-active-face={visualState.activeFace}
      data-channel-captures={visualState.channelCaptures.join(",")}
      data-current-cue={visualState.currentCue}
      data-last-route={visualState.lastRoute ?? "none"}
      data-tutorial-step={visualState.tutorialStep}
      data-testid="base-jam-pulse"
      role="img"
    >
      <BaseJamReactorStage
        chart={chart}
        correctionFeedback={correctionFeedback}
        state={visualState}
      />
      <div
        aria-hidden
        className="base-jam-phaser-runtime"
        ref={phaserParentRef}
      />
    </div>
  );
}

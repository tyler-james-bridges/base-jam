"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { RhythmState } from "@/game/rhythm";
import type {
  BaseJamRhythmController,
  BaseJamRhythmGameInput,
} from "@/phaser/createBaseJamRhythmGame";

interface BaseJamRhythmBoardProps extends BaseJamRhythmGameInput {
  readonly controllerRef: MutableRefObject<BaseJamRhythmController | null>;
  readonly onComplete: (state: RhythmState, image: string | null) => void;
  readonly onFeedback: (message: string) => void;
  readonly onMutedChange: (muted: boolean) => void;
  readonly onReady: () => void;
  readonly onStateChange: (state: RhythmState) => void;
}

export function BaseJamRhythmBoard({
  audioContext,
  chart,
  controllerRef,
  focusMode,
  onComplete,
  onFeedback,
  onMutedChange,
  onReady,
  onStateChange,
}: BaseJamRhythmBoardProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    let disposed = false;

    void import("@/phaser/createBaseJamRhythmGame").then(
      ({ createBaseJamRhythmGame }) => {
        if (disposed || !parentRef.current) return;
        controllerRef.current = createBaseJamRhythmGame(
          parentRef.current,
          { audioContext, chart, focusMode },
          {
            onComplete,
            onFeedback,
            onMutedChange,
            onReady,
            onStateChange,
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
    focusMode,
    onComplete,
    onFeedback,
    onMutedChange,
    onReady,
    onStateChange,
  ]);

  return (
    <div
      aria-label="BASE JAM four-rail rhythm stage"
      className="base-jam-rhythm-canvas"
      data-testid="base-jam-rhythm"
      ref={parentRef}
      role="application"
    />
  );
}

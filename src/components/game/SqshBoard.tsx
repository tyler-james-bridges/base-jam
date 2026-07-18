"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type {
  CompactTransactionFeatures,
  GameState,
} from "@/game/simulation";
import type { SqshGameController } from "@/phaser/createSqshGame";

interface SqshBoardProps {
  blockHash: string;
  controllerRef: MutableRefObject<SqshGameController | null>;
  onComplete: (state: GameState) => void;
  onInvalid: (message: string) => void;
  onStateChange: (state: GameState) => void;
  transactions: readonly CompactTransactionFeatures[];
}

export function SqshBoard({
  blockHash,
  controllerRef,
  onComplete,
  onInvalid,
  onStateChange,
  transactions,
}: SqshBoardProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    let disposed = false;

    void import("@/phaser/createSqshGame").then(({ createSqshGame }) => {
      if (disposed || !parentRef.current) return;
      controllerRef.current = createSqshGame(
        parentRef.current,
        { blockHash, transactions },
        {
          onComplete,
          onInvalidPlacement: onInvalid,
          onStateChange,
        },
      );
    });

    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [
    blockHash,
    controllerRef,
    onComplete,
    onInvalid,
    onStateChange,
    transactions,
  ]);

  return (
    <div
      aria-label="SQSH packing board"
      className="sqsh-canvas"
      data-testid="sqsh-board"
      ref={parentRef}
      role="application"
    />
  );
}

"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type {
  CompactTransactionFeatures,
  GameState,
} from "@/game/simulation";
import type { BaseJamGameController } from "@/phaser/createBaseJamGame";

interface BaseJamBoardProps {
  blockHash: string;
  controllerRef: MutableRefObject<BaseJamGameController | null>;
  onComplete: (state: GameState) => void;
  onInvalid: (message: string) => void;
  onStateChange: (state: GameState) => void;
  transactions: readonly CompactTransactionFeatures[];
}

export function BaseJamBoard({
  blockHash,
  controllerRef,
  onComplete,
  onInvalid,
  onStateChange,
  transactions,
}: BaseJamBoardProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    let disposed = false;

    void import("@/phaser/createBaseJamGame").then(({ createBaseJamGame }) => {
      if (disposed || !parentRef.current) return;
      controllerRef.current = createBaseJamGame(
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
      aria-label="BASE JAM packing board"
      className="base-jam-canvas"
      data-testid="base-jam-board"
      ref={parentRef}
      role="application"
    />
  );
}

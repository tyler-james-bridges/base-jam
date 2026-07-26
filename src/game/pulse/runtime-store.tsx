"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { PulseRuntimeSnapshot } from "./types";

/**
 * Stable imperative reader for animation loops. Calling getSnapshot does not
 * subscribe React or trigger a component render.
 */
export interface PulseRuntimeReader {
  readonly getSnapshot: () => PulseRuntimeSnapshot;
}

const PulseRuntimeContext = createContext<PulseRuntimeReader | null>(null);

export function PulseRuntimeProvider({
  children,
  reader,
}: {
  readonly children: ReactNode;
  readonly reader: PulseRuntimeReader;
}) {
  return (
    <PulseRuntimeContext.Provider value={reader}>
      {children}
    </PulseRuntimeContext.Provider>
  );
}

export function usePulseRuntimeReader(): PulseRuntimeReader {
  const reader = useContext(PulseRuntimeContext);
  if (!reader) {
    throw new Error(
      "usePulseRuntimeReader must be used inside BaseJamPulseBoard.",
    );
  }
  return reader;
}

/**
 * Scene components may render in Storybook/unit harnesses without the game
 * controller. In that case they can retain their deterministic prop fallback.
 */
export function useOptionalPulseRuntimeReader(): PulseRuntimeReader | null {
  return useContext(PulseRuntimeContext);
}

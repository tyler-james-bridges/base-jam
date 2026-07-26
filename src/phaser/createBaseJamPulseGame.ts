/**
 * Compatibility entry point for callers that still import the historical
 * Phaser controller path. The active runtime is renderer-free; React Three
 * Fiber owns the only visible animation loop.
 */
import {
  createBaseJamPulseController,
  type BaseJamPulseBridge,
  type BaseJamPulseController,
  type BaseJamPulseGameInput,
} from "@/game/pulse/controller";

export type {
  BaseJamPulseBridge,
  BaseJamPulseController,
  BaseJamPulseGameInput,
} from "@/game/pulse/controller";

/** @deprecated Import createBaseJamPulseController from game/pulse/controller. */
export function createBaseJamPulseGame(
  _parent: HTMLElement,
  input: BaseJamPulseGameInput,
  bridge: BaseJamPulseBridge,
): BaseJamPulseController {
  return createBaseJamPulseController(input, bridge);
}

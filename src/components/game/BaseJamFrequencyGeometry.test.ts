import { describe, expect, it } from "vitest";

import {
  BASE_JAM_FREQUENCY_CAPTURE_Z,
  BASE_JAM_FREQUENCY_FAR_Z,
  baseJamFrequencyResponsiveRibbonScale,
  baseJamFrequencyRoadShapeScale,
  setBaseJamFrequencyRoadFlowPose,
  type BaseJamFrequencyRoadFlowPose,
} from "./BaseJamFrequencyGeometry";

function createPose(): BaseJamFrequencyRoadFlowPose {
  return {
    elevation: Number.NaN,
    lateral: Number.NaN,
    pitch: Number.NaN,
    yaw: Number.NaN,
  };
}

describe("Base Jam frequency road flow", () => {
  it("is exactly flat at and beyond the processor and capture endpoints", () => {
    for (const z of [
      BASE_JAM_FREQUENCY_FAR_Z - 1,
      BASE_JAM_FREQUENCY_FAR_Z,
      BASE_JAM_FREQUENCY_CAPTURE_Z,
      BASE_JAM_FREQUENCY_CAPTURE_Z + 1,
    ]) {
      expect(setBaseJamFrequencyRoadFlowPose(createPose(), z)).toEqual({
        elevation: 0,
        lateral: 0,
        pitch: 0,
        yaw: 0,
      });
    }
  });

  it("scales the shared bend and crest without changing their phase", () => {
    const sampleZ =
      BASE_JAM_FREQUENCY_FAR_Z +
      (BASE_JAM_FREQUENCY_CAPTURE_Z - BASE_JAM_FREQUENCY_FAR_Z) *
        0.25;
    const phone = setBaseJamFrequencyRoadFlowPose(createPose(), sampleZ);
    const desktop = setBaseJamFrequencyRoadFlowPose(
      createPose(),
      sampleZ,
      1.6,
      1.6,
    );

    expect(desktop.lateral).toBeCloseTo(phone.lateral * 1.6, 8);
    expect(desktop.elevation).toBeCloseTo(phone.elevation * 1.6, 8);
    expect(Math.tan(desktop.yaw)).toBeCloseTo(
      Math.tan(phone.yaw) * 1.6,
      8,
    );
    expect(Math.tan(desktop.pitch)).toBeCloseTo(
      Math.tan(phone.pitch) * 1.6,
      8,
    );
  });

  it("uses the intended portrait, compact, and desktop shape factors", () => {
    expect(baseJamFrequencyRoadShapeScale(true, false)).toBe(1);
    expect(baseJamFrequencyRoadShapeScale(false, true)).toBe(1.35);
    expect(baseJamFrequencyRoadShapeScale(false, false)).toBe(1.6);
  });

  it("keeps the active desktop ribbon dominant without wide side wedges", () => {
    expect(baseJamFrequencyResponsiveRibbonScale(1, false, false)).toBe(
      2.9,
    );
    expect(
      baseJamFrequencyResponsiveRibbonScale(0.34, false, false),
    ).toBeCloseTo(0.34 * 0.68, 8);
    expect(baseJamFrequencyResponsiveRibbonScale(0.34, true, false)).toBe(
      0.34,
    );
  });
});

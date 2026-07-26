import * as THREE from "three";

export const BASE_JAM_FREQUENCY_FACE_COUNT = 8;
export const BASE_JAM_FREQUENCY_RIBBON_COUNT = 4;
export const BASE_JAM_FREQUENCY_SUBLANES = 3;
export const BASE_JAM_FREQUENCY_RADIUS = 5.2;
export const BASE_JAM_FREQUENCY_APOTHEM =
  BASE_JAM_FREQUENCY_RADIUS * Math.cos(Math.PI / 8);
export const BASE_JAM_FREQUENCY_FACE_WIDTH =
  BASE_JAM_FREQUENCY_RADIUS * 2 * Math.sin(Math.PI / 8);
export const BASE_JAM_FREQUENCY_CENTER_Y =
  BASE_JAM_FREQUENCY_APOTHEM - 1.38;
export const BASE_JAM_FREQUENCY_NEAR_Z = 3.5;
export const BASE_JAM_FREQUENCY_FAR_Z = -22.5;
export const BASE_JAM_FREQUENCY_LENGTH =
  BASE_JAM_FREQUENCY_NEAR_Z - BASE_JAM_FREQUENCY_FAR_Z;
export const BASE_JAM_FREQUENCY_CENTER_Z =
  (BASE_JAM_FREQUENCY_NEAR_Z + BASE_JAM_FREQUENCY_FAR_Z) / 2;
export const BASE_JAM_FREQUENCY_ENTRY_Z = -18;
export const BASE_JAM_FREQUENCY_CAPTURE_Z = -0.65;
export const BASE_JAM_FREQUENCY_FAN_SPREAD = 0.9;
const BASE_JAM_FREQUENCY_ROAD_LATERAL_AMPLITUDE = 0.42;
const BASE_JAM_FREQUENCY_ROAD_ELEVATION_AMPLITUDE = 0.42;
const BASE_JAM_FREQUENCY_ROAD_FLOW_SPAN =
  BASE_JAM_FREQUENCY_CAPTURE_Z - BASE_JAM_FREQUENCY_FAR_Z;

export interface BaseJamFrequencyRoadFlowPose {
  elevation: number;
  lateral: number;
  pitch: number;
  yaw: number;
}

const objectRoadFlowScratch: BaseJamFrequencyRoadFlowPose = {
  elevation: 0,
  lateral: 0,
  pitch: 0,
  yaw: 0,
};

export const BASE_JAM_FREQUENCY_LAYER_COLORS = [
  "#f4eedb",
  "#b6d81d",
  "#1456f0",
  "#8f62d8",
] as const;

/**
 * A single deterministic mid-track gesture shared by road art and cues.
 * The squared-sine envelope makes the pose and its slope exactly flat at
 * both the processor and capture endpoints.
 */
export function setBaseJamFrequencyRoadFlowPose(
  target: BaseJamFrequencyRoadFlowPose,
  z: number,
  lateralScale = 1,
  elevationScale = 1,
) {
  if (
    z <= BASE_JAM_FREQUENCY_FAR_Z ||
    z >= BASE_JAM_FREQUENCY_CAPTURE_Z
  ) {
    target.elevation = 0;
    target.lateral = 0;
    target.pitch = 0;
    target.yaw = 0;
    return target;
  }

  const progress =
    (z - BASE_JAM_FREQUENCY_FAR_Z) /
    BASE_JAM_FREQUENCY_ROAD_FLOW_SPAN;
  const halfPhase = progress * Math.PI;
  const fullPhase = halfPhase * 2;
  const sinHalf = Math.sin(halfPhase);
  const envelope = sinHalf * sinHalf;
  const envelopeDerivative = Math.PI * Math.sin(fullPhase);
  const lateral =
    BASE_JAM_FREQUENCY_ROAD_LATERAL_AMPLITUDE *
    envelope *
    Math.sin(fullPhase);
  const elevation =
    BASE_JAM_FREQUENCY_ROAD_ELEVATION_AMPLITUDE * envelope;
  const lateralDerivative =
    (BASE_JAM_FREQUENCY_ROAD_LATERAL_AMPLITUDE *
      (envelopeDerivative * Math.sin(fullPhase) +
        envelope * Math.PI * 2 * Math.cos(fullPhase))) /
    BASE_JAM_FREQUENCY_ROAD_FLOW_SPAN;
  const elevationDerivative =
    (BASE_JAM_FREQUENCY_ROAD_ELEVATION_AMPLITUDE *
      envelopeDerivative) /
    BASE_JAM_FREQUENCY_ROAD_FLOW_SPAN;

  target.elevation = elevation * elevationScale;
  target.lateral = lateral * lateralScale;
  target.pitch = -Math.atan(elevationDerivative * elevationScale);
  target.yaw = Math.atan(lateralDerivative * lateralScale);
  return target;
}

export function applyBaseJamFrequencyRoadFlow(
  target: THREE.Object3D,
  z: number,
  lateralScale = 1,
  elevationScale = 1,
) {
  const flow = setBaseJamFrequencyRoadFlowPose(
    objectRoadFlowScratch,
    z,
    lateralScale,
    elevationScale,
  );
  target.translateX(flow.lateral);
  target.translateY(flow.elevation);
  target.rotateY(flow.yaw);
  target.rotateX(flow.pitch);
}

export function normalizedFrequencyFace(face: number) {
  return (
    ((Math.trunc(face) % BASE_JAM_FREQUENCY_FACE_COUNT) +
      BASE_JAM_FREQUENCY_FACE_COUNT) %
    BASE_JAM_FREQUENCY_FACE_COUNT
  );
}

export function frequencyFaceAngle(face: number) {
  return (
    -Math.PI / 2 +
    normalizedFrequencyFace(face) *
      ((Math.PI * 2) / BASE_JAM_FREQUENCY_FACE_COUNT)
  );
}

export function frequencyRibbonForFace(face: number) {
  return normalizedFrequencyFace(face) % BASE_JAM_FREQUENCY_RIBBON_COUNT;
}

export function frequencyRibbonAngle(ribbon: number) {
  const normalized =
    ((Math.trunc(ribbon) % BASE_JAM_FREQUENCY_RIBBON_COUNT) +
      BASE_JAM_FREQUENCY_RIBBON_COUNT) %
    BASE_JAM_FREQUENCY_RIBBON_COUNT;
  return (
    -Math.PI / 2 +
    normalized * ((Math.PI * 2) / BASE_JAM_FREQUENCY_RIBBON_COUNT)
  );
}

export function frequencyRibbonRelativeSlot(
  ribbon: number,
  activeFace: number,
) {
  const activeRibbon = frequencyRibbonForFace(activeFace);
  const normalizedRibbon =
    ((Math.trunc(ribbon) % BASE_JAM_FREQUENCY_RIBBON_COUNT) +
      BASE_JAM_FREQUENCY_RIBBON_COUNT) %
    BASE_JAM_FREQUENCY_RIBBON_COUNT;
  const difference =
    (normalizedRibbon -
      activeRibbon +
      BASE_JAM_FREQUENCY_RIBBON_COUNT) %
    BASE_JAM_FREQUENCY_RIBBON_COUNT;

  if (difference === 0) return 0;
  if (difference === 1) return 1;
  if (difference === BASE_JAM_FREQUENCY_RIBBON_COUNT - 1) return -1;
  return 2;
}

export function frequencyRibbonFanAngle(
  ribbon: number,
  activeFace: number,
) {
  const slot = frequencyRibbonRelativeSlot(ribbon, activeFace);
  if (slot === 0) return -Math.PI / 2;
  if (slot === 1) {
    return -Math.PI / 2 + BASE_JAM_FREQUENCY_FAN_SPREAD;
  }
  if (slot === -1) {
    return -Math.PI / 2 - BASE_JAM_FREQUENCY_FAN_SPREAD;
  }
  return Math.PI / 2;
}

export function frequencyRibbonFanPose(
  ribbon: number,
  activeFace: number,
) {
  const angle = frequencyRibbonFanAngle(ribbon, activeFace);
  const slot = frequencyRibbonRelativeSlot(ribbon, activeFace);
  const slotInset = Math.abs(slot) === 1 ? 0.28 : slot === 2 ? -0.2 : 0;
  return {
    angle,
    radius: BASE_JAM_FREQUENCY_APOTHEM - slotInset,
    scaleX: slot === 0 ? 1 : Math.abs(slot) === 1 ? 0.34 : 0.22,
  } as const;
}

export function baseJamFrequencyResponsiveRibbonScale(
  scaleX: number,
  portrait: boolean,
  compactLandscape: boolean,
) {
  if (portrait) return scaleX;
  if (compactLandscape) return scaleX * 1.34;
  return scaleX > 0.9 ? 2.9 : scaleX * 0.68;
}

export function baseJamFrequencyRoadShapeScale(
  portrait: boolean,
  compactLandscape: boolean,
) {
  if (portrait) return 1;
  return compactLandscape ? 1.35 : 1.6;
}

export function frequencyRibbonRouteEase(progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  const normalized =
    (1 - Math.exp(-3.2188758248682006 * clamped)) / 0.96;
  return Math.max(0, Math.min(1, normalized));
}

export function frequencyRibbonFanTransitionScaleX(
  ribbon: number,
  previousFace: number,
  activeFace: number,
  progress: number,
) {
  const from = frequencyRibbonFanPose(ribbon, previousFace);
  const to = frequencyRibbonFanPose(ribbon, activeFace);
  return THREE.MathUtils.lerp(
    from.scaleX,
    to.scaleX,
    frequencyRibbonRouteEase(progress),
  );
}

function shortestFrequencyAngleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function frequencyFaceDistance(left: number, right: number) {
  const difference = Math.abs(
    normalizedFrequencyFace(left) - normalizedFrequencyFace(right),
  );
  return Math.min(
    difference,
    BASE_JAM_FREQUENCY_FACE_COUNT - difference,
  );
}

export function setFrequencyFaceTransform(
  target: THREE.Object3D,
  face: number,
  z: number,
  laneOffset = 0,
  radialInset = 0,
) {
  const angle = frequencyFaceAngle(face);
  const radius = BASE_JAM_FREQUENCY_APOTHEM - radialInset;
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const tangentX = -normalY;
  const tangentY = normalX;

  target.position.set(
    normalX * radius + tangentX * laneOffset,
    BASE_JAM_FREQUENCY_CENTER_Y +
      normalY * radius +
      tangentY * laneOffset,
    z,
  );
  target.rotation.set(0, 0, angle + Math.PI / 2);
}

export function setFrequencyRibbonTransform(
  target: THREE.Object3D,
  ribbon: number,
  z: number,
  laneOffset = 0,
  radialInset = 0,
) {
  const angle = frequencyRibbonAngle(ribbon);
  const radius = BASE_JAM_FREQUENCY_APOTHEM - radialInset;
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const tangentX = -normalY;
  const tangentY = normalX;

  target.position.set(
    normalX * radius + tangentX * laneOffset,
    BASE_JAM_FREQUENCY_CENTER_Y +
      normalY * radius +
      tangentY * laneOffset,
    z,
  );
  target.rotation.set(0, 0, angle + Math.PI / 2);
}

export function setFrequencyRibbonFanTransform(
  target: THREE.Object3D,
  ribbon: number,
  activeFace: number,
  z: number,
  laneOffset = 0,
  radialInset = 0,
) {
  const pose = frequencyRibbonFanPose(ribbon, activeFace);
  const angle = pose.angle;
  const radius = pose.radius - radialInset;
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const tangentX = -normalY;
  const tangentY = normalX;

  target.position.set(
    normalX * radius + tangentX * laneOffset,
    BASE_JAM_FREQUENCY_CENTER_Y +
      normalY * radius +
      tangentY * laneOffset,
    z,
  );
  target.rotation.set(0, 0, angle + Math.PI / 2);
}

export function setFrequencyRibbonFanTransitionTransform(
  target: THREE.Object3D,
  ribbon: number,
  previousFace: number,
  activeFace: number,
  progress: number,
  z: number,
  laneOffset = 0,
  radialInset = 0,
) {
  const from = frequencyRibbonFanPose(ribbon, previousFace);
  const to = frequencyRibbonFanPose(ribbon, activeFace);
  const eased = frequencyRibbonRouteEase(progress);
  const angle =
    from.angle +
    shortestFrequencyAngleDelta(from.angle, to.angle) * eased;
  const radius =
    THREE.MathUtils.lerp(from.radius, to.radius, eased) - radialInset;
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const tangentX = -normalY;
  const tangentY = normalX;

  target.position.set(
    normalX * radius + tangentX * laneOffset,
    BASE_JAM_FREQUENCY_CENTER_Y +
      normalY * radius +
      tangentY * laneOffset,
    z,
  );
  target.rotation.set(0, 0, angle + Math.PI / 2);
}

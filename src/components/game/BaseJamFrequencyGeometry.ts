import * as THREE from "three";

export const BASE_JAM_FREQUENCY_FACE_COUNT = 8;
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

export const BASE_JAM_FREQUENCY_LAYER_COLORS = [
  "#f4eedb",
  "#b6d81d",
  "#1456f0",
  "#8f62d8",
] as const;

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

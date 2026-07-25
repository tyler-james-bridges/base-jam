"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BASE_JAM_FREQUENCY_APOTHEM,
  BASE_JAM_FREQUENCY_CAPTURE_Z,
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_CENTER_Z,
  BASE_JAM_FREQUENCY_FACE_COUNT,
  BASE_JAM_FREQUENCY_FACE_WIDTH,
  BASE_JAM_FREQUENCY_LENGTH,
  frequencyFaceAngle,
  frequencyFaceDistance,
  normalizedFrequencyFace,
  setFrequencyFaceTransform,
} from "@/components/game/BaseJamFrequencyGeometry";
import {
  PULSE_STEP_SECONDS,
  pulseExpectedRoute,
  pulseFaceAfterRoute,
  pulseHitWindowForCue,
  type PulseChart,
  type PulseCue,
  type PulseRoute,
  type PulseState,
} from "@/game/pulse";

const TRACK_LOOK_AHEAD_SECONDS = 3.7;
const TRACK_EXIT_SECONDS = 0.48;
const HIT_PULSE_SECONDS = 0.62;
const SUBLANE_OFFSETS = [-1.02, 0, 1.02] as const;
const ACTIVE_TRACK = new THREE.Color("#0d2f68");
const ADJACENT_TRACK = new THREE.Color("#05132b");
const IDLE_TRACK = new THREE.Color("#030a16");

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function cuePosition(
  cue: PulseCue,
  songTime: number,
  lookAheadSeconds: number,
) {
  const delta = cue.time - songTime;
  const progress = clamp01(1 - delta / lookAheadSeconds);
  const passed = clamp01(-delta / TRACK_EXIT_SECONDS);
  return delta >= 0
    ? THREE.MathUtils.lerp(-18, BASE_JAM_FREQUENCY_CAPTURE_Z, progress)
    : THREE.MathUtils.lerp(
        BASE_JAM_FREQUENCY_CAPTURE_Z,
        BASE_JAM_FREQUENCY_CAPTURE_Z + 3.5,
        passed,
      );
}

function cueLaneOffset(
  cue: PulseCue,
  route: PulseRoute,
  portrait: boolean,
) {
  const offset = SUBLANE_OFFSETS[cue.lane];
  if (route === 0) return offset * (portrait ? 0.84 : 1);
  return offset * (portrait ? 0.2 : 0.58);
}

function createRouteGlyphGeometry(route: PulseRoute) {
  if (route === 0) {
    const geometry = new THREE.PlaneGeometry(0.44, 0.12);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  const direction = route < 0 ? -1 : 1;
  const shape = new THREE.Shape();
  const points = [
    [-0.28, -0.18],
    [0.02, -0.18],
    [0.29, 0],
    [0.02, 0.18],
    [-0.28, 0.18],
    [-0.08, 0],
  ] as const;

  shape.moveTo(points[0][0] * direction, points[0][1]);
  points.slice(1).forEach(([x, y]) => shape.lineTo(x * direction, y));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function routeIndex(route: PulseRoute) {
  return route + 1;
}

function applyTransform(
  object: THREE.Object3D | null,
  transform: THREE.Object3D,
) {
  if (!object) return;
  object.matrix.copy(transform.matrix);
  object.matrixWorldNeedsUpdate = true;
}

export function BaseJamFrequencyPlayfield({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  const faceDecks = useRef<THREE.InstancedMesh>(null);
  const activeRails = useRef<THREE.InstancedMesh>(null);
  const currentPacket = useRef<THREE.Group>(null);
  const previewPacket = useRef<THREE.Group>(null);
  const currentMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const currentGlowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const captureMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const previousHits = useRef(state.perfect + state.good);
  const impactAt = useRef(-1);
  const syncedAt = useRef(0);
  const syncedStep = useRef(state.currentStep);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const readyColor = useMemo(() => new THREE.Color("#b6d81d"), []);
  const cueColor = useMemo(() => new THREE.Color("#f4eedb"), []);
  const emissiveColor = useMemo(() => new THREE.Color("#2867ff"), []);
  const packetGeometry = useMemo(
    () => new RoundedBoxGeometry(0.82, 0.2, 1, 3, 0.08),
    [],
  );
  const glyphGeometries = useMemo(
    () =>
      ([-1, 0, 1] as const).map((route) =>
        createRouteGlyphGeometry(route),
      ),
    [],
  );
  const { height, width } = useThree((three) => three.size);
  const portrait = width / Math.max(1, height) < 0.75;
  const compactLandscape = !portrait && height < 520;
  const activeFace = normalizedFrequencyFace(state.activeFace);
  const activeFaceAngle = frequencyFaceAngle(activeFace);
  const activeCapturePosition = [
    Math.cos(activeFaceAngle) * (BASE_JAM_FREQUENCY_APOTHEM - 0.18),
    BASE_JAM_FREQUENCY_CENTER_Y +
      Math.sin(activeFaceAngle) *
        (BASE_JAM_FREQUENCY_APOTHEM - 0.18),
    BASE_JAM_FREQUENCY_CAPTURE_Z,
  ] as const;
  const lookAheadSeconds = portrait
    ? 2.85
    : compactLandscape
      ? 3.15
      : TRACK_LOOK_AHEAD_SECONDS;

  const indexedCue = chart.cues[state.currentCue];
  const nextCue =
    indexedCue && !state.cueResults[indexedCue.id]
      ? indexedCue
      : chart.cues.find((cue) => !state.cueResults[cue.id]);
  const nextCueIndex = nextCue
    ? chart.cues.findIndex((cue) => cue.id === nextCue.id)
    : -1;
  const previewCue =
    state.tutorialStep === 4 && nextCueIndex >= 0
      ? chart.cues
          .slice(nextCueIndex + 1)
          .find((cue) => !state.cueResults[cue.id])
      : undefined;
  const currentRoute = nextCue
    ? pulseExpectedRoute(nextCue, state)
    : 0;
  const previewRoute = previewCue
    ? pulseExpectedRoute(previewCue, state)
    : 0;

  useEffect(
    () => () => {
      packetGeometry.dispose();
      glyphGeometries.forEach((geometry) => geometry.dispose());
    },
    [glyphGeometries, packetGeometry],
  );

  useEffect(() => {
    syncedStep.current = state.currentStep;
    syncedAt.current = performance.now();
  }, [state.currentStep]);

  useEffect(() => {
    const hits = state.perfect + state.good;
    if (hits > previousHits.current) {
      impactAt.current = performance.now();
    }
    previousHits.current = hits;
  }, [state.good, state.perfect]);

  useLayoutEffect(() => {
    const decks = faceDecks.current;
    const rails = activeRails.current;
    if (!decks || !rails) return;

    for (let face = 0; face < BASE_JAM_FREQUENCY_FACE_COUNT; face += 1) {
      setFrequencyFaceTransform(
        transform,
        face,
        BASE_JAM_FREQUENCY_CENTER_Z,
      );
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      decks.setMatrixAt(face, transform.matrix);

      const distance = frequencyFaceDistance(face, activeFace);
      decks.setColorAt(
        face,
        distance === 0
          ? ACTIVE_TRACK
          : distance === 1
            ? ADJACENT_TRACK
            : IDLE_TRACK,
      );
    }

    for (let lane = 0; lane < SUBLANE_OFFSETS.length; lane += 1) {
      setFrequencyFaceTransform(
        transform,
        activeFace,
        BASE_JAM_FREQUENCY_CENTER_Z,
        SUBLANE_OFFSETS[lane],
        0.1,
      );
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      rails.setMatrixAt(lane, transform.matrix);
    }

    [decks, rails].forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    });
  }, [activeFace, transform]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now / 1_000;
    const interpolated =
      syncedStep.current * PULSE_STEP_SECONDS +
      Math.min(PULSE_STEP_SECONDS * 1.2, (now - syncedAt.current) / 1_000);
    const songTime = state.finished
      ? chart.durationSeconds
      : Math.min(chart.durationSeconds, interpolated);
    const liveIndexedCue = chart.cues[state.currentCue];
    const liveNextCue =
      liveIndexedCue && !state.cueResults[liveIndexedCue.id]
        ? liveIndexedCue
        : chart.cues.find((cue) => !state.cueResults[cue.id]);
    const liveNextIndex = liveNextCue
      ? chart.cues.findIndex((cue) => cue.id === liveNextCue.id)
      : -1;
    const livePreviewCue =
      state.tutorialStep === 4 && liveNextIndex >= 0
        ? chart.cues
            .slice(liveNextIndex + 1)
            .find((cue) => !state.cueResults[cue.id])
        : undefined;
    const liveRoute = liveNextCue
      ? pulseExpectedRoute(liveNextCue, state)
      : 0;
    const targetFace = liveNextCue
      ? pulseFaceAfterRoute(activeFace, liveRoute)
      : activeFace;
    const nextDelta = liveNextCue
      ? liveNextCue.time - songTime
      : Number.POSITIVE_INFINITY;
    const nextVisible =
      Boolean(liveNextCue) &&
      nextDelta <= lookAheadSeconds &&
      nextDelta >= -TRACK_EXIT_SECONDS;

    if (currentPacket.current) {
      currentPacket.current.visible = nextVisible;
      if (nextVisible && liveNextCue) {
        const hitWindow = pulseHitWindowForCue(
          liveNextCue,
          state.tutorialStep,
        );
        const readiness =
          1 - clamp01(Math.abs(nextDelta) / (hitWindow + 0.12));
        const pulse =
          1 + Math.sin(elapsed * 11) * 0.045 * readiness;
        setFrequencyFaceTransform(
          transform,
          targetFace,
          cuePosition(liveNextCue, songTime, lookAheadSeconds),
          cueLaneOffset(liveNextCue, liveRoute, portrait),
          0.39,
        );
        transform.scale.set(
          (portrait ? 1.34 : 1.22) * pulse,
          1,
          (0.72 + liveNextCue.energy * 0.5) * pulse,
        );
        transform.updateMatrix();
        applyTransform(currentPacket.current, transform);

        if (currentMaterial.current) {
          currentMaterial.current.color
            .copy(cueColor)
            .lerp(readyColor, readiness * 0.34);
          currentMaterial.current.emissive
            .copy(emissiveColor)
            .lerp(readyColor, readiness);
          currentMaterial.current.emissiveIntensity =
            0.82 + readiness * 1.35;
        }
        if (currentGlowMaterial.current) {
          currentGlowMaterial.current.opacity =
            0.12 + readiness * 0.24;
        }
      }
    }

    if (previewPacket.current) {
      const previewDelta = livePreviewCue
        ? livePreviewCue.time - songTime
        : Number.POSITIVE_INFINITY;
      const previewVisible =
        Boolean(livePreviewCue) &&
        previewDelta <= lookAheadSeconds &&
        previewDelta >= 0.12;
      previewPacket.current.visible = previewVisible;
      if (previewVisible && livePreviewCue) {
        const route = pulseExpectedRoute(livePreviewCue, state);
        const cumulativeFace = pulseFaceAfterRoute(targetFace, route);
        setFrequencyFaceTransform(
          transform,
          cumulativeFace,
          cuePosition(livePreviewCue, songTime, lookAheadSeconds),
          cueLaneOffset(livePreviewCue, route, portrait),
          0.37,
        );
        transform.scale.set(
          portrait ? 0.88 : 0.76,
          0.82,
          (0.64 + livePreviewCue.energy * 0.34) * 0.82,
        );
        transform.updateMatrix();
        applyTransform(previewPacket.current, transform);
      }
    }

    const nearestDelta = Math.abs(nextDelta);
    const hitWindow = liveNextCue
      ? pulseHitWindowForCue(liveNextCue, state.tutorialStep)
      : 0.5;
    const arrival = 1 - clamp01(nearestDelta / (hitWindow + 0.14));
    const impactAge =
      impactAt.current < 0 ? 2 : (now - impactAt.current) / 1_000;
    const impact =
      impactAge < HIT_PULSE_SECONDS
        ? Math.sin((impactAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;

    if (captureMaterial.current) {
      captureMaterial.current.opacity =
        0.12 + arrival * 0.18 + impact * 0.2;
    }
  });

  return (
    <group>
      <instancedMesh
        args={[undefined, undefined, BASE_JAM_FREQUENCY_FACE_COUNT]}
        ref={faceDecks}
      >
        <boxGeometry
          args={[
            BASE_JAM_FREQUENCY_FACE_WIDTH * 1.08,
            0.07,
            BASE_JAM_FREQUENCY_LENGTH,
          ]}
        />
        <meshBasicMaterial
          color="#ffffff"
          toneMapped={false}
          vertexColors
        />
      </instancedMesh>

      <instancedMesh args={[undefined, undefined, 3]} ref={activeRails}>
        <boxGeometry args={[0.035, 0.025, BASE_JAM_FREQUENCY_LENGTH]} />
        <meshBasicMaterial
          color="#3975ff"
          depthWrite={false}
          opacity={0.64}
          toneMapped={false}
          transparent
        />
      </instancedMesh>

      <group
        position={activeCapturePosition}
        renderOrder={10}
        rotation={[0, 0, activeFaceAngle + Math.PI / 2]}
      >
        <mesh>
          <boxGeometry
            args={[BASE_JAM_FREQUENCY_FACE_WIDTH * 0.98, 0.055, 0.11]}
          />
          <meshBasicMaterial
            color="#f4eedb"
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0.012, 0]}>
          <boxGeometry
            args={[BASE_JAM_FREQUENCY_FACE_WIDTH * 1.08, 0.12, 0.34]}
          />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#b6d81d"
            depthWrite={false}
            opacity={0.12}
            ref={captureMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[
              side * BASE_JAM_FREQUENCY_FACE_WIDTH * 0.5,
              0,
              0,
            ]}
          >
            <boxGeometry args={[0.055, 0.16, 0.46]} />
            <meshBasicMaterial
              color="#b6d81d"
              depthWrite={false}
              opacity={0.82}
              toneMapped={false}
              transparent
            />
          </mesh>
        ))}
      </group>

      <group
        matrixAutoUpdate={false}
        ref={currentPacket}
        renderOrder={7}
        visible={false}
      >
        <mesh>
          <primitive attach="geometry" object={packetGeometry} />
          <meshStandardMaterial
            color="#f4eedb"
            emissive="#2867ff"
            emissiveIntensity={0.82}
            metalness={0.18}
            ref={currentMaterial}
            roughness={0.42}
          />
        </mesh>
        <mesh scale={[1.14, 1.42, 1.12]}>
          <primitive attach="geometry" object={packetGeometry} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#3975ff"
            depthWrite={false}
            opacity={0.18}
            ref={currentGlowMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>
        <mesh
          geometry={glyphGeometries[routeIndex(currentRoute)]}
          position={[0, 0.135, 0]}
          renderOrder={8}
        >
          <meshBasicMaterial
            color="#08101f"
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      <group
        matrixAutoUpdate={false}
        ref={previewPacket}
        renderOrder={5}
        visible={false}
      >
        <mesh>
          <primitive attach="geometry" object={packetGeometry} />
          <meshBasicMaterial
            color="#3975ff"
            depthWrite={false}
            opacity={0.48}
            toneMapped={false}
            transparent
          />
        </mesh>
        <mesh
          geometry={glyphGeometries[routeIndex(previewRoute)]}
          position={[0, 0.135, 0]}
          renderOrder={6}
        >
          <meshBasicMaterial
            color="#d7e2ff"
            depthWrite={false}
            opacity={0.52}
            toneMapped={false}
            transparent
          />
        </mesh>
      </group>
    </group>
  );
}

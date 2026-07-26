"use client";

import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_CENTER_Z,
  BASE_JAM_FREQUENCY_FACE_WIDTH,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
  BASE_JAM_FREQUENCY_LENGTH,
  baseJamFrequencyRoadShapeScale,
  baseJamFrequencyResponsiveRibbonScale,
  frequencyRibbonFanPose,
  frequencyRibbonForFace,
  frequencyRibbonRouteEase,
  setBaseJamFrequencyRoadFlowPose,
  type BaseJamFrequencyRoadFlowPose,
} from "@/components/game/BaseJamFrequencyGeometry";
import {
  PULSE_LAYERS,
  PULSE_STEP_SECONDS,
  type PulseChart,
  type PulseLayer,
  type PulseState,
} from "@/game/pulse";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const SUBDIVISION_COUNT = 24;
const SUBDIVISION_SPACING =
  BASE_JAM_FREQUENCY_LENGTH / SUBDIVISION_COUNT;
const FLOW_RAIL_STATION_COUNT = 22;
const FLOW_RAILS_PER_STATION = 4;
const FLOW_RAIL_COUNT =
  FLOW_RAIL_STATION_COUNT * FLOW_RAILS_PER_STATION;
const FLOW_RAIL_SPACING =
  BASE_JAM_FREQUENCY_LENGTH / FLOW_RAIL_STATION_COUNT;
const ROAD_PLATE_COUNT = 20;
const ROAD_PLATE_SPACING =
  BASE_JAM_FREQUENCY_LENGTH / ROAD_PLATE_COUNT;
const FORWARD_SPEED = 4.25;
const PHRASE_HOLD_SECONDS = 1.5;
const HIT_PROPAGATION_SECONDS = 0.14;

interface RibbonLook {
  readonly deck: string;
  readonly emissive: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly width: number;
}

const RIBBON_LOOKS: readonly RibbonLook[] = [
  {
    deck: "#08151c",
    emissive: "#153b42",
    metalness: 0.68,
    roughness: 0.38,
    width: 1,
  },
  {
    deck: "#101c17",
    emissive: "#455b1c",
    metalness: 0.58,
    roughness: 0.4,
    width: 0.96,
  },
  {
    deck: "#091b42",
    emissive: "#123d9b",
    metalness: 0.7,
    roughness: 0.32,
    width: 1.02,
  },
  {
    deck: "#211238",
    emissive: "#57308f",
    metalness: 0.64,
    roughness: 0.36,
    width: 0.94,
  },
];

const ROAD_SIGNAL_COLORS = [
  "#34747d",
  "#b6d81d",
  "#3975ff",
  "#9c6cf0",
] as const;

function createSignalSurfaceTexture() {
  const width = 48;
  const height = 128;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const grain =
        (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const longitudinal = x === 5 || x === width - 6;
      const circuit =
        y % 24 === 0 &&
        ((x >= 8 && x <= 18) || (x >= 29 && x <= 39));
      const panelJoint = y % 32 === 0;
      const processorCellY = y % 32;
      const processorDx = Math.abs(x - width / 2);
      const processorDy = Math.abs(processorCellY - 16);
      const octagonalDistance =
        Math.max(processorDx, processorDy) +
        Math.min(processorDx, processorDy) * 0.42;
      const octagonalInlay =
        Math.abs(octagonalDistance - 9.5) < 1.05;
      const waveformY =
        16 +
        Math.round(
          Math.sin((x / width) * Math.PI * 2 + Math.floor(y / 32)) *
            3.5,
        );
      const waveformInlay =
        x >= 8 &&
        x <= width - 9 &&
        Math.abs(processorCellY - waveformY) <= 1;
      const hexData =
        (Math.abs((x + Math.floor(y / 8) * 3) % 18 - 9) === 4 &&
          y % 16 < 9) ||
        (y % 16 === 4 && x % 12 >= 3 && x % 12 <= 8);
      const value = longitudinal
        ? 238
        : waveformInlay
          ? 242
          : octagonalInlay
            ? 226
        : circuit
          ? 220
          : hexData
            ? 214
          : panelJoint
            ? 176
            : 176 + Math.floor(Math.abs(grain) * 42);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 0.72);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function ribbonTransform(layer: number, activeFace: number) {
  const pose = frequencyRibbonFanPose(layer, activeFace);
  return {
    angle: pose.angle,
    position: [
      Math.cos(pose.angle) * pose.radius,
      BASE_JAM_FREQUENCY_CENTER_Y +
        Math.sin(pose.angle) * pose.radius,
      BASE_JAM_FREQUENCY_CENTER_Z,
    ] as const,
    scaleX: pose.scaleX,
  };
}

function RibbonSubdivisionGeometry({
  layer,
}: {
  readonly layer: PulseLayer;
}) {
  if (layer === 0) {
    return (
      <boxGeometry
        args={[BASE_JAM_FREQUENCY_FACE_WIDTH * 0.78, 0.028, 0.07]}
      />
    );
  }
  if (layer === 1) {
    return <boxGeometry args={[0.22, 0.045, 0.76]} />;
  }
  if (layer === 2) {
    return (
      <boxGeometry
        args={[BASE_JAM_FREQUENCY_FACE_WIDTH * 0.62, 0.025, 0.055]}
      />
    );
  }
  return <octahedronGeometry args={[0.17, 0]} />;
}

export function BaseJamStemRibbons({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const ribbonGroups = useRef<Array<THREE.Group | null>>([]);
  const deckMaterials = useRef<Array<THREE.MeshPhysicalMaterial | null>>([]);
  const edgeMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
  const subdivisionMaterials = useRef<
    Array<THREE.MeshBasicMaterial | null>
  >([]);
  const subdivisions = useRef<Array<THREE.InstancedMesh | null>>([]);
  const flowRails = useRef<Array<THREE.InstancedMesh | null>>([]);
  const deckPlates = useRef<Array<THREE.InstancedMesh | null>>([]);
  const previousSealed = useRef(state.sealed);
  const phraseLayer = useRef<PulseLayer | null>(null);
  const phraseAt = useRef(-1);
  const lastSubdivisionUpdate = useRef(-1);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const roadFlowPose = useMemo<BaseJamFrequencyRoadFlowPose>(
    () => ({
      elevation: 0,
      lateral: 0,
      pitch: 0,
      yaw: 0,
    }),
    [],
  );
  const surfaceTexture = useMemo(() => createSignalSurfaceTexture(), []);
  const phraseHighlight = useMemo(() => new THREE.Color("#567fbe"), []);
  const beatRailColor = useMemo(() => new THREE.Color("#34747d"), []);
  const inactiveDeck = useMemo(() => new THREE.Color("#091326"), []);
  const inactiveSignal = useMemo(() => new THREE.Color("#102a4a"), []);
  const deckColorScratch = useMemo(() => new THREE.Color(), []);
  const railColorScratch = useMemo(() => new THREE.Color(), []);
  const { height, width: viewportWidth } = useThree((three) => three.size);
  const portrait = viewportWidth / Math.max(1, height) < 0.75;
  const compactLandscape = !portrait && height < 520;
  const roadShapeScale = baseJamFrequencyRoadShapeScale(
    portrait,
    compactLandscape,
  );

  useEffect(() => {
    if (state.sealed <= previousSealed.current) {
      previousSealed.current = state.sealed;
      return;
    }

    const successful = [...chart.events]
      .reverse()
      .find((event) => {
        const result = state.eventResults[event.id];
        return result === "perfect" || result === "good";
      });
    phraseLayer.current = successful?.signalLayer ?? null;
    phraseAt.current = performance.now();
    previousSealed.current = state.sealed;
  }, [chart.events, state.eventResults, state.sealed]);

  useEffect(() => () => surfaceTexture.dispose(), [surfaceTexture]);

  useLayoutEffect(() => {
    deckPlates.current.forEach((mesh) => {
      if (!mesh) return;
      for (let index = 0; index < ROAD_PLATE_COUNT; index += 1) {
        const z =
          -BASE_JAM_FREQUENCY_LENGTH / 2 +
          (index + 0.5) * ROAD_PLATE_SPACING;
        setBaseJamFrequencyRoadFlowPose(
          roadFlowPose,
          BASE_JAM_FREQUENCY_CENTER_Z + z,
          roadShapeScale,
          roadShapeScale,
        );
        transform.position.set(
          roadFlowPose.lateral,
          0.14 + roadFlowPose.elevation,
          z,
        );
        transform.rotation.set(
          roadFlowPose.pitch,
          roadFlowPose.yaw,
          0,
        );
        transform.scale.set(1, 1, 1.035);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [roadFlowPose, roadShapeScale, transform]);

  useFrame(() => {
    const now = performance.now();
    const runtime = runtimeReader?.getSnapshot();
    const liveState = runtime?.state ?? state;
    const activeLayer = frequencyRibbonForFace(liveState.activeFace);
    const songTime =
      runtime?.songTimeSeconds ??
      liveState.currentStep * PULSE_STEP_SECONDS;
    const phraseAge =
      phraseAt.current < 0
        ? Number.POSITIVE_INFINITY
        : (now - phraseAt.current) / 1_000;
    const feedback = runtime?.lastFeedback;
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const successfulHit =
      feedback?.outcome === "perfect" || feedback?.outcome === "good";
    const hitPulse =
      successfulHit && feedbackAge < HIT_PROPAGATION_SECONDS
        ? Math.sin(
            (feedbackAge / HIT_PROPAGATION_SECONDS) * Math.PI,
          )
        : 0;
    const hitLayer =
      feedback?.routedLayer ??
      (feedback ? frequencyRibbonForFace(feedback.activeFace) : -1);
    const settleSeconds =
      (feedback?.settleDurationMs ?? 150) / 1_000;
    const switching =
      feedback !== undefined &&
      feedback !== null &&
      feedback.activeFace !== feedback.previousFace &&
      feedbackAge < settleSeconds;
    const previousFace = switching
      ? feedback.previousFace
      : liveState.activeFace;
    const routeProgress = switching
      ? feedbackAge / Math.max(0.1, settleSeconds)
      : 1;
    const easedRouteProgress = runtime?.reducedMotion
      ? 1
      : frequencyRibbonRouteEase(routeProgress);
    const updateSubdivisions =
      lastSubdivisionUpdate.current < 0 ||
      now - lastSubdivisionUpdate.current >= 30;
    surfaceTexture.offset.y = runtime?.reducedMotion
      ? 0
      : (songTime * 0.34) % 1;
    surfaceTexture.offset.x = runtime?.reducedMotion
      ? 0
      : Math.sin(songTime * 0.52) * 0.035;

    PULSE_LAYERS.forEach((_layer, layerIndex) => {
      const active = layerIndex === activeLayer;
      const captured =
        (liveState.capturedUntilBar[layerIndex] ?? 0) >
        liveState.currentEvent;
      const fallbackPhraseBoost =
        phraseLayer.current === layerIndex &&
        phraseAge < PHRASE_HOLD_SECONDS
          ? 1 - phraseAge / PHRASE_HOLD_SECONDS
          : 0;
      const runtimePhraseBoost =
        feedback?.routedLayer === layerIndex &&
        (feedback.phraseResult === "perfect" ||
          feedback.phraseResult === "good") &&
        feedbackAge < PHRASE_HOLD_SECONDS
          ? 1 - feedbackAge / PHRASE_HOLD_SECONDS
          : 0;
      const phraseBoost = Math.max(
        fallbackPhraseBoost,
        runtimePhraseBoost,
      );
      const hitBoost = hitLayer === layerIndex ? hitPulse : 0;
      const beatLayer = layerIndex === 0;
      const rejectDim =
        feedback !== undefined &&
        feedback !== null &&
        (feedback.outcome === "wrong" ||
          feedback.outcome === "miss") &&
        feedbackAge < 0.46 &&
        frequencyRibbonForFace(feedback.activeFace) === layerIndex;
      const deck = deckMaterials.current[layerIndex];
      const edge = edgeMaterials.current[layerIndex];
      const subdivisionMaterial =
        subdivisionMaterials.current[layerIndex];

      if (deck) {
        const look = RIBBON_LOOKS[layerIndex];
        const inactiveBlend = captured ? 0.58 : 0.38;
        deck.color
          .copy(inactiveDeck)
          .lerp(
            deckColorScratch.set(look?.deck ?? "#08152c"),
            active ? 1 : inactiveBlend,
          );
        deck.emissive
          .copy(inactiveSignal)
          .lerp(
            deckColorScratch.set(
              ROAD_SIGNAL_COLORS[layerIndex],
            ),
            active
              ? beatLayer
                ? 0.24
                : 0.28
              : captured
                ? 0.3
                : 0.14,
          );
        deck.emissiveIntensity = rejectDim
          ? 0.08
          : Math.min(
              0.62,
              0.12 +
                (active ? 0.24 : 0) +
                (captured ? 0.06 : 0) +
                phraseBoost * 0.12 +
                hitBoost * 0.18,
            );
        deck.metalness = Math.min(
          0.84,
          (look?.metalness ?? 0.3) +
            (captured ? 0.1 : 0) +
            phraseBoost * 0.12,
        );
        deck.roughness = Math.max(
          0.26,
          (look?.roughness ?? 0.6) -
            (captured ? 0.08 : 0) -
            phraseBoost * 0.12,
        );
      }
      if (edge) {
        edge.opacity =
          (rejectDim
            ? 0.08
            : 0.13 +
              (active ? (beatLayer ? 0.32 : 0.66) : 0) +
              (captured ? 0.12 : 0.04)) +
          phraseBoost * (beatLayer ? 0.12 : 0.22) +
          hitBoost * (beatLayer ? 0.16 : 0.3);
      }
      if (subdivisionMaterial) {
        subdivisionMaterial.opacity =
          (rejectDim
            ? 0.055
            : 0.045 +
              (active ? (beatLayer ? 0.14 : 0.48) : 0) +
              (captured ? 0.07 : 0)) +
          phraseBoost * (beatLayer ? 0.06 : 0.26) +
          hitBoost * (beatLayer ? 0.08 : 0.34);
        subdivisionMaterial.color
          .copy(
            beatLayer
              ? beatRailColor
              : deckColorScratch.set(
                  ROAD_SIGNAL_COLORS[layerIndex],
                ),
          )
          .lerp(
            phraseHighlight,
            phraseBoost * (beatLayer ? 0.1 : 0.28),
          );
      }

      const group = ribbonGroups.current[layerIndex];
      if (group) {
        const from = frequencyRibbonFanPose(layerIndex, previousFace);
        const to = frequencyRibbonFanPose(
          layerIndex,
          liveState.activeFace,
        );
        const angle =
          from.angle +
          Math.atan2(
            Math.sin(to.angle - from.angle),
            Math.cos(to.angle - from.angle),
          ) *
            easedRouteProgress;
        const radius = THREE.MathUtils.lerp(
          from.radius,
          to.radius,
          easedRouteProgress,
        );
        group.position.set(
          Math.cos(angle) * radius,
          BASE_JAM_FREQUENCY_CENTER_Y + Math.sin(angle) * radius,
          BASE_JAM_FREQUENCY_CENTER_Z,
        );
        group.rotation.z = angle + Math.PI / 2;
        group.scale.x = THREE.MathUtils.lerp(
          baseJamFrequencyResponsiveRibbonScale(
            from.scaleX,
            portrait,
            compactLandscape,
          ),
          baseJamFrequencyResponsiveRibbonScale(
            to.scaleX,
            portrait,
            compactLandscape,
          ),
          easedRouteProgress,
        );
      }

      const mesh = subdivisions.current[layerIndex];
      const railMesh = flowRails.current[layerIndex];
      if ((!mesh && !railMesh) || !updateSubdivisions) return;
      for (let index = 0; index < SUBDIVISION_COUNT; index += 1) {
        const movingTime = runtime?.reducedMotion ? 0 : songTime;
        const normalized =
          (((index * SUBDIVISION_SPACING +
            movingTime * FORWARD_SPEED * (1 + phraseBoost * 0.7)) %
            BASE_JAM_FREQUENCY_LENGTH) +
            BASE_JAM_FREQUENCY_LENGTH) %
          BASE_JAM_FREQUENCY_LENGTH;
        const z =
          -BASE_JAM_FREQUENCY_LENGTH / 2 + normalized;
        const major = index % 4 === 0;
        const alternating = index % 2 === 0 ? -1 : 1;
        const baseOffset =
          layerIndex === 1
            ? alternating * (major ? 0.74 : 1.08)
            : layerIndex === 3
              ? alternating * (major ? 0.52 : 1.18)
              : 0;
        const flowOffset =
          active && !runtime?.reducedMotion
            ? Math.sin(z * 0.52 + songTime * 1.28) *
              (major ? 0.085 : 0.055)
            : 0;
        setBaseJamFrequencyRoadFlowPose(
          roadFlowPose,
          BASE_JAM_FREQUENCY_CENTER_Z + z,
          roadShapeScale,
          roadShapeScale,
        );

        transform.position.set(
          baseOffset + flowOffset + roadFlowPose.lateral,
          0.2 + roadFlowPose.elevation,
          z,
        );
        transform.rotation.set(
          roadFlowPose.pitch,
          roadFlowPose.yaw +
            (layerIndex === 2
              ? alternating * 0.19
              : layerIndex === 3
                ? Math.PI / 4
                : 0),
          0,
        );
        transform.scale.set(
          layerIndex === 0
            ? major
              ? 1
              : 0.62
            : layerIndex === 1
              ? major
                ? 1.28
                : 0.72
              : major
                ? 1
                : 0.66,
          layerIndex === 3 ? 0.48 : 1,
          major ? 1.16 : 0.72,
        );
        transform.updateMatrix();
        mesh?.setMatrixAt(index, transform.matrix);
      }
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
      }

      if (railMesh) {
        const ribbonWidth =
          BASE_JAM_FREQUENCY_FACE_WIDTH *
          (RIBBON_LOOKS[layerIndex]?.width ?? 1);
        const hitProgress =
          layerIndex === hitLayer &&
          successfulHit &&
          feedbackAge < HIT_PROPAGATION_SECONDS
            ? feedbackAge / HIT_PROPAGATION_SECONDS
            : -1;
        const hitWaveZ =
          BASE_JAM_FREQUENCY_LENGTH * 0.34 -
          Math.max(0, hitProgress) * BASE_JAM_FREQUENCY_LENGTH;
        const phraseWaveZ =
          BASE_JAM_FREQUENCY_LENGTH * 0.4 -
          (1 - phraseBoost) * BASE_JAM_FREQUENCY_LENGTH;
        const signalColor =
          ROAD_SIGNAL_COLORS[layerIndex] ?? "#62e6ff";
        for (
          let station = 0;
          station < FLOW_RAIL_STATION_COUNT;
          station += 1
        ) {
          const movingTime = runtime?.reducedMotion ? 0 : songTime;
          const normalized =
            (((station * FLOW_RAIL_SPACING +
              movingTime * FORWARD_SPEED * 0.68) %
              BASE_JAM_FREQUENCY_LENGTH) +
              BASE_JAM_FREQUENCY_LENGTH) %
            BASE_JAM_FREQUENCY_LENGTH;
          const z = -BASE_JAM_FREQUENCY_LENGTH / 2 + normalized;
          const railShimmer =
            Math.sin(z * 0.38 + songTime * 0.72 + layerIndex * 0.8) *
            (active ? 0.028 : 0.014);
          setBaseJamFrequencyRoadFlowPose(
            roadFlowPose,
            BASE_JAM_FREQUENCY_CENTER_Z + z,
            roadShapeScale,
            roadShapeScale,
          );
          const idleBand =
            0.5 +
            0.5 *
              Math.sin(
                station * 0.88 -
                  songTime * 4.4 +
                  layerIndex * 0.72,
              );
          const processorRing = station % 8 === 0 ? 1 : 0;
          const processorWave =
            0.5 +
            0.5 *
              Math.sin(station * 0.82 + layerIndex * Math.PI * 0.5);
          const hitArrival =
            hitProgress < 0
              ? 0
              : THREE.MathUtils.smoothstep(hitProgress, 0.64, 1);
          const hitEnvelope =
            hitProgress < 0
              ? 0
              : Math.min(
                  1,
                  1 - hitProgress + hitArrival * 0.72,
                );
          const hitWave =
            hitProgress < 0
              ? 0
              : Math.max(0, 1 - Math.abs(z - hitWaveZ) / 2.1) *
                hitEnvelope;
          const phraseWave =
            phraseBoost <= 0
              ? 0
              : Math.max(0, 1 - Math.abs(z - phraseWaveZ) / 3.2) *
                phraseBoost;

          for (
            let rail = 0;
            rail < FLOW_RAILS_PER_STATION;
            rail += 1
          ) {
            const index = station * FLOW_RAILS_PER_STATION + rail;
            const outer = rail < 2;
            const side = rail % 2 === 0 ? -1 : 1;
            const x =
              side *
                (outer
                  ? ribbonWidth / 2 - 0.055
                  : Math.max(0.24, ribbonWidth * 0.17)) +
              roadFlowPose.lateral +
              railShimmer * (outer ? 1 : 0.58);
            transform.position.set(
              x,
              0.205 +
                roadFlowPose.elevation +
                hitWave * 0.038 +
                phraseWave * 0.025,
              z,
            );
            transform.rotation.set(
              roadFlowPose.pitch,
              roadFlowPose.yaw -
                railShimmer * side * (outer ? 0.25 : 0.14),
              0,
            );
            transform.scale.set(
              outer
                ? 1 + processorRing * 0.18
                : 0.48 + processorWave * 0.12,
              1 +
                processorRing * 0.24 +
                hitWave * 0.86 +
                phraseWave * 0.42,
              0.82 + idleBand * 0.18 + hitWave * 0.46,
            );
            transform.updateMatrix();
            railMesh.setMatrixAt(index, transform.matrix);
            railColorScratch
              .set(signalColor)
              .multiplyScalar(
                0.24 +
                  (active ? 0.22 : 0.04) +
                  idleBand * (active ? 0.28 : 0.1) +
                  processorRing * 0.16 +
                  processorWave * 0.05 +
                  hitWave * 1.05 +
                  phraseWave * 0.72,
              );
            railMesh.setColorAt(index, railColorScratch);
          }
        }
        railMesh.instanceMatrix.needsUpdate = true;
        if (railMesh.instanceColor) {
          railMesh.instanceColor.needsUpdate = true;
        }
      }
    });
    if (updateSubdivisions) {
      lastSubdivisionUpdate.current = now;
    }
  });

  return (
    <group>
      {PULSE_LAYERS.map((layer, layerIndex) => {
        const look = RIBBON_LOOKS[layerIndex];
        const { angle, position, scaleX } = ribbonTransform(
          layerIndex,
          state.activeFace,
        );
        const width =
          BASE_JAM_FREQUENCY_FACE_WIDTH *
          (look?.width ?? 1);
        const color =
          BASE_JAM_FREQUENCY_LAYER_COLORS[layerIndex];
        return (
          <group
            key={layer.id}
            position={position}
            ref={(group) => {
              ribbonGroups.current[layerIndex] = group;
            }}
            rotation={[0, 0, angle + Math.PI / 2]}
            scale={[
              baseJamFrequencyResponsiveRibbonScale(
                scaleX,
                portrait,
                compactLandscape,
              ),
              1,
              1,
            ]}
          >
            <instancedMesh
              args={[undefined, undefined, ROAD_PLATE_COUNT]}
              frustumCulled={false}
              ref={(mesh) => {
                deckPlates.current[layerIndex] = mesh;
              }}
            >
              <boxGeometry
                args={[
                  width - 0.18,
                  0.11,
                  ROAD_PLATE_SPACING * 1.04,
                ]}
              />
              <meshPhysicalMaterial
                clearcoat={0.16}
                clearcoatRoughness={0.5}
                color={look?.deck ?? "#08152c"}
                emissive={look?.emissive ?? color}
                emissiveMap={surfaceTexture}
                emissiveIntensity={0.5}
                map={surfaceTexture}
                metalness={look?.metalness ?? 0.3}
                ref={(material) => {
                  deckMaterials.current[layerIndex] = material;
                }}
                roughness={look?.roughness ?? 0.6}
              />
            </instancedMesh>

            <instancedMesh
              args={[undefined, undefined, FLOW_RAIL_COUNT]}
              ref={(mesh) => {
                flowRails.current[layerIndex] = mesh;
              }}
              frustumCulled={false}
            >
              <boxGeometry
                args={[0.085, 0.05, FLOW_RAIL_SPACING * 0.76]}
              />
              <meshBasicMaterial
                blending={THREE.AdditiveBlending}
                color="#ffffff"
                depthWrite={false}
                opacity={0.42}
                ref={(material) => {
                  edgeMaterials.current[layerIndex] = material;
                }}
                toneMapped={false}
                transparent
                vertexColors
              />
            </instancedMesh>

            <instancedMesh
              args={[undefined, undefined, SUBDIVISION_COUNT]}
              frustumCulled={false}
              ref={(mesh) => {
                subdivisions.current[layerIndex] = mesh;
              }}
              renderOrder={1}
            >
              <RibbonSubdivisionGeometry layer={layer.id} />
              <meshBasicMaterial
                blending={THREE.AdditiveBlending}
                color={color}
                depthWrite={false}
                opacity={0.24}
                ref={(material) => {
                  subdivisionMaterials.current[layerIndex] = material;
                }}
                toneMapped={false}
                transparent
              />
            </instancedMesh>
          </group>
        );
      })}
    </group>
  );
}

"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_APOTHEM,
  BASE_JAM_FREQUENCY_CAPTURE_Z,
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_ENTRY_Z,
  BASE_JAM_FREQUENCY_FACE_WIDTH,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
  applyBaseJamFrequencyRoadFlow,
  baseJamFrequencyRoadShapeScale,
  baseJamFrequencyResponsiveRibbonScale,
  frequencyRibbonFanTransitionScaleX,
  frequencyRibbonForFace,
  setFrequencyRibbonFanTransitionTransform,
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
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const TRACK_LOOK_AHEAD_SECONDS = 3.8;
const TRACK_EXIT_SECONDS = 0.5;
const HIT_PULSE_SECONDS = 0.54;
const ERROR_PULSE_SECONDS = 0.42;
const CAPTURE_BURST_SECONDS = 0.22;
const BURST_COUNT = 8;
const TRAIL_COUNT = 3;
const PACKET_OUTER_HALF_WIDTH = 0.84 * 0.5 * 1.08;
const PACKET_OUTER_HALF_HEIGHT = 0.68 * 0.5 * 1.08;
const PACKET_SAFE_MARGIN_PX = 8;
const SUBLANE_OFFSETS = [-1.02, 0, 1.02] as const;
const ERROR_COLOR = new THREE.Color("#ff5b45");
const READY_COLOR = new THREE.Color("#f4eedb");
const CURRENT_CYAN = new THREE.Color("#66e8ff");
const HIT_SIGNAL_COLORS = [
  "#62e6ff",
  "#c7ed22",
  "#3975ff",
  "#9c6cf0",
] as const;
const PREVIEW_LAYER_COLORS = [
  "#41413d",
  "#3b4630",
  "#30415a",
  "#433650",
] as const;

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
  const eased = 1 - Math.pow(1 - progress, 1.52);
  const passed = clamp01(-delta / TRACK_EXIT_SECONDS);

  return delta >= 0
    ? THREE.MathUtils.lerp(
        BASE_JAM_FREQUENCY_ENTRY_Z,
        BASE_JAM_FREQUENCY_CAPTURE_Z,
        eased,
      )
    : THREE.MathUtils.lerp(
        BASE_JAM_FREQUENCY_CAPTURE_Z,
        BASE_JAM_FREQUENCY_CAPTURE_Z + 3.8,
        passed,
      );
}

function cueLaneOffset(
  cue: PulseCue,
  _route: PulseRoute,
  portrait: boolean,
) {
  const offset = SUBLANE_OFFSETS[cue.lane];
  // Horizontal lane is not player-controllable in the one-thumb ruleset.
  // Preserve only a tiny sequencing offset; the packet silhouette and its
  // destination ribbon communicate TAP / LEFT / RIGHT.
  return offset * (portrait ? 0.035 : 0.05);
}

function routeIndex(route: PulseRoute) {
  return route + 1;
}

function createPacketGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.28, -0.3);
  shape.lineTo(0.28, -0.3);
  shape.lineTo(0.38, -0.2);
  shape.lineTo(0.38, 0.2);
  shape.lineTo(0.28, 0.3);
  shape.lineTo(-0.28, 0.3);
  shape.lineTo(-0.38, 0.2);
  shape.lineTo(-0.38, -0.2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.04,
    bevelThickness: 0.032,
    curveSegments: 1,
    depth: 0.12,
    steps: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function applyTransform(
  object: THREE.Object3D | null,
  transform: THREE.Object3D,
) {
  if (!object) return;
  object.matrix.copy(transform.matrix);
  object.matrixWorldNeedsUpdate = true;
}

function commitStaticInstances(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

export function BaseJamFrequencyPlayfield({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const currentPacket = useRef<THREE.Group>(null);
  const previewPackets = useRef<Array<THREE.Group | null>>([]);
  const decisionLine = useRef<THREE.LineSegments>(null);
  const captureGroup = useRef<THREE.Group>(null);
  const packetTrail = useRef<THREE.InstancedMesh>(null);
  const burstParticles = useRef<THREE.InstancedMesh>(null);
  const currentMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const currentGlowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const currentEdgeMaterial = useRef<THREE.LineBasicMaterial>(null);
  const currentDataCells = useRef<THREE.InstancedMesh>(null);
  const currentDataCellMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const trailMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const gateCoreMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const gateGlowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const burstMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const contactSpark = useRef<THREE.Mesh>(null);
  const contactSparkMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const hitWave = useRef<THREE.Mesh>(null);
  const hitWaveMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const previousHits = useRef(state.perfect + state.good);
  const previousErrors = useRef(state.wrong + state.misses);
  const impactAt = useRef(-1);
  const errorAt = useRef(-1);
  const syncedAt = useRef(0);
  const syncedStep = useRef(state.currentStep);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const localTransform = useMemo(() => new THREE.Object3D(), []);
  const layerColorScratch = useMemo(() => new THREE.Color(), []);
  const gateColorScratch = useMemo(() => new THREE.Color(), []);
  const hitColorScratch = useMemo(() => new THREE.Color(), []);
  const dataCellColorScratch = useMemo(() => new THREE.Color(), []);
  const trailNeutral = useMemo(() => new THREE.Color("#4b5361"), []);
  const packetWorldCenter = useMemo(() => new THREE.Vector3(), []);
  const packetNdcCenter = useMemo(() => new THREE.Vector3(), []);
  const packetNdcEdge = useMemo(() => new THREE.Vector3(), []);
  const decisionLinkPositions = useMemo(() => new Float32Array(12), []);
  const decisionLinkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(
      decisionLinkPositions,
      3,
    );
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute);
    geometry.setDrawRange(0, 0);
    return geometry;
  }, [decisionLinkPositions]);
  const packetGeometry = useMemo(() => createPacketGeometry(), []);
  const packetEdges = useMemo(
    () => new THREE.EdgesGeometry(packetGeometry, 22),
    [packetGeometry],
  );
  const camera = useThree((three) => three.camera);
  const gl = useThree((three) => three.gl);
  const { height, width } = useThree((three) => three.size);
  const portrait = width / Math.max(1, height) < 0.75;
  const compactLandscape = !portrait && height < 520;
  const roadShapeScale = baseJamFrequencyRoadShapeScale(
    portrait,
    compactLandscape,
  );
  const activeRibbonAngle = -Math.PI / 2;
  const activeCapturePosition = [
    0,
    BASE_JAM_FREQUENCY_CENTER_Y +
      Math.sin(activeRibbonAngle) *
        (BASE_JAM_FREQUENCY_APOTHEM - 0.18),
    BASE_JAM_FREQUENCY_CAPTURE_Z,
  ] as const;
  const lookAheadSeconds = portrait
    ? 2.95
    : compactLandscape
      ? 3.25
      : TRACK_LOOK_AHEAD_SECONDS;
  const indexedCue = chart.cues[state.currentCue];
  const nextCue =
    indexedCue && !state.cueResults[indexedCue.id]
      ? indexedCue
      : chart.cues.find((cue) => !state.cueResults[cue.id]);
  const nextCueIndex = nextCue
    ? chart.cues.findIndex((cue) => cue.id === nextCue.id)
    : -1;
  const previewCues =
    nextCueIndex >= 0
      ? chart.cues
          .slice(nextCueIndex + 1)
          .filter((cue) => !state.cueResults[cue.id])
          .slice(0, 2)
      : [];
  const currentRoute = nextCue
    ? pulseExpectedRoute(nextCue, state)
    : 0;
  const currentLayer =
    chart.events[nextCue?.eventIndex ?? state.currentEvent]?.signalLayer ?? 1;
  const previewLayers = previewCues.map(
    (cue) =>
      chart.events[cue.eventIndex]?.signalLayer ?? currentLayer,
  );
  const currentLayerColor =
    BASE_JAM_FREQUENCY_LAYER_COLORS[currentLayer];

  useEffect(
    () => () => {
      packetGeometry.dispose();
      packetEdges.dispose();
      decisionLinkGeometry.dispose();
    },
    [decisionLinkGeometry, packetEdges, packetGeometry],
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

  useEffect(() => {
    const errors = state.wrong + state.misses;
    if (errors > previousErrors.current) {
      errorAt.current = performance.now();
    }
    previousErrors.current = errors;
  }, [state.misses, state.wrong]);

  useLayoutEffect(() => {
    const trail = packetTrail.current;
    if (trail) {
      for (let index = 0; index < TRAIL_COUNT; index += 1) {
        localTransform.position.set(
          0,
          -0.018,
          0.44 + index * 0.34,
        );
        localTransform.rotation.set(0, 0, 0);
        localTransform.scale.set(
          Math.max(0.2, 0.42 - index * 0.08),
          Math.max(0.12, 0.2 - index * 0.035),
          Math.max(0.16, 0.28 - index * 0.05),
        );
        localTransform.updateMatrix();
        trail.setMatrixAt(index, localTransform.matrix);
      }
      commitStaticInstances(trail);
    }

    const cells = currentDataCells.current;
    if (!cells) return;
    for (let index = 0; index < 3; index += 1) {
      const selected = index === routeIndex(currentRoute);
      localTransform.position.set(
        (index - 1) * 0.22,
        0,
        0.085,
      );
      localTransform.rotation.set(0, 0, 0);
      localTransform.scale.set(selected ? 1.18 : 0.78, 1, 1);
      localTransform.updateMatrix();
      cells.setMatrixAt(index, localTransform.matrix);
      dataCellColorScratch.set(
        selected ? "#66e8ff" : "#174956",
      );
      cells.setColorAt(index, dataCellColorScratch);
    }
    commitStaticInstances(cells);
  }, [currentRoute, dataCellColorScratch, localTransform]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now / 1_000;
    const runtime = runtimeReader?.getSnapshot();
    const liveState = runtime?.state ?? state;
    const interpolated =
      syncedStep.current * PULSE_STEP_SECONDS +
      Math.min(
        PULSE_STEP_SECONDS * 1.2,
        (now - syncedAt.current) / 1_000,
      );
    const songTime = runtime
      ? runtime.songTimeSeconds
      : state.finished
      ? chart.durationSeconds
      : Math.min(chart.durationSeconds, interpolated);
    const runtimeCurrentDecision = runtime?.decisions[0];
    const liveIndexedCue =
      runtimeCurrentDecision !== undefined
        ? chart.cues[runtimeCurrentDecision.cueIndex]
        : chart.cues[liveState.currentCue];
    const liveNextCue =
      liveIndexedCue && !liveState.cueResults[liveIndexedCue.id]
        ? liveIndexedCue
        : chart.cues.find((cue) => !liveState.cueResults[cue.id]);
    const liveNextIndex = liveNextCue
      ? chart.cues.findIndex((cue) => cue.id === liveNextCue.id)
      : -1;
    const livePreviewCues =
      runtime && runtime.decisions.length > 1
        ? runtime.decisions
            .slice(1, 3)
            .map((decision) => chart.cues[decision.cueIndex])
            .filter((cue): cue is PulseCue => cue !== undefined)
        : liveNextIndex >= 0
        ? chart.cues
            .slice(liveNextIndex + 1)
            .filter((cue) => !liveState.cueResults[cue.id])
            .slice(0, 2)
        : [];
    const liveRoute = liveNextCue
      ? runtimeCurrentDecision?.expectedRoute ??
        pulseExpectedRoute(liveNextCue, liveState)
      : 0;
    const targetFace = liveNextCue
      ? runtimeCurrentDecision?.targetFace ??
        pulseFaceAfterRoute(liveState.activeFace, liveRoute)
      : liveState.activeFace;
    const currentOffLane =
      frequencyRibbonForFace(targetFace) !==
      frequencyRibbonForFace(liveState.activeFace);
    const nextDelta = liveNextCue
      ? runtimeCurrentDecision?.deltaSeconds ??
        liveNextCue.time - songTime
      : Number.POSITIVE_INFINITY;
    const nextVisible =
      Boolean(liveNextCue) &&
      nextDelta <= lookAheadSeconds &&
      nextDelta >= -TRACK_EXIT_SECONDS;
    const liveEvent = liveNextCue
      ? chart.events[liveNextCue.eventIndex]
      : undefined;
    const feedback = runtime?.lastFeedback;
    const layerColor = layerColorScratch.set(
      BASE_JAM_FREQUENCY_LAYER_COLORS[liveEvent?.signalLayer ?? 1],
    );
    const hitSignalColor = hitColorScratch.set(
      HIT_SIGNAL_COLORS[
        feedback?.routedLayer ?? liveEvent?.signalLayer ?? 1
      ],
    );
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const settleSeconds =
      (feedback?.settleDurationMs ?? 150) / 1_000;
    const switching =
      feedback !== undefined &&
      feedback !== null &&
      feedback.activeFace !== feedback.previousFace &&
      feedbackAge < settleSeconds;
    const visualPreviousFace = switching
      ? feedback.previousFace
      : liveState.activeFace;
    const routeProgress = switching
      ? feedbackAge / Math.max(0.1, settleSeconds)
      : 1;
    const visualRouteProgress = runtime?.reducedMotion
      ? 1
      : routeProgress;
    let decisionPointCount = 0;

    if (currentPacket.current) {
      currentPacket.current.visible = nextVisible;
      gl.domElement.dataset.currentPacketVisible = String(nextVisible);
      if (nextVisible && liveNextCue) {
        const hitWindow = pulseHitWindowForCue(
          liveNextCue,
          liveState.tutorialStep,
        );
        const readiness =
          1 - clamp01(Math.abs(nextDelta) / (hitWindow + 0.12));
        const beatPulse = Math.pow(
          0.5 + 0.5 * Math.sin(songTime * Math.PI * 4),
          3,
        );
        const pulse = 1 + Math.sin(elapsed * 12) * 0.05 * readiness;
        const currentCueZ = cuePosition(
          liveNextCue,
          songTime,
          lookAheadSeconds,
        );
        const currentRibbon = frequencyRibbonForFace(targetFace);
        const currentRoadScale =
          baseJamFrequencyResponsiveRibbonScale(
            frequencyRibbonFanTransitionScaleX(
              currentRibbon,
              visualPreviousFace,
              liveState.activeFace,
              visualRouteProgress,
            ),
            portrait,
            compactLandscape,
          );
        setFrequencyRibbonFanTransitionTransform(
          transform,
          currentRibbon,
          visualPreviousFace,
          liveState.activeFace,
          visualRouteProgress,
          currentCueZ,
          cueLaneOffset(liveNextCue, liveRoute, portrait),
          0.22,
        );
        applyBaseJamFrequencyRoadFlow(
          transform,
          currentCueZ,
          currentRoadScale * roadShapeScale,
          roadShapeScale,
        );
        transform.position.y += 0.135;
        transform.quaternion.copy(camera.quaternion);
        transform.scale.set(
          (portrait ? 1.14 : 1.05) * pulse,
          (portrait ? 1.01 : 0.93) * pulse,
          0.7 * pulse,
        );
        const packetParent = currentPacket.current.parent;
        packetWorldCenter.copy(transform.position);
        packetParent?.localToWorld(packetWorldCenter);
        packetNdcCenter.copy(packetWorldCenter).project(camera);
        packetNdcEdge
          .set(PACKET_OUTER_HALF_WIDTH * transform.scale.x, 0, 0)
          .applyQuaternion(camera.quaternion)
          .add(packetWorldCenter)
          .project(camera);
        const packetHalfWidthNdc = Math.abs(
          packetNdcEdge.x - packetNdcCenter.x,
        );
        const safeMarginNdc =
          (PACKET_SAFE_MARGIN_PX * 2) / Math.max(1, width);
        const maxPacketCenterNdc = Math.max(
          0,
          1 - safeMarginNdc - packetHalfWidthNdc,
        );
        const clampedPacketCenterX = THREE.MathUtils.clamp(
          packetNdcCenter.x,
          -maxPacketCenterNdc,
          maxPacketCenterNdc,
        );
        const packetWasClamped =
          Math.abs(clampedPacketCenterX - packetNdcCenter.x) > 1e-6;
        if (packetWasClamped) {
          packetNdcCenter.x = clampedPacketCenterX;
          packetNdcCenter.unproject(camera);
          packetParent?.worldToLocal(packetNdcCenter);
          transform.position.copy(packetNdcCenter);
        }

        packetWorldCenter.copy(transform.position);
        packetParent?.localToWorld(packetWorldCenter);
        packetNdcCenter.copy(packetWorldCenter).project(camera);
        packetNdcEdge
          .set(0, PACKET_OUTER_HALF_HEIGHT * transform.scale.y, 0)
          .applyQuaternion(camera.quaternion)
          .add(packetWorldCenter)
          .project(camera);
        const packetHalfHeightNdc = Math.abs(
          packetNdcEdge.y - packetNdcCenter.y,
        );
        const packetLeft =
          ((packetNdcCenter.x - packetHalfWidthNdc + 1) * width) / 2;
        const packetRight =
          ((packetNdcCenter.x + packetHalfWidthNdc + 1) * width) / 2;
        const packetTop =
          ((1 - packetNdcCenter.y - packetHalfHeightNdc) * height) / 2;
        const packetBottom =
          ((1 - packetNdcCenter.y + packetHalfHeightNdc) * height) / 2;
        gl.domElement.dataset.currentPacketLeft = packetLeft.toFixed(2);
        gl.domElement.dataset.currentPacketRight = packetRight.toFixed(2);
        gl.domElement.dataset.currentPacketTop = packetTop.toFixed(2);
        gl.domElement.dataset.currentPacketBottom =
          packetBottom.toFixed(2);
        gl.domElement.dataset.currentPacketClamped =
          String(packetWasClamped);
        transform.updateMatrix();
        applyTransform(currentPacket.current, transform);
        decisionLinkPositions[0] = transform.position.x;
        decisionLinkPositions[1] = transform.position.y + 0.08;
        decisionLinkPositions[2] = transform.position.z;
        decisionPointCount = 1;

        if (currentMaterial.current) {
          currentMaterial.current.color
            .set("#050d18")
            .lerp(layerColor, 0.055 + readiness * 0.025);
          currentMaterial.current.emissive
            .copy(layerColor)
            .lerp(CURRENT_CYAN, readiness * 0.16);
          currentMaterial.current.emissiveIntensity =
            0.24 + readiness * 0.42;
        }
        if (currentGlowMaterial.current) {
          currentGlowMaterial.current.color.copy(CURRENT_CYAN);
          currentGlowMaterial.current.opacity =
            0.018 + readiness * (currentOffLane ? 0.1 : 0.2);
        }
        if (currentEdgeMaterial.current) {
          currentEdgeMaterial.current.color
            .copy(layerColor)
            .lerp(READY_COLOR, readiness * 0.18);
          currentEdgeMaterial.current.opacity =
            0.72 + readiness * 0.28;
        }
        if (trailMaterial.current) {
          trailMaterial.current.color
            .copy(layerColor)
            .lerp(trailNeutral, currentOffLane ? 0.82 : 0.7);
          trailMaterial.current.opacity =
            currentOffLane ? 0.012 : 0.026 + readiness * 0.022;
        }
        if (currentDataCells.current) {
          currentDataCells.current.position.y =
            Math.sin(songTime * Math.PI * 4) *
            0.008 *
            (runtime?.reducedMotion ? 0.25 : 1);
          currentDataCells.current.scale.setScalar(
            0.98 + beatPulse * 0.055 + readiness * 0.045,
          );
          for (let index = 0; index < 3; index += 1) {
            const selected = index === routeIndex(liveRoute);
            dataCellColorScratch
              .set(selected ? "#66e8ff" : "#174956");
            currentDataCells.current.setColorAt(
              index,
              dataCellColorScratch,
            );
          }
          if (currentDataCells.current.instanceColor) {
            currentDataCells.current.instanceColor.needsUpdate = true;
          }
        }
        if (currentDataCellMaterial.current) {
          currentDataCellMaterial.current.opacity =
            0.56 + beatPulse * 0.24 + readiness * 0.2;
        }
      }
    }

    let cumulativeFace = targetFace;
    previewPackets.current.forEach((packet, index) => {
      if (!packet) return;
      const livePreviewCue = livePreviewCues[index];
      const previewDelta = livePreviewCue
        ? runtime?.decisions[index + 1]?.deltaSeconds ??
          livePreviewCue.time - songTime
        : Number.POSITIVE_INFINITY;
      const previewLookAhead =
        lookAheadSeconds + 1.35 + index * 0.9;
      const previewVisible =
        Boolean(livePreviewCue) &&
        previewDelta <= previewLookAhead &&
        previewDelta >= 0.16;
      packet.visible = previewVisible;
      const route = livePreviewCue
        ? runtime?.decisions[index + 1]?.expectedRoute ??
          pulseExpectedRoute(livePreviewCue, liveState)
        : 0;

      if (livePreviewCue) {
        cumulativeFace =
          runtime?.decisions[index + 1]?.targetFace ??
          pulseFaceAfterRoute(cumulativeFace, route);
      }
      if (previewVisible && livePreviewCue) {
        const previewCueZ = cuePosition(
          livePreviewCue,
          songTime,
          previewLookAhead,
        );
        const previewRibbon = frequencyRibbonForFace(cumulativeFace);
        const previewRoadScale =
          baseJamFrequencyResponsiveRibbonScale(
            frequencyRibbonFanTransitionScaleX(
              previewRibbon,
              visualPreviousFace,
              liveState.activeFace,
              visualRouteProgress,
            ),
            portrait,
            compactLandscape,
          );
        setFrequencyRibbonFanTransitionTransform(
          transform,
          previewRibbon,
          visualPreviousFace,
          liveState.activeFace,
          visualRouteProgress,
          previewCueZ,
          cueLaneOffset(livePreviewCue, route, portrait),
          0.32,
        );
        applyBaseJamFrequencyRoadFlow(
          transform,
          previewCueZ,
          previewRoadScale * roadShapeScale,
          roadShapeScale,
        );
        transform.scale.set(
          (portrait ? 0.86 : 0.78) * (1 - index * 0.12),
          0.8,
          (0.78 + livePreviewCue.energy * 0.28) *
            (0.82 - index * 0.08),
        );
        transform.updateMatrix();
        applyTransform(packet, transform);
        const pointOffset = decisionPointCount * 3;
        decisionLinkPositions[pointOffset] = transform.position.x;
        decisionLinkPositions[pointOffset + 1] =
          transform.position.y + 0.08;
        decisionLinkPositions[pointOffset + 2] =
          transform.position.z;
        decisionPointCount += 1;
      }
    });
    const decisionAttribute = decisionLinkGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    if (decisionPointCount > 2) {
      decisionLinkPositions[9] = decisionLinkPositions[6];
      decisionLinkPositions[10] = decisionLinkPositions[7];
      decisionLinkPositions[11] = decisionLinkPositions[8];
      decisionLinkPositions[6] = decisionLinkPositions[3];
      decisionLinkPositions[7] = decisionLinkPositions[4];
      decisionLinkPositions[8] = decisionLinkPositions[5];
    }
    decisionAttribute.needsUpdate = decisionPointCount > 1;
    decisionLinkGeometry.setDrawRange(
      0,
      decisionPointCount > 2 ? 4 : decisionPointCount,
    );
    if (decisionLine.current) {
      decisionLine.current.visible = decisionPointCount > 1;
    }

    const nearestDelta = Math.abs(nextDelta);
    const hitWindow = liveNextCue
      ? pulseHitWindowForCue(liveNextCue, liveState.tutorialStep)
      : 0.5;
    const arrival = 1 - clamp01(nearestDelta / (hitWindow + 0.18));
    const runtimeImpact =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good")
        ? feedbackAge
        : Number.POSITIVE_INFINITY;
    const runtimeError =
      feedback &&
      (feedback.outcome === "wrong" || feedback.outcome === "miss")
        ? feedbackAge
        : Number.POSITIVE_INFINITY;
    const impactAge = Math.min(
      runtimeImpact,
      impactAt.current < 0 ? 2 : (now - impactAt.current) / 1_000,
    );
    const impact =
      impactAge < HIT_PULSE_SECONDS
        ? Math.sin((impactAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;
    const hitFlash =
      impactAge < 0.2 ? 1 - impactAge / 0.2 : 0;
    const hitAction = Math.max(impact, hitFlash * 0.86);
    const errorAge = Math.min(
      runtimeError,
      errorAt.current < 0 ? 2 : (now - errorAt.current) / 1_000,
    );
    const error =
      errorAge < ERROR_PULSE_SECONDS
        ? Math.sin((errorAge / ERROR_PULSE_SECONDS) * Math.PI)
        : 0;
    const successRippleProgress =
      impactAge < CAPTURE_BURST_SECONDS
        ? clamp01(impactAge / CAPTURE_BURST_SECONDS)
        : -1;
    const errorRippleProgress =
      errorAge < CAPTURE_BURST_SECONDS
        ? clamp01(errorAge / CAPTURE_BURST_SECONDS)
        : -1;
    const successRippleStrength =
      successRippleProgress < 0 ? 0 : 1 - successRippleProgress;
    const errorRippleStrength =
      errorRippleProgress < 0 ? 0 : 1 - errorRippleProgress;
    const rippleIsError = errorRippleStrength > successRippleStrength;
    const rippleProgress = rippleIsError
      ? errorRippleProgress
      : successRippleProgress;
    const rippleStrength = Math.max(
      successRippleStrength,
      errorRippleStrength,
    );
    const gateColor = gateColorScratch
      .copy(CURRENT_CYAN)
      .lerp(READY_COLOR, arrival)
      .lerp(ERROR_COLOR, error);

    if (gateCoreMaterial.current) {
      gateCoreMaterial.current.color.copy(gateColor);
      gateCoreMaterial.current.opacity =
        Math.min(1, 0.62 + arrival * 0.32 + hitAction * 0.06);
    }
    if (gateGlowMaterial.current) {
      gateGlowMaterial.current.color.copy(gateColor);
      gateGlowMaterial.current.opacity =
        0.055 + arrival * 0.16 + hitAction * 0.22 + error * 0.12;
    }
    if (hitWave.current) {
      hitWave.current.visible = rippleStrength > 0.001;
      const rippleScale =
        1 + Math.max(0, rippleProgress) * 0.55;
      hitWave.current.scale.set(rippleScale, rippleScale, 1);
      hitWave.current.rotation.z =
        Math.PI / 8 + Math.max(0, rippleProgress) * 0.08;
    }
    if (hitWaveMaterial.current) {
      hitWaveMaterial.current.color.copy(
        rippleIsError ? ERROR_COLOR : hitSignalColor,
      );
      hitWaveMaterial.current.opacity = rippleStrength * 0.48;
    }
    if (captureGroup.current) {
      captureGroup.current.position.x =
        error * Math.sin(now * 0.075) * 0.08;
      captureGroup.current.rotation.z =
        error * Math.sin(now * 0.065) * 0.014;
    }
    if (contactSpark.current) {
      contactSpark.current.visible = rippleStrength > 0.001;
      contactSpark.current.rotation.y = elapsed * 9;
      contactSpark.current.rotation.z = elapsed * -7;
      contactSpark.current.scale.setScalar(
        0.16 + rippleStrength * 0.54,
      );
    }
    if (contactSparkMaterial.current) {
      contactSparkMaterial.current.color.copy(
        rippleIsError ? ERROR_COLOR : READY_COLOR,
      );
      contactSparkMaterial.current.opacity = rippleStrength * 0.92;
    }

    const particles = burstParticles.current;
    if (particles) {
      particles.visible = rippleStrength > 0.001;
      if (particles.visible) {
        const motionScale = runtime?.reducedMotion ? 0.5 : 1;
        for (let index = 0; index < BURST_COUNT; index += 1) {
          const angle =
            (index / BURST_COUNT) * Math.PI * 2 + index * 0.17;
          const spread =
            (0.24 +
              Math.max(0, rippleProgress) *
                (1.72 + (index % 4) * 0.18)) *
            motionScale;
          const shardScale =
            (0.2 + rippleStrength * 0.72) * motionScale;
          localTransform.position.set(
            Math.cos(angle) * spread,
            0.09 + rippleStrength * 0.035,
            Math.sin(angle) * spread * 0.82,
          );
          localTransform.rotation.set(0, -angle, 0);
          localTransform.scale.set(
            shardScale * (0.72 + (index % 3) * 0.08),
            shardScale * 0.72,
            shardScale,
          );
          localTransform.updateMatrix();
          particles.setMatrixAt(index, localTransform.matrix);
        }
        particles.instanceMatrix.needsUpdate = true;
      }
    }
    if (burstMaterial.current) {
      burstMaterial.current.color.copy(
        rippleIsError ? ERROR_COLOR : hitSignalColor,
      );
      burstMaterial.current.opacity = rippleStrength * 0.9;
    }
  });

  return (
    <group>
      <group
        position={activeCapturePosition}
        ref={captureGroup}
        renderOrder={10}
        rotation={[0, 0, activeRibbonAngle + Math.PI / 2]}
      >
        <mesh>
          <boxGeometry
            args={[
              BASE_JAM_FREQUENCY_FACE_WIDTH * 0.72,
              0.075,
              0.12,
            ]}
          />
          <meshBasicMaterial
            color={currentLayerColor}
            depthWrite={false}
            opacity={0.82}
            ref={gateCoreMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>
        <mesh
          position={[0, 0.028, 0]}
          rotation={[Math.PI / 2, 0, Math.PI / 8]}
        >
          <ringGeometry args={[1.08, 1.17, 8, 1, Math.PI / 8]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color={currentLayerColor}
            depthWrite={false}
            opacity={0.11}
            ref={gateGlowMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[
              side * BASE_JAM_FREQUENCY_FACE_WIDTH * 0.36,
              0.025,
              0,
            ]}
            rotation={[0, side * 0.18, 0]}
          >
            <boxGeometry args={[0.08, 0.12, 0.3]} />
            <meshBasicMaterial
              color={currentLayerColor}
              depthWrite={false}
              opacity={0.92}
              toneMapped={false}
              transparent
            />
          </mesh>
        ))}

        <mesh
          position={[0, 0.08, 0]}
          ref={hitWave}
          rotation={[Math.PI / 2, 0, Math.PI / 8]}
          visible={false}
        >
          <ringGeometry args={[0.72, 0.84, 16]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#c7ed22"
            depthWrite={false}
            opacity={0}
            ref={hitWaveMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>

        <mesh ref={contactSpark} renderOrder={13} visible={false}>
          <octahedronGeometry args={[0.18, 0]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#f4eedb"
            depthTest={false}
            depthWrite={false}
            opacity={0}
            ref={contactSparkMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>

        <instancedMesh
          args={[undefined, undefined, BURST_COUNT]}
          frustumCulled={false}
          ref={burstParticles}
          visible={false}
        >
          <boxGeometry args={[0.08, 0.035, 0.5]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#c7ed22"
            depthWrite={false}
            opacity={0}
            ref={burstMaterial}
            toneMapped={false}
            transparent
          />
        </instancedMesh>
      </group>

      <group
        matrixAutoUpdate={false}
        ref={currentPacket}
        renderOrder={7}
        visible={false}
      >
        <mesh
          geometry={packetGeometry}
          position={[0, 0, -0.028]}
          scale={[1.08, 1.08, 1.12]}
        >
          <meshBasicMaterial
            color="#01030a"
            depthWrite={false}
            opacity={0.82}
            transparent
          />
        </mesh>
        <mesh geometry={packetGeometry}>
          <meshStandardMaterial
            color="#050d18"
            emissive="#174956"
            emissiveIntensity={0.24}
            metalness={0.72}
            ref={currentMaterial}
            roughness={0.34}
          />
        </mesh>
        <mesh
          geometry={packetGeometry}
          position={[0, 0, 0.075]}
          scale={[0.38, 0.52, 0.38]}
        >
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#66e8ff"
            depthWrite={false}
            opacity={0.02}
            ref={currentGlowMaterial}
            toneMapped={false}
            transparent
          />
        </mesh>
        <lineSegments
          geometry={packetEdges}
          renderOrder={8}
        >
          <lineBasicMaterial
            color="#34747d"
            depthTest={false}
            depthWrite={false}
            opacity={0.78}
            ref={currentEdgeMaterial}
            toneMapped={false}
            transparent
          />
        </lineSegments>
        <instancedMesh
          args={[undefined, undefined, 3]}
          frustumCulled={false}
          ref={currentDataCells}
          renderOrder={10}
        >
          <boxGeometry args={[0.13, 0.04, 0.11]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#ffffff"
            depthTest={false}
            depthWrite={false}
            opacity={0.72}
            ref={currentDataCellMaterial}
            toneMapped={false}
            transparent
            vertexColors
          />
        </instancedMesh>
        <instancedMesh
          args={[undefined, undefined, TRAIL_COUNT]}
          frustumCulled={false}
          geometry={packetGeometry}
          ref={packetTrail}
          renderOrder={6}
        >
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#174956"
            depthWrite={false}
            opacity={0.026}
            ref={trailMaterial}
            toneMapped={false}
            transparent
          />
        </instancedMesh>
      </group>

      <lineSegments
        frustumCulled={false}
        geometry={decisionLinkGeometry}
        ref={decisionLine}
        renderOrder={3}
        visible={false}
      >
        <lineBasicMaterial
          color="#348fc8"
          depthWrite={false}
          opacity={0.16}
          toneMapped={false}
          transparent
        />
      </lineSegments>

      {[0, 1].map((index) => {
        const previewColor =
          PREVIEW_LAYER_COLORS[
            previewLayers[index] ?? currentLayer
          ];
        return (
          <group
            key={`preview-packet-${index}`}
            matrixAutoUpdate={false}
            ref={(node) => {
              previewPackets.current[index] = node;
            }}
            renderOrder={5 - index}
            visible={false}
          >
            <mesh>
              <octahedronGeometry args={[0.34, 0]} />
              <meshBasicMaterial
                color={previewColor}
                depthTest={false}
                depthWrite={false}
                opacity={index === 0 ? 0.18 : 0.12}
                toneMapped={false}
                transparent
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

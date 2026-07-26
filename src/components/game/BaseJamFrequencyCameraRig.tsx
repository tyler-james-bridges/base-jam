"use client";

import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  baseJamFrequencyRoadShapeScale,
  baseJamFrequencyResponsiveRibbonScale,
  setBaseJamFrequencyRoadFlowPose,
  type BaseJamFrequencyRoadFlowPose,
} from "@/components/game/BaseJamFrequencyGeometry";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const CAMERA_DAMPING = 18;
const CAMERA_Z = 9.35;
const CAMERA_LOOK_Z = -8.9;
const HIT_PULSE_SECONDS = 0.42;
const MISS_PULSE_SECONDS = 0.32;

function shortestAngleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function BaseJamFrequencyCameraRig({
  activeFace,
  children,
  hitCount,
  missCount,
}: {
  readonly activeFace: number;
  readonly children: ReactNode;
  readonly hitCount: number;
  readonly missCount: number;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const { camera, gl, size } = useThree();
  const rotor = useRef<THREE.Group>(null);
  const currentAngle = useRef(0);
  const initialized = useRef(false);
  const reducedMotion = useRef(false);
  const hitAt = useRef(-1);
  const missAt = useRef(-1);
  const previousHits = useRef(hitCount);
  const previousMisses = useRef(missCount);
  const previousFace = useRef(activeFace);
  const fallbackRouteAt = useRef(-1);
  const fallbackRoute = useRef(0);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const targetMatrix = useMemo(() => new THREE.Matrix4(), []);
  const targetQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const roadFlowPose = useMemo<BaseJamFrequencyRoadFlowPose>(
    () => ({
      elevation: 0,
      lateral: 0,
      pitch: 0,
      yaw: 0,
    }),
    [],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      reducedMotion.current = media.matches;
    };

    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (hitCount > previousHits.current) {
      hitAt.current = performance.now();
    }
    previousHits.current = hitCount;
  }, [hitCount]);

  useEffect(() => {
    if (missCount > previousMisses.current) {
      missAt.current = performance.now();
    }
    previousMisses.current = missCount;
  }, [missCount]);

  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.08;
  }, [gl]);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const portrait = size.width / Math.max(1, size.height) < 0.75;
    const compactLandscape = !portrait && size.height < 520;
    camera.fov = portrait ? 66 : compactLandscape ? 58 : 60;
    camera.near = 0.1;
    camera.far = 60;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  useFrame((_, delta) => {
    const now = performance.now();
    const elapsed = now / 1_000;
    const runtime = runtimeReader?.getSnapshot();
    const liveFace = runtime?.state.activeFace ?? activeFace;
    if (liveFace !== previousFace.current) {
      const difference = ((liveFace - previousFace.current + 12) % 8) - 4;
      fallbackRoute.current = difference < 0 ? -1 : difference > 0 ? 1 : 0;
      fallbackRouteAt.current = now;
      previousFace.current = liveFace;
    }
    const shouldReduce =
      runtime?.reducedMotion ?? reducedMotion.current;
    const feedback = runtime?.lastFeedback;
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const settleSeconds =
      (feedback?.settleDurationMs ?? 150) / 1_000;
    const runtimeSwitch =
      feedback &&
      feedback.activeFace !== feedback.previousFace &&
      feedbackAge < settleSeconds
        ? {
            progress: feedbackAge / Math.max(0.1, settleSeconds),
            route: feedback.route ?? 0,
          }
        : null;
    const fallbackAge =
      fallbackRouteAt.current < 0
        ? Number.POSITIVE_INFINITY
        : (now - fallbackRouteAt.current) / 1_000;
    const fallbackSwitch =
      !runtimeSwitch && fallbackAge < 0.16
        ? {
            progress: fallbackAge / 0.16,
            route: fallbackRoute.current,
          }
        : null;
    const routeSwitch = runtimeSwitch ?? fallbackSwitch;
    const portrait = size.width / Math.max(1, size.height) < 0.75;
    const compactLandscape = !portrait && size.height < 520;
    const roadShapeScale = baseJamFrequencyRoadShapeScale(
      portrait,
      compactLandscape,
    );
    const routeBank =
      routeSwitch && !shouldReduce
        ? routeSwitch.route *
          Math.sin(routeSwitch.progress * Math.PI)
        : 0;
    setBaseJamFrequencyRoadFlowPose(
      roadFlowPose,
      CAMERA_LOOK_Z,
      roadShapeScale,
      roadShapeScale,
    );
    const roadLateralScale = baseJamFrequencyResponsiveRibbonScale(
      1,
      portrait,
      compactLandscape,
    );
    const roadTangentYaw = Math.atan(
      Math.tan(roadFlowPose.yaw) * roadLateralScale,
    );
    const roadBank = shouldReduce
      ? 0
      : THREE.MathUtils.clamp(
          -roadTangentYaw *
            (portrait ? 0.14 : compactLandscape ? 0.22 : 0.28),
          portrait ? -0.022 : compactLandscape ? -0.04 : -0.07,
          portrait ? 0.022 : compactLandscape ? 0.04 : 0.07,
        );
    const targetAngle =
      roadBank - routeBank * (portrait ? 0.078 : 0.11);
    if (!initialized.current || shouldReduce) {
      currentAngle.current = targetAngle;
    } else {
      const blend = 1 - Math.exp(-CAMERA_DAMPING * delta);
      currentAngle.current +=
        shortestAngleDelta(currentAngle.current, targetAngle) * blend;
    }
    const runtimeHit =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good")
        ? feedbackAge
        : Number.POSITIVE_INFINITY;
    const runtimeMiss =
      feedback &&
      (feedback.outcome === "wrong" || feedback.outcome === "miss")
        ? feedbackAge
        : Number.POSITIVE_INFINITY;
    const hitAge = Math.min(
      runtimeHit,
      hitAt.current < 0
        ? HIT_PULSE_SECONDS + 1
        : (now - hitAt.current) / 1_000,
    );
    const hit =
      hitAge < HIT_PULSE_SECONDS
        ? Math.sin((hitAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;
    const missAge = Math.min(
      runtimeMiss,
      missAt.current < 0
        ? MISS_PULSE_SECONDS + 1
        : (now - missAt.current) / 1_000,
    );
    const miss =
      missAge < MISS_PULSE_SECONDS
        ? Math.sin((missAge / MISS_PULSE_SECONDS) * Math.PI)
        : 0;
    const motionScale = shouldReduce ? 0.28 : 1;
    const breathe = Math.sin(elapsed * 0.52) * 0.018 * motionScale;
    const flowDrift =
      Math.sin(elapsed * 0.68) *
      (portrait ? 0.035 : 0.065) *
      motionScale;
    const roadLookX = shouldReduce
      ? 0
      : roadFlowPose.lateral * roadLateralScale * 0.16;
    const roadLookY = shouldReduce
      ? 0
      : roadFlowPose.elevation * 0.14;

    targetPosition.set(
      flowDrift -
        routeBank * (portrait ? 0.075 : 0.14) +
        miss * 0.028 * motionScale,
      BASE_JAM_FREQUENCY_CENTER_Y - 0.42 + breathe,
      CAMERA_Z - hit * 0.085 * motionScale + miss * 0.025 * motionScale,
    );
    lookTarget.set(
      flowDrift * 0.4 +
        routeBank * (portrait ? 0.16 : 0.28) +
        roadLookX,
      BASE_JAM_FREQUENCY_CENTER_Y -
        (portrait ? 2.5 : 1.72) +
        roadLookY,
      CAMERA_LOOK_Z,
    );
    targetMatrix.lookAt(targetPosition, lookTarget, up);
    targetQuaternion.setFromRotationMatrix(targetMatrix);

    camera.position.copy(targetPosition);
    camera.quaternion.copy(targetQuaternion);
    if (rotor.current) {
      rotor.current.rotation.z = currentAngle.current;
    }
    initialized.current = true;
  });

  return (
    <group
      position={[0, BASE_JAM_FREQUENCY_CENTER_Y, 0]}
      ref={rotor}
    >
      <group position={[0, -BASE_JAM_FREQUENCY_CENTER_Y, 0]}>
        {children}
      </group>
    </group>
  );
}

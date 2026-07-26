"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_LENGTH,
  BASE_JAM_FREQUENCY_NEAR_Z,
  BASE_JAM_FREQUENCY_RADIUS,
} from "@/components/game/BaseJamFrequencyGeometry";
import { PULSE_STEP_SECONDS } from "@/game/pulse";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const OCTAGON_SIDES = 8;
const OCTAGON_OFFSET = Math.PI / OCTAGON_SIDES;
const RING_SPACING = 3.08;
const RING_COUNT =
  Math.floor(BASE_JAM_FREQUENCY_LENGTH / RING_SPACING) + 2;
const RING_INNER_RADIUS = BASE_JAM_FREQUENCY_RADIUS + 0.08;
const RING_OUTER_RADIUS = BASE_JAM_FREQUENCY_RADIUS + 0.16;
const HIT_PULSE_SECONDS = 0.7;
const PHRASE_PULSE_SECONDS = 1.5;
const FORWARD_SPEED = 4.25;
const RING_COLORS = ["#17315f", "#1d3d69", "#33285c"] as const;
const HALO_COLORS = ["#28548c", "#23466e", "#493c77"] as const;

export interface BaseJamSignalTunnelProps {
  readonly currentStep: number;
  readonly layersUnlocked: number;
  readonly sealed: number;
}

function commitInstances(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

export function BaseJamSignalTunnel({
  currentStep,
  layersUnlocked,
  sealed,
}: BaseJamSignalTunnelProps) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const ringGroup = useRef<THREE.Group>(null);
  const coreRings = useRef<THREE.InstancedMesh>(null);
  const haloRings = useRef<THREE.InstancedMesh>(null);
  const coreMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const previousSealed = useRef(sealed);
  const impactAt = useRef(-1);
  const reducedMotion = useRef(false);
  const syncedAt = useRef(0);
  const syncedStep = useRef(currentStep);
  const transform = useMemo(() => new THREE.Object3D(), []);

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
    if (sealed > previousSealed.current) {
      impactAt.current = performance.now();
    }
    previousSealed.current = sealed;
  }, [sealed]);

  useEffect(() => {
    syncedStep.current = currentStep;
    syncedAt.current = performance.now();
  }, [currentStep]);

  useLayoutEffect(() => {
    const meshes = [coreRings.current, haloRings.current];

    for (let index = 0; index < RING_COUNT; index += 1) {
      const primary = index % 3 === 0;
      transform.position.set(
        0,
        0,
        BASE_JAM_FREQUENCY_NEAR_Z - index * RING_SPACING,
      );
      transform.rotation.set(0, 0, 0);
      transform.scale.setScalar(primary ? 1.025 : 0.985);
      transform.updateMatrix();
      meshes.forEach((mesh, meshIndex) => {
        if (!mesh) return;
        mesh.setMatrixAt(index, transform.matrix);
        mesh.setColorAt(
          index,
          new THREE.Color(
            (meshIndex === 0 ? RING_COLORS : HALO_COLORS)[
              index % RING_COLORS.length
            ],
          ),
        );
      });
    }

    meshes.forEach((mesh) => {
      if (mesh) commitInstances(mesh);
    });
  }, [transform]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now / 1_000;
    const runtime = runtimeReader?.getSnapshot();
    const impactAge =
      impactAt.current < 0
        ? HIT_PULSE_SECONDS + 1
        : (now - impactAt.current) / 1_000;
    const impact =
      impactAge < HIT_PULSE_SECONDS
        ? Math.sin((impactAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;
    const feedback = runtime?.lastFeedback;
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const ordinaryHit =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good") &&
      feedbackAge < 0.42
        ? Math.sin((feedbackAge / 0.42) * Math.PI)
        : 0;
    const phraseAge =
      feedback &&
      (feedback.phraseResult === "perfect" ||
        feedback.phraseResult === "good")
        ? (now - feedback.publishedAtPerformanceMs) / 1_000
        : Number.POSITIVE_INFINITY;
    const phrase =
      phraseAge < PHRASE_PULSE_SECONDS
        ? 1 - phraseAge / PHRASE_PULSE_SECONDS
        : 0;
    const shouldReduce =
      runtime?.reducedMotion ?? reducedMotion.current;
    const motionScale = shouldReduce ? 0 : 1;
    const idle = shouldReduce
      ? 0
      : (Math.sin(elapsed * 0.92) + 1) * 0.5;
    const visibleImpact =
      Math.max(impact, ordinaryHit, phrase) *
      (shouldReduce ? 0.45 : 1);
    const progression = Math.max(0, Math.min(1, layersUnlocked / 4));

    if (coreMaterial.current) {
      coreMaterial.current.opacity =
        0.12 +
        progression * 0.03 +
        idle * 0.01 +
        visibleImpact * 0.16;
    }
    if (haloMaterial.current) {
      haloMaterial.current.opacity =
        0.03 +
        progression * 0.01 +
        idle * 0.005 +
        visibleImpact * 0.035;
    }
    if (ringGroup.current) {
      const pulseScale = 1 + visibleImpact * 0.016 * motionScale;
      ringGroup.current.scale.set(pulseScale, pulseScale, 1);
      ringGroup.current.rotation.z = phrase * 0.018 * motionScale;
      const songTime =
        runtime?.songTimeSeconds ??
        syncedStep.current * PULSE_STEP_SECONDS +
          Math.min(
            PULSE_STEP_SECONDS * 1.2,
            (now - syncedAt.current) / 1_000,
          );
      const phase =
        (((songTime * FORWARD_SPEED) % RING_SPACING) + RING_SPACING) %
        RING_SPACING;
      ringGroup.current.position.z = motionScale * phase;
    }
  });

  return (
    <group position={[0, BASE_JAM_FREQUENCY_CENTER_Y, 0]}>
      <group ref={ringGroup}>
        <instancedMesh
          args={[undefined, undefined, RING_COUNT]}
          ref={haloRings}
          renderOrder={-4}
        >
          <ringGeometry
            args={[
              RING_INNER_RADIUS - 0.14,
              RING_OUTER_RADIUS + 0.14,
              OCTAGON_SIDES,
              1,
              OCTAGON_OFFSET,
              Math.PI * 2,
            ]}
          />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#316cff"
            depthTest
            depthWrite={false}
            opacity={0.055}
            ref={haloMaterial}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
            vertexColors
          />
        </instancedMesh>

        <instancedMesh
          args={[undefined, undefined, RING_COUNT]}
          ref={coreRings}
          renderOrder={-3}
        >
          <ringGeometry
            args={[
              RING_INNER_RADIUS,
              RING_OUTER_RADIUS,
              OCTAGON_SIDES,
              1,
              OCTAGON_OFFSET,
              Math.PI * 2,
            ]}
          />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#3975ff"
            depthTest
            depthWrite={false}
            opacity={0.12}
            ref={coreMaterial}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
            vertexColors
          />
        </instancedMesh>
      </group>
    </group>
  );
}

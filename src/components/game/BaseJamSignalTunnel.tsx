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

const OCTAGON_SIDES = 8;
const OCTAGON_OFFSET = Math.PI / OCTAGON_SIDES;
const RING_SPACING = 2.45;
const RING_COUNT =
  Math.floor(BASE_JAM_FREQUENCY_LENGTH / RING_SPACING) + 1;
const RING_INNER_RADIUS = BASE_JAM_FREQUENCY_RADIUS + 0.08;
const RING_OUTER_RADIUS = BASE_JAM_FREQUENCY_RADIUS + 0.13;
const HIT_PULSE_SECONDS = 0.7;

export interface BaseJamSignalTunnelProps {
  readonly layersUnlocked: number;
  readonly sealed: number;
}

function commitInstances(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

export function BaseJamSignalTunnel({
  layersUnlocked,
  sealed,
}: BaseJamSignalTunnelProps) {
  const group = useRef<THREE.Group>(null);
  const coreRings = useRef<THREE.InstancedMesh>(null);
  const haloRings = useRef<THREE.InstancedMesh>(null);
  const coreMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const haloMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const previousSealed = useRef(sealed);
  const impactAt = useRef(-1);
  const reducedMotion = useRef(false);
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

  useLayoutEffect(() => {
    const meshes = [coreRings.current, haloRings.current];

    for (let index = 0; index < RING_COUNT; index += 1) {
      transform.position.set(
        0,
        0,
        BASE_JAM_FREQUENCY_NEAR_Z - index * RING_SPACING,
      );
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      meshes.forEach((mesh) => mesh?.setMatrixAt(index, transform.matrix));
    }

    meshes.forEach((mesh) => {
      if (mesh) commitInstances(mesh);
    });
  }, [transform]);

  useFrame(() => {
    const elapsed = performance.now() / 1_000;
    const impactAge =
      impactAt.current < 0
        ? HIT_PULSE_SECONDS + 1
        : (performance.now() - impactAt.current) / 1_000;
    const impact =
      impactAge < HIT_PULSE_SECONDS
        ? Math.sin((impactAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;
    const motionScale = reducedMotion.current ? 0 : 1;
    const idle = reducedMotion.current
      ? 0
      : (Math.sin(elapsed * 0.92) + 1) * 0.5;
    const visibleImpact = impact * (reducedMotion.current ? 0.45 : 1);
    const progression = Math.max(0, Math.min(1, layersUnlocked / 4));

    if (coreMaterial.current) {
      coreMaterial.current.opacity =
        0.27 + progression * 0.04 + idle * 0.022 + visibleImpact * 0.12;
    }
    if (haloMaterial.current) {
      haloMaterial.current.opacity =
        0.075 +
        progression * 0.016 +
        idle * 0.01 +
        visibleImpact * 0.05;
    }
    if (group.current) {
      const pulseScale = 1 + visibleImpact * 0.008 * motionScale;
      group.current.scale.set(pulseScale, pulseScale, 1);
      group.current.position.z =
        motionScale * ((elapsed * 0.48) % RING_SPACING);
    }
  });

  return (
    <group position={[0, BASE_JAM_FREQUENCY_CENTER_Y, 0]} ref={group}>
      <instancedMesh
        args={[undefined, undefined, RING_COUNT]}
        ref={haloRings}
        renderOrder={-3}
      >
        <ringGeometry
          args={[
            RING_INNER_RADIUS - 0.1,
            RING_OUTER_RADIUS + 0.1,
            OCTAGON_SIDES,
            1,
            OCTAGON_OFFSET,
          ]}
        />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#316cff"
          depthTest
          depthWrite={false}
          opacity={0.075}
          ref={haloMaterial}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </instancedMesh>

      <instancedMesh
        args={[undefined, undefined, RING_COUNT]}
        ref={coreRings}
        renderOrder={-2}
      >
        <ringGeometry
          args={[
            RING_INNER_RADIUS,
            RING_OUTER_RADIUS,
            OCTAGON_SIDES,
            1,
            OCTAGON_OFFSET,
          ]}
        />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#3975ff"
          depthTest
          depthWrite={false}
          opacity={0.27}
          ref={coreMaterial}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </instancedMesh>
    </group>
  );
}

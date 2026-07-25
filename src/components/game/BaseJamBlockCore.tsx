"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_FAR_Z,
} from "@/components/game/BaseJamFrequencyGeometry";
import {
  PULSE_LAYERS,
  type PulseChart,
  type PulseState,
} from "@/game/pulse";

const CORE_Z = BASE_JAM_FREQUENCY_FAR_Z + 0.9;
const PHRASE_RADIUS = 3.42;
const SPOKE_RADIUS = 2.22;
const IMPACT_SECONDS = 0.72;

function commitInstances(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

export function BaseJamBlockCore({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  const group = useRef<THREE.Group>(null);
  const phraseCells = useRef<THREE.InstancedMesh>(null);
  const spokes = useRef<THREE.InstancedMesh>(null);
  const apertureMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const pulseMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const previousSealed = useRef(state.sealed);
  const impactAt = useRef(-1);
  const reducedMotion = useRef(false);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const activeColor = useMemo(() => new THREE.Color("#b6d81d"), []);
  const currentColor = useMemo(() => new THREE.Color("#f4eedb"), []);
  const droppedColor = useMemo(() => new THREE.Color("#a43e3c"), []);
  const idleColor = useMemo(() => new THREE.Color("#17315f"), []);

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
    if (state.sealed > previousSealed.current) {
      impactAt.current = performance.now();
    }
    previousSealed.current = state.sealed;
  }, [state.sealed]);

  useLayoutEffect(() => {
    const mesh = spokes.current;
    if (!mesh) return;

    for (let index = 0; index < 8; index += 1) {
      const angle = Math.PI / 8 + (index / 8) * Math.PI * 2;
      transform.position.set(
        Math.cos(angle) * SPOKE_RADIUS,
        Math.sin(angle) * SPOKE_RADIUS,
        0.03,
      );
      transform.rotation.set(0, 0, angle);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }

    commitInstances(mesh);
  }, [transform]);

  useLayoutEffect(() => {
    const mesh = phraseCells.current;
    if (!mesh) return;

    chart.events.forEach((event, index) => {
      const angle =
        Math.PI / 2 -
        (index / Math.max(1, chart.events.length)) * Math.PI * 2;
      const result = state.eventResults[event.id];
      const color =
        result === "perfect" || result === "good"
          ? activeColor
          : result === "flow"
            ? droppedColor
        : index === state.currentEvent
          ? currentColor
          : idleColor;

      transform.position.set(
        Math.cos(angle) * PHRASE_RADIUS,
        Math.sin(angle) * PHRASE_RADIUS,
        0.08,
      );
      transform.rotation.set(0, 0, angle + Math.PI / 2);
      transform.scale.set(index === state.currentEvent ? 1.18 : 1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color);
    });

    commitInstances(mesh);
  }, [
    activeColor,
    chart.events,
    currentColor,
    droppedColor,
    idleColor,
    state.currentEvent,
    state.eventResults,
    transform,
  ]);

  useFrame(() => {
    const elapsed = performance.now() / 1_000;
    const impactAge =
      impactAt.current < 0
        ? IMPACT_SECONDS + 1
        : (performance.now() - impactAt.current) / 1_000;
    const impact =
      impactAge < IMPACT_SECONDS
        ? Math.sin((impactAge / IMPACT_SECONDS) * Math.PI)
        : 0;
    const idle = reducedMotion.current
      ? 0
      : (Math.sin(elapsed * 1.4) + 1) * 0.5;

    if (apertureMaterial.current) {
      apertureMaterial.current.opacity = 0.44 + idle * 0.06 + impact * 0.24;
    }
    if (pulseMaterial.current) {
      pulseMaterial.current.opacity = 0.56 + idle * 0.12 + impact * 0.3;
    }
    if (group.current) {
      const scale = 1 + impact * (reducedMotion.current ? 0.012 : 0.035);
      group.current.scale.setScalar(scale);
    }
  });

  return (
    <group
      position={[0, BASE_JAM_FREQUENCY_CENTER_Y, CORE_Z]}
      ref={group}
    >
      <mesh position={[0, 0, -0.04]} renderOrder={-4}>
        <circleGeometry args={[4.5, 48]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#0c2b70"
          depthWrite={false}
          opacity={0.035}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      <mesh position={[0, 0, -0.03]} renderOrder={-3}>
        <circleGeometry args={[3.7, 48]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#1456f0"
          depthWrite={false}
          opacity={0.035}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      <mesh renderOrder={-2}>
        <circleGeometry args={[3.02, 8]} />
        <meshBasicMaterial
          color="#030916"
          depthWrite={false}
          opacity={0.88}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      <mesh renderOrder={-1}>
        <ringGeometry args={[2.82, 2.98, 8, 1, Math.PI / 8]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#316cff"
          depthWrite={false}
          opacity={0.44}
          ref={apertureMaterial}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      <mesh position={[0, 0, 0.05]} renderOrder={1}>
        <ringGeometry args={[1.34, 1.48, 8, 1, Math.PI / 8]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#80a6ff"
          depthWrite={false}
          opacity={0.56}
          ref={pulseMaterial}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      <mesh position={[0, 0, 0.07]} renderOrder={2}>
        <circleGeometry args={[0.22, 24]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#f4eedb"
          depthWrite={false}
          opacity={0.92}
          toneMapped={false}
          transparent
        />
      </mesh>

      <instancedMesh
        args={[undefined, undefined, 8]}
        ref={spokes}
        renderOrder={0}
      >
        <boxGeometry args={[1.18, 0.035, 0.04]} />
        <meshBasicMaterial
          color="#2858ad"
          depthWrite={false}
          opacity={0.22}
          toneMapped={false}
          transparent
        />
      </instancedMesh>

      <instancedMesh
        args={[undefined, undefined, chart.events.length]}
        ref={phraseCells}
        renderOrder={3}
      >
        <boxGeometry args={[0.48, 0.1, 0.08]} />
        <meshBasicMaterial
          depthWrite={false}
          toneMapped={false}
          vertexColors
        />
      </instancedMesh>

      {PULSE_LAYERS.map((layer, index) => {
        const live =
          (state.capturedUntilBar[index] ?? 0) > state.currentEvent;
        const radius = 1.7 + index * 0.2;
        return (
          <mesh
            key={layer.id}
            position={[0, 0, 0.025 + index * 0.006]}
            renderOrder={0}
            rotation={[0, 0, index * 0.18]}
          >
            <ringGeometry
              args={[radius, radius + 0.025, 48, 1, index * 0.42, Math.PI * 1.56]}
            />
            <meshBasicMaterial
              blending={THREE.AdditiveBlending}
              color={live ? layer.color : "#17315f"}
              depthWrite={false}
              opacity={live ? 0.62 : 0.12}
              side={THREE.DoubleSide}
              toneMapped={false}
              transparent
            />
          </mesh>
        );
      })}
    </group>
  );
}

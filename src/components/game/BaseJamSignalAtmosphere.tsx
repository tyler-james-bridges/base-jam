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
  BASE_JAM_FREQUENCY_FAR_Z,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
  BASE_JAM_FREQUENCY_LENGTH,
  BASE_JAM_FREQUENCY_NEAR_Z,
  frequencyRibbonForFace,
} from "@/components/game/BaseJamFrequencyGeometry";
import { PULSE_STEP_SECONDS, type PulseState } from "@/game/pulse";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const PARTICLE_COUNT = 72;
const PARTICLE_RADIUS = 5.25;
const PANEL_STATION_COUNT = 8;
const PANEL_COUNT = PANEL_STATION_COUNT * 6;
const STRUCTURE_BEAM_COUNT = 12;
const STAGE_WING_COUNT = PANEL_STATION_COUNT * 2;
const GANTRY_STATION_COUNT = 8;
const GANTRY_PARTS_PER_STATION = 5;
const GANTRY_SPACING = 3.85;
const SHELL_RADIUS = 6.45;
const PHRASE_BOOST_SECONDS = 1.5;
const HIT_PROPAGATION_SECONDS = 0.74;
const DEPTH = BASE_JAM_FREQUENCY_NEAR_Z - BASE_JAM_FREQUENCY_FAR_Z;
const PANEL_COLORS = [
  "#09234a",
  "#103464",
  "#24194f",
  "#07333d",
] as const;
const WING_COLORS = ["#1765bf", "#7045bd", "#10a4b1"] as const;
const POOL_POINTS = [
  [-4.8, 1.15, -4.6, "#1456f0"],
  [4.75, 2.25, -8.4, "#7b46cb"],
  [-3.9, 4.35, -12.2, "#0fb5c8"],
  [4.25, 0.8, -16.1, "#6235b4"],
  [-4.6, 2.8, -20.2, "#1764ff"],
  [3.8, 4.15, -23.8, "#7848d8"],
] as const;

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 91.137 + salt * 17.731) * 43758.5453;
  return value - Math.floor(value);
}

function createPoolTexture() {
  const size = 48;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const radius = Math.sqrt(dx * dx + dy * dy) * 2;
      const falloff = Math.pow(Math.max(0, 1 - radius), 2.4);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(falloff * 255);
    }
  }
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function BaseJamSignalAtmosphere({
  state,
}: {
  readonly state: PulseState;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const points = useRef<THREE.Points>(null);
  const pointsMaterial = useRef<THREE.PointsMaterial>(null);
  const panels = useRef<THREE.InstancedMesh>(null);
  const panelMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const gantryRibs = useRef<THREE.InstancedMesh>(null);
  const gantryMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const structureBeams = useRef<THREE.InstancedMesh>(null);
  const beamMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const stageWings = useRef<THREE.InstancedMesh>(null);
  const wingMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const colorPools = useRef<THREE.Points>(null);
  const poolMaterial = useRef<THREE.PointsMaterial>(null);
  const reducedMotion = useRef(false);
  const pointDelta = useRef(0);
  const environmentColorAt = useRef(-1);
  const previousSealed = useRef(state.sealed);
  const phraseAt = useRef(-1);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const baseFogColor = useMemo(() => new THREE.Color("#020611"), []);
  const fogColorScratch = useMemo(() => new THREE.Color(), []);
  const environmentColorScratch = useMemo(() => new THREE.Color(), []);
  const propagationColorScratch = useMemo(() => new THREE.Color(), []);
  const scene = useThree((three) => three.scene);
  const positions = useMemo(() => {
    const values = new Float32Array(PARTICLE_COUNT * 3);
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const angle = seeded(index, 1) * Math.PI * 2;
      const radius = PARTICLE_RADIUS * (0.36 + seeded(index, 2) * 0.64);
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] =
        BASE_JAM_FREQUENCY_CENTER_Y + Math.sin(angle) * radius;
      values[index * 3 + 2] =
        BASE_JAM_FREQUENCY_FAR_Z + seeded(index, 3) * DEPTH;
    }
    return values;
  }, []);
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    return next;
  }, [positions]);
  const poolTexture = useMemo(() => createPoolTexture(), []);
  const poolGeometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    const poolPositions = new Float32Array(POOL_POINTS.length * 3);
    const poolColors = new Float32Array(POOL_POINTS.length * 3);
    POOL_POINTS.forEach(([x, y, z, color], index) => {
      poolPositions[index * 3] = x;
      poolPositions[index * 3 + 1] = y;
      poolPositions[index * 3 + 2] = z;
      new THREE.Color(color).toArray(poolColors, index * 3);
    });
    next.setAttribute(
      "position",
      new THREE.BufferAttribute(poolPositions, 3),
    );
    next.setAttribute("color", new THREE.BufferAttribute(poolColors, 3));
    next.computeBoundingSphere();
    return next;
  }, []);

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
      phraseAt.current = performance.now();
    }
    previousSealed.current = state.sealed;
  }, [state.sealed]);

  useEffect(
    () => () => {
      geometry.dispose();
      poolGeometry.dispose();
      poolTexture.dispose();
    },
    [geometry, poolGeometry, poolTexture],
  );

  useLayoutEffect(() => {
    const panelMesh = panels.current;
    if (!panelMesh) return;

    for (let index = 0; index < PANEL_COUNT; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const cell = Math.floor(index / 2);
      const station = Math.floor(cell / 3);
      const step = cell % 3;
      const height = 1.45 + ((station * 2 + step) % 5) * 0.52;
      transform.position.set(
        side * (5.62 + step * 0.32),
        -1.18 + height * 0.5 + step * 0.045,
        1.7 - station * GANTRY_SPACING - step * 0.14,
      );
      transform.rotation.set(
        0,
        side * (0.025 + step * 0.018),
        0,
      );
      transform.scale.set(
        0.46 + step * 0.055,
        height,
        0.46 + ((station + step) % 2) * 0.1,
      );
      transform.updateMatrix();
      panelMesh.setMatrixAt(index, transform.matrix);
      panelMesh.setColorAt(
        index,
        new THREE.Color(
          PANEL_COLORS[(station + step) % PANEL_COLORS.length],
        ),
      );
    }
    panelMesh.instanceMatrix.needsUpdate = true;
    if (panelMesh.instanceColor) {
      panelMesh.instanceColor.needsUpdate = true;
    }
    panelMesh.computeBoundingBox();
    panelMesh.computeBoundingSphere();

    const gantryMesh = gantryRibs.current;
    if (!gantryMesh) return;
    for (let station = 0; station < GANTRY_STATION_COUNT; station += 1) {
      const z = 2.05 - station * GANTRY_SPACING;
      const nestedOffset = station % 2 === 0 ? 0 : 0.18;
      for (
        let part = 0;
        part < GANTRY_PARTS_PER_STATION;
        part += 1
      ) {
        const index = station * GANTRY_PARTS_PER_STATION + part;
        if (part === 0 || part === 1) {
          const side = part === 0 ? -1 : 1;
          transform.position.set(
            side * (6.08 + nestedOffset),
            1.36,
            z,
          );
          transform.rotation.set(0, side * 0.018, 0);
          transform.scale.set(0.1, 4.82, 0.18);
        } else if (part === 2 || part === 3) {
          const side = part === 2 ? -1 : 1;
          transform.position.set(
            side * (4.76 + nestedOffset * 0.55),
            4.27,
            z,
          );
          transform.rotation.set(0, 0, side * 0.67);
          transform.scale.set(0.085, 2.72, 0.16);
        } else {
          transform.position.set(0, 5.34 + nestedOffset * 0.12, z);
          transform.rotation.set(0, 0, 0);
          transform.scale.set(3.52, 0.065, 0.15);
        }
        transform.updateMatrix();
        gantryMesh.setMatrixAt(index, transform.matrix);
        gantryMesh.setColorAt(
          index,
          new THREE.Color(
            part === 4
              ? "#14b8c8"
              : part % 2 === 0
                ? PANEL_COLORS[station % PANEL_COLORS.length]
                : WING_COLORS[station % WING_COLORS.length],
          ),
        );
      }
    }
    gantryMesh.instanceMatrix.needsUpdate = true;
    if (gantryMesh.instanceColor) {
      gantryMesh.instanceColor.needsUpdate = true;
    }
    gantryMesh.computeBoundingBox();

    const beamMesh = structureBeams.current;
    if (!beamMesh) return;
    for (let index = 0; index < STRUCTURE_BEAM_COUNT; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const z =
        BASE_JAM_FREQUENCY_NEAR_Z -
        2.7 -
        Math.floor(index / 2) * 5.1;
      transform.position.set(
        side * 6.08,
        -0.22 + (Math.floor(index / 2) % 2) * 0.52,
        z,
      );
      transform.rotation.set(0, side * 0.025, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      beamMesh.setMatrixAt(index, transform.matrix);
      beamMesh.setColorAt(
        index,
        new THREE.Color(side < 0 ? "#174caa" : "#56319b"),
      );
    }
    beamMesh.instanceMatrix.needsUpdate = true;
    if (beamMesh.instanceColor) {
      beamMesh.instanceColor.needsUpdate = true;
    }
    beamMesh.computeBoundingBox();
    beamMesh.computeBoundingSphere();

    const wingMesh = stageWings.current;
    if (!wingMesh) return;
    for (let index = 0; index < STAGE_WING_COUNT; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const station = Math.floor(index / 2);
      const maxHeight = Math.max(
        ...[0, 1, 2].map(
          (step) =>
            1.45 +
              ((station * 2 + step) % 5) * 0.52 +
              step * 0.045,
        ),
      );
      transform.position.set(
        side * 5.94,
        -1.18 + maxHeight + 0.11,
        1.58 - station * GANTRY_SPACING,
      );
      transform.rotation.set(0, side * 0.035, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      wingMesh.setMatrixAt(index, transform.matrix);
      wingMesh.setColorAt(
        index,
        new THREE.Color(WING_COLORS[station % WING_COLORS.length]),
      );
    }
    wingMesh.instanceMatrix.needsUpdate = true;
    if (wingMesh.instanceColor) {
      wingMesh.instanceColor.needsUpdate = true;
    }
    wingMesh.computeBoundingBox();
    wingMesh.computeBoundingSphere();
  }, [transform]);

  useFrame((_, delta) => {
    const runtime = runtimeReader?.getSnapshot();
    const shouldReduce =
      runtime?.reducedMotion ?? reducedMotion.current;
    const now = performance.now();
    const feedback = runtime?.lastFeedback;
    const runtimePhraseAge =
      feedback?.phraseResult === "perfect" ||
      feedback?.phraseResult === "good"
        ? (now - feedback.publishedAtPerformanceMs) / 1_000
        : Number.POSITIVE_INFINITY;
    const fallbackPhraseAge =
      phraseAt.current < 0
        ? Number.POSITIVE_INFINITY
        : (now - phraseAt.current) / 1_000;
    const phraseAge = Math.min(runtimePhraseAge, fallbackPhraseAge);
    const phrase =
      phraseAge < PHRASE_BOOST_SECONDS
        ? 1 - phraseAge / PHRASE_BOOST_SECONDS
        : 0;
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const hit =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good") &&
      feedbackAge < 0.42
        ? Math.sin((feedbackAge / 0.42) * Math.PI)
        : 0;
    const propagationProgress =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good") &&
      feedbackAge < HIT_PROPAGATION_SECONDS
        ? feedbackAge / HIT_PROPAGATION_SECONDS
        : -1;
    const switching =
      feedback !== undefined &&
      feedback !== null &&
      feedback.activeFace !== feedback.previousFace &&
      feedbackAge < (feedback.settleDurationMs ?? 150) / 1_000;
    const routeBank =
      switching && feedback.route
        ? feedback.route *
          Math.sin(
            (feedbackAge /
              Math.max(0.1, (feedback.settleDurationMs ?? 150) / 1_000)) *
              Math.PI,
          )
        : 0;
    const songTime =
      runtime?.songTimeSeconds ??
      state.currentStep * PULSE_STEP_SECONDS;
    const motionScale = shouldReduce ? 0 : 1;
    const activeLayer =
      feedback?.routedLayer ??
      frequencyRibbonForFace(runtime?.state.activeFace ?? state.activeFace);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color
        .copy(baseFogColor)
        .lerp(
          fogColorScratch.set(
            BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
          ),
          phrase * 0.04 + hit * 0.055,
        );
      scene.fog.near = 15 - phrase * 0.9 - hit * 0.55;
      scene.fog.far = 38 + phrase * 1.6 + hit * 0.9;
    }

    if (pointsMaterial.current) {
      pointsMaterial.current.opacity =
        0.48 + phrase * 0.34 + hit * 0.18;
      pointsMaterial.current.size =
        0.052 + phrase * 0.046 + hit * 0.028;
    }
    if (poolMaterial.current) {
      poolMaterial.current.opacity =
        0.2 + phrase * 0.085 + hit * 0.15;
      poolMaterial.current.size =
        6.25 + phrase * 0.82 + hit * 0.7;
    }
    if (colorPools.current) {
      colorPools.current.rotation.z =
        Math.sin(songTime * 0.16) * 0.006 * motionScale;
    }
    if (panelMaterial.current) {
      panelMaterial.current.emissive
        .set("#08254d")
        .lerp(
          propagationColorScratch.set(
            BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
          ),
          0.08 + hit * 0.68,
        );
      panelMaterial.current.emissiveIntensity =
        0.38 + phrase * 0.5 + hit * 2;
    }
    if (gantryMaterial.current) {
      gantryMaterial.current.emissive
        .set("#07365f")
        .lerp(
          propagationColorScratch.set(
            BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
          ),
          0.06 + hit * 0.72,
        );
      gantryMaterial.current.emissiveIntensity =
        0.26 + phrase * 0.42 + hit * 1.82;
    }
    if (wingMaterial.current) {
      wingMaterial.current.emissiveIntensity =
        0.34 + phrase * 0.46 + hit * 1.34;
    }
    if (beamMaterial.current) {
      beamMaterial.current.emissiveIntensity =
        0.38 + phrase * 0.4 + hit * 1.08;
    }
    if (panels.current) {
      panels.current.position.z =
        motionScale * ((songTime * 3.25) % GANTRY_SPACING);
      panels.current.rotation.z = -routeBank * 0.022;
    }
    if (structureBeams.current) {
      structureBeams.current.position.z =
        motionScale * ((songTime * 1.7) % 6.3);
      structureBeams.current.rotation.z = routeBank * 0.018;
    }
    if (stageWings.current) {
      stageWings.current.position.z =
        motionScale * ((songTime * 3.25) % GANTRY_SPACING);
      stageWings.current.rotation.z = -routeBank * 0.028;
    }
    if (gantryRibs.current) {
      gantryRibs.current.position.z =
        motionScale * ((songTime * 2.05) % GANTRY_SPACING);
      gantryRibs.current.rotation.z = routeBank * 0.012;
    }

    if (
      now - environmentColorAt.current >= 32 ||
      propagationProgress >= 0
    ) {
      const propagationStation =
        propagationProgress < 0
          ? -10
          : propagationProgress * (PANEL_STATION_COUNT + 0.8);
      if (panels.current) {
        for (let index = 0; index < PANEL_COUNT; index += 1) {
          const cell = Math.floor(index / 2);
          const station = Math.floor(cell / 3);
          const step = cell % 3;
          const wave = Math.max(
            0,
            1 - Math.abs(station - propagationStation) / 1.25,
          );
          const idleBand =
            0.5 +
            0.5 *
              Math.sin(songTime * 1.7 - station * 0.92 - step * 0.42);
          environmentColorScratch
            .set(PANEL_COLORS[(station + step) % PANEL_COLORS.length])
            .lerp(
              propagationColorScratch.set(
                BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
              ),
              wave * 0.9 + idleBand * 0.08,
            )
            .multiplyScalar(0.46 + idleBand * 0.12 + wave * 1.18);
          panels.current.setColorAt(index, environmentColorScratch);
        }
        if (panels.current.instanceColor) {
          panels.current.instanceColor.needsUpdate = true;
        }
      }
      if (stageWings.current) {
        for (let index = 0; index < STAGE_WING_COUNT; index += 1) {
          const station = Math.floor(index / 2);
          const wave = Math.max(
            0,
            1 - Math.abs(station - propagationStation) / 1.1,
          );
          environmentColorScratch
            .set(WING_COLORS[station % WING_COLORS.length])
            .lerp(
              propagationColorScratch.set(
                BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
              ),
              wave,
            )
            .multiplyScalar(0.58 + wave * 1.12);
          stageWings.current.setColorAt(index, environmentColorScratch);
        }
        if (stageWings.current.instanceColor) {
          stageWings.current.instanceColor.needsUpdate = true;
        }
      }
      if (gantryRibs.current) {
        for (let station = 0; station < GANTRY_STATION_COUNT; station += 1) {
          const wave = Math.max(
            0,
            1 - Math.abs(station - propagationStation) / 1.35,
          );
          for (
            let part = 0;
            part < GANTRY_PARTS_PER_STATION;
            part += 1
          ) {
            const index = station * GANTRY_PARTS_PER_STATION + part;
            const baseColor =
              part === 4
                ? "#14b8c8"
                : part % 2 === 0
                  ? PANEL_COLORS[station % PANEL_COLORS.length]
                  : WING_COLORS[station % WING_COLORS.length];
            environmentColorScratch
              .set(baseColor)
              .lerp(
                propagationColorScratch.set(
                  BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer],
                ),
                wave * 0.92,
              )
              .multiplyScalar(0.44 + wave * 1.2);
            gantryRibs.current.setColorAt(
              index,
              environmentColorScratch,
            );
          }
        }
        if (gantryRibs.current.instanceColor) {
          gantryRibs.current.instanceColor.needsUpdate = true;
        }
      }
      environmentColorAt.current = now;
    }
    if (
      !points.current ||
      shouldReduce ||
      runtime?.phase === "paused" ||
      runtime?.phase === "finished"
    ) {
      return;
    }
    pointDelta.current += delta;
    if (pointDelta.current < 1 / 30) return;
    const particleDelta = pointDelta.current;
    pointDelta.current = 0;
    const attribute = points.current.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const speed =
      2.8 +
      Math.min(2.4, (runtime?.state.streak ?? state.streak) * 0.055);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const nextZ = attribute.getZ(index) + particleDelta * speed;
      attribute.setZ(
        index,
        nextZ > BASE_JAM_FREQUENCY_NEAR_Z
          ? nextZ - DEPTH
          : nextZ,
      );
    }
    attribute.needsUpdate = true;
  });

  return (
    <>
      <mesh
        position={[
          0,
          BASE_JAM_FREQUENCY_CENTER_Y,
          (BASE_JAM_FREQUENCY_NEAR_Z + BASE_JAM_FREQUENCY_FAR_Z) / 2,
        ]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={-12}
      >
        <cylinderGeometry
          args={[
            SHELL_RADIUS,
            SHELL_RADIUS,
            BASE_JAM_FREQUENCY_LENGTH,
            8,
            1,
            true,
            Math.PI / 8,
          ]}
        />
        <meshBasicMaterial
          color="#030817"
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>

      <mesh
        position={[
          0,
          BASE_JAM_FREQUENCY_CENTER_Y,
          BASE_JAM_FREQUENCY_FAR_Z - 0.18,
        ]}
        renderOrder={-11}
      >
        <ringGeometry args={[5.1, 8.7, 32]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#442d7a"
          depthWrite={false}
          opacity={0.12}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>

      <points
        frustumCulled={false}
        geometry={geometry}
        ref={points}
        renderOrder={-6}
      >
        <pointsMaterial
          blending={THREE.AdditiveBlending}
          color="#8eb2ff"
          depthWrite={false}
          opacity={0.48}
          ref={pointsMaterial}
          size={0.052}
          sizeAttenuation
          toneMapped={false}
          transparent
        />
      </points>

      <points
        frustumCulled={false}
        geometry={poolGeometry}
        ref={colorPools}
        renderOrder={-8}
      >
        <pointsMaterial
          alphaTest={0.015}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          map={poolTexture}
          opacity={0.18}
          ref={poolMaterial}
          size={5.15}
          sizeAttenuation
          toneMapped={false}
          transparent
          vertexColors
        />
      </points>
    </>
  );
}

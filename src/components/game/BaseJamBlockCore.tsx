"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BASE_JAM_FREQUENCY_CENTER_Y,
  BASE_JAM_FREQUENCY_FAR_Z,
  BASE_JAM_FREQUENCY_LAYER_COLORS,
} from "@/components/game/BaseJamFrequencyGeometry";
import {
  PULSE_LAYERS,
  type PulseChart,
  type PulseState,
} from "@/game/pulse";
import { useOptionalPulseRuntimeReader } from "@/game/pulse/runtime-store";

const CORE_Z = BASE_JAM_FREQUENCY_FAR_Z + 0.85;
const PHRASE_RADIUS = 3.72;
const IRIS_BLADE_COUNT = 8;
const INTAKE_PARTICLES = 12;
const PHRASE_CONDUIT_COUNT = 18;
const HIT_INTAKE_SECONDS = 0.24;
const PROCESSOR_RIPPLE_DELAY_SECONDS = 0.1;
const PROCESSOR_RIPPLE_SECONDS = 0.05;
const PHRASE_SEAL_SECONDS = 1.5;
const CORE_DESKTOP_SCALE = 0.92;
const CORE_PHONE_SCALE = 0.74;
const INTAKE_WORLD_LENGTH = 18.2;

function commitInstances(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function BaseJamBlockCore({
  chart,
  state,
}: {
  readonly chart: PulseChart;
  readonly state: PulseState;
}) {
  const runtimeReader = useOptionalPulseRuntimeReader();
  const root = useRef<THREE.Group>(null);
  const outerRotor = useRef<THREE.Group>(null);
  const innerRotor = useRef<THREE.Group>(null);
  const irisBlades = useRef<THREE.InstancedMesh>(null);
  const irisMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const phraseCells = useRef<THREE.InstancedMesh>(null);
  const intakeParticles = useRef<THREE.InstancedMesh>(null);
  const intakeMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const phraseConduit = useRef<THREE.InstancedMesh>(null);
  const phraseConduitMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const coreMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const sealRing = useRef<THREE.Mesh>(null);
  const sealMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const coreLight = useRef<THREE.PointLight>(null);
  const previousSealed = useRef(state.sealed);
  const fallbackPhraseAt = useRef(-1);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const idleColor = useMemo(() => new THREE.Color("#102755"), []);
  const currentColor = useMemo(() => new THREE.Color("#66e8ff"), []);
  const successColor = useMemo(() => new THREE.Color("#b6d81d"), []);
  const flowColor = useMemo(() => new THREE.Color("#9a3f43"), []);
  const darkIrisColor = useMemo(() => new THREE.Color("#071328"), []);
  const irisActiveScratch = useMemo(() => new THREE.Color(), []);
  const { height, width } = useThree((three) => three.size);
  const portrait = width / Math.max(1, height) < 0.75;

  useEffect(() => {
    if (state.sealed > previousSealed.current) {
      fallbackPhraseAt.current = performance.now();
    }
    previousSealed.current = state.sealed;
  }, [state.sealed]);

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
          ? successColor
          : result === "flow"
            ? flowColor
            : index === state.currentEvent
              ? currentColor
              : idleColor;

      transform.position.set(
        Math.cos(angle) * PHRASE_RADIUS,
        Math.sin(angle) * PHRASE_RADIUS,
        0.06,
      );
      transform.rotation.set(0, 0, angle + Math.PI / 2);
      transform.scale.set(index === state.currentEvent ? 1.18 : 1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color);
    });
    commitInstances(mesh);
  }, [
    chart.events,
    currentColor,
    flowColor,
    idleColor,
    state.currentEvent,
    state.eventResults,
    successColor,
    transform,
  ]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now / 1_000;
    const runtime = runtimeReader?.getSnapshot();
    const feedback = runtime?.lastFeedback;
    const feedbackAge =
      feedback === undefined || feedback === null
        ? Number.POSITIVE_INFINITY
        : (now - feedback.publishedAtPerformanceMs) / 1_000;
    const hit =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good") &&
      feedbackAge < HIT_INTAKE_SECONDS
        ? 1 - feedbackAge / HIT_INTAKE_SECONDS
        : 0;
    const processorRippleAge =
      feedbackAge - PROCESSOR_RIPPLE_DELAY_SECONDS;
    const processorRipple =
      feedback &&
      (feedback.outcome === "perfect" || feedback.outcome === "good") &&
      processorRippleAge >= 0 &&
      processorRippleAge < PROCESSOR_RIPPLE_SECONDS
        ? Math.sin(
            (processorRippleAge / PROCESSOR_RIPPLE_SECONDS) * Math.PI,
          )
        : 0;
    const runtimePhraseAge =
      feedback?.phraseResult &&
      (feedback.phraseResult === "perfect" ||
        feedback.phraseResult === "good")
        ? feedbackAge
        : Number.POSITIVE_INFINITY;
    const fallbackPhraseAge =
      fallbackPhraseAt.current < 0
        ? Number.POSITIVE_INFINITY
        : (now - fallbackPhraseAt.current) / 1_000;
    const phraseAge = Math.min(runtimePhraseAge, fallbackPhraseAge);
    const phrase =
      phraseAge < PHRASE_SEAL_SECONDS
        ? 1 - phraseAge / PHRASE_SEAL_SECONDS
        : 0;
    const motionScale = runtime?.reducedMotion ? 0.2 : 1;
    const activeLayer =
      feedback?.routedLayer ??
      chart.events[state.currentEvent]?.signalLayer ??
      1;
    const activeColor =
      activeLayer === 0
        ? "#66e8ff"
        : BASE_JAM_FREQUENCY_LAYER_COLORS[activeLayer];
    const coreBaseScale = portrait
      ? CORE_PHONE_SCALE
      : CORE_DESKTOP_SCALE;
    const coreRaise = portrait ? 1.72 : 1.48;
    const intakeLength = INTAKE_WORLD_LENGTH / coreBaseScale;
    const intakeDrop =
      (4.62 + coreRaise) / coreBaseScale;

    if (outerRotor.current) {
      outerRotor.current.rotation.z =
        elapsed * 0.025 * motionScale + phrase * 0.16;
    }
    if (innerRotor.current) {
      innerRotor.current.rotation.z =
        -elapsed * 0.04 * motionScale - phrase * 0.22;
    }
    if (root.current) {
      const scale =
        coreBaseScale *
        (1 + phrase * 0.045 + hit * 0.01 + processorRipple * 0.024);
      root.current.scale.setScalar(scale);
      root.current.position.y =
        BASE_JAM_FREQUENCY_CENTER_Y + coreRaise;
    }
    if (coreMaterial.current) {
      coreMaterial.current.color
        .copy(darkIrisColor)
        .lerp(
          irisActiveScratch.set(activeColor),
          0.06 +
            phrase * 0.12 +
            hit * 0.04 +
            processorRipple * 0.12,
        );
      coreMaterial.current.opacity =
        0.92 + phrase * 0.05 + hit * 0.03;
    }
    if (coreLight.current) {
      coreLight.current.color.set(activeColor);
      coreLight.current.intensity =
        1.4 + phrase * 5.2 + hit * 1.4 + processorRipple * 4;
    }

    const intake = intakeParticles.current;
    if (intake) {
      intake.visible = true;
      const selectedCell =
        (feedback?.route ??
          state.lastRoute ??
          chart.cues[state.currentCue]?.route ??
          0) + 1;
      for (let index = 0; index < INTAKE_PARTICLES; index += 1) {
        if (index < 3) {
          const selected = index === selectedCell;
          const readiness =
            1 +
            Math.sin(elapsed * 3.2 + index * 0.8) *
              0.035 *
              motionScale;
          transform.position.set(
            (index - 1) * 0.38,
            Math.sin(elapsed * 2.1 + index) *
              0.025 *
              motionScale,
            0.28,
          );
          transform.rotation.set(0, 0, 0);
          transform.scale.set(
            (selected ? 2.1 : 1.72) * readiness,
            (selected ? 1.72 : 1.38) * readiness,
            0.5,
          );
          intake.setColorAt(
            index,
            selected ? currentColor : idleColor,
          );
        } else if (hit > 0.001) {
          const shardIndex = index - 3;
          const shardCount = INTAKE_PARTICLES - 3;
          const stagger = shardIndex / shardCount;
          const progress = clamp01(
            feedbackAge / HIT_INTAKE_SECONDS * 1.3 - stagger * 0.28,
          );
          transform.position.set(
            Math.sin(index * 2.17) * (1 - progress) * 0.48,
            -intakeDrop * (1 - progress) +
              Math.cos(index * 1.73) * (1 - progress) * 0.18,
            intakeLength * (1 - progress),
          );
          transform.rotation.set(0, index * 0.31, index * 0.17);
          transform.scale.setScalar(
            progress > 0 ? Math.max(0.08, (1 - progress) * 0.7) : 0,
          );
          intake.setColorAt(index, irisActiveScratch.set(activeColor));
        } else {
          transform.position.set(0, 0, 0);
          transform.rotation.set(0, 0, 0);
          transform.scale.setScalar(0);
        }
        transform.updateMatrix();
        intake.setMatrixAt(index, transform.matrix);
      }
      intake.instanceMatrix.needsUpdate = true;
      if (intake.instanceColor) {
        intake.instanceColor.needsUpdate = true;
      }
    }
    if (intakeMaterial.current) {
      intakeMaterial.current.color.set("#ffffff");
      intakeMaterial.current.opacity = 0.72 + hit * 0.22;
    }

    const conduit = phraseConduit.current;
    if (conduit) {
      const conduitStrength = Math.max(
        phrase,
        processorRipple * 0.62,
      );
      conduit.visible = conduitStrength > 0.001;
      if (conduit.visible) {
        for (let index = 0; index < PHRASE_CONDUIT_COUNT; index += 1) {
          const t = (index + 0.5) / PHRASE_CONDUIT_COUNT;
          const wave =
            Math.sin(index * 1.87 + elapsed * 15) *
            0.08 *
            conduitStrength *
            motionScale;
          transform.position.set(
            wave,
            -intakeDrop * t,
            0.45 + intakeLength * t,
          );
          transform.rotation.set(
            Math.atan2(intakeDrop, intakeLength),
            0,
            index % 2 === 0 ? 0.12 : -0.12,
          );
          const segmentPulse =
            0.78 + Math.sin(elapsed * 18 - index * 0.9) * 0.22;
          transform.scale.set(
            (0.55 + conduitStrength * 0.65) * segmentPulse,
            0.55 + conduitStrength * 0.65,
            1,
          );
          transform.updateMatrix();
          conduit.setMatrixAt(index, transform.matrix);
        }
        conduit.instanceMatrix.needsUpdate = true;
      }
    }
    if (phraseConduitMaterial.current) {
      phraseConduitMaterial.current.color.set(activeColor);
      phraseConduitMaterial.current.opacity = Math.min(
        0.48,
        phrase * 0.48 + processorRipple * 0.38,
      );
    }

    const blades = irisBlades.current;
    if (blades) {
      const open =
        phraseAge < 0.32
          ? clamp01(phraseAge / 0.32)
          : phraseAge < 0.92
            ? 1 - clamp01((phraseAge - 0.32) / 0.6)
            : 0;
      for (let index = 0; index < IRIS_BLADE_COUNT; index += 1) {
        const angle = (index / IRIS_BLADE_COUNT) * Math.PI * 2;
        const radius = 1.12 + open * 1.05;
        transform.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          0.2 + open * 0.08,
        );
        transform.rotation.set(0, 0, angle + Math.PI / 2 + open * 0.44);
        transform.scale.set(1, 1 - open * 0.36, 1);
        transform.updateMatrix();
        blades.setMatrixAt(index, transform.matrix);
      }
      blades.instanceMatrix.needsUpdate = true;
    }
    if (irisMaterial.current) {
      irisMaterial.current.color
        .copy(darkIrisColor)
        .lerp(
          irisActiveScratch.set(activeColor),
          0.1 + phrase * 0.2,
        );
      irisMaterial.current.emissive.set(activeColor);
      irisMaterial.current.emissiveIntensity = Math.min(
        0.75,
        0.22 + phrase * 0.53 + processorRipple * 0.28,
      );
    }

    if (sealRing.current) {
      sealRing.current.visible = phrase > 0.001;
      const expansion = 1 + (1 - phrase) * 2.2;
      sealRing.current.scale.setScalar(expansion);
    }
    if (sealMaterial.current) {
      sealMaterial.current.color.set(activeColor);
      sealMaterial.current.opacity = phrase * 0.78;
    }
  });

  return (
    <group
      position={[0, BASE_JAM_FREQUENCY_CENTER_Y, CORE_Z]}
      ref={root}
    >
      <mesh position={[0, 0, -0.4]} renderOrder={-5}>
        <circleGeometry args={[5.2, 48]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#123b86"
          depthWrite={false}
          opacity={0.13}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
      <mesh
        position={[0, 0, -0.5]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={-6}
      >
        <cylinderGeometry args={[4.45, 4.45, 0.26, 8, 1, false]} />
        <meshStandardMaterial
          color="#030a18"
          emissive="#0b1d3b"
          emissiveIntensity={0.32}
          metalness={0.82}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0, -0.32]} renderOrder={-4}>
        <ringGeometry args={[3.98, 4.48, 8, 1, Math.PI / 8]} />
        <meshBasicMaterial
          color="#07162f"
          depthWrite={false}
          opacity={0.9}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      <group ref={outerRotor}>
        <mesh>
          <ringGeometry args={[2.8, 2.94, 8, 1, Math.PI / 8]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#3975ff"
            depthWrite={false}
            opacity={0.36}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
          />
        </mesh>
      </group>

      <group ref={innerRotor}>
        <mesh position={[0, 0, 0.08]}>
          <ringGeometry args={[1.38, 1.52, 8, 1, Math.PI / 8]} />
          <meshBasicMaterial
            blending={THREE.AdditiveBlending}
            color="#4d82f6"
            depthWrite={false}
            opacity={0.42}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
          />
        </mesh>
        {PULSE_LAYERS.map((layer, index) => {
          const live =
            (state.capturedUntilBar[index] ?? 0) > state.currentEvent;
          const radius = 1.7 + index * 0.2;
          return (
            <mesh
              key={layer.id}
              position={[0, 0, 0.03 + index * 0.008]}
              rotation={[0, 0, index * 0.44]}
            >
              <ringGeometry
                args={[
                  radius,
                  radius + 0.03,
                  40,
                  1,
                  0,
                  Math.PI * 1.38,
                ]}
              />
              <meshBasicMaterial
                blending={THREE.AdditiveBlending}
                color={
                  live
                    ? layer.id === 0
                      ? "#66e8ff"
                      : layer.color
                    : "#17315f"
                }
                depthWrite={false}
                opacity={live ? 0.78 : 0.16}
                side={THREE.DoubleSide}
                toneMapped={false}
                transparent
              />
            </mesh>
          );
        })}
      </group>

      <instancedMesh
        args={[undefined, undefined, IRIS_BLADE_COUNT]}
        ref={irisBlades}
        renderOrder={1}
      >
        <boxGeometry args={[1.08, 0.3, 0.14]} />
        <meshStandardMaterial
          color="#071328"
          emissive="#315faa"
          emissiveIntensity={0.28}
          metalness={0.78}
          ref={irisMaterial}
          roughness={0.24}
        />
      </instancedMesh>

      <instancedMesh
        args={[undefined, undefined, PHRASE_CONDUIT_COUNT]}
        frustumCulled={false}
        ref={phraseConduit}
        renderOrder={7}
        visible={false}
      >
        <boxGeometry args={[0.11, 0.08, 0.92]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#b6d81d"
          depthWrite={false}
          opacity={0}
          ref={phraseConduitMaterial}
          toneMapped={false}
          transparent
        />
      </instancedMesh>

      <instancedMesh
        args={[undefined, undefined, chart.events.length]}
        ref={phraseCells}
        renderOrder={4}
      >
        <boxGeometry args={[0.52, 0.12, 0.08]} />
        <meshBasicMaterial
          depthWrite={false}
          toneMapped={false}
          vertexColors
        />
      </instancedMesh>

      <mesh position={[0, 0, -0.08]} renderOrder={0}>
        <circleGeometry args={[1.12, 8, Math.PI / 8]} />
        <meshBasicMaterial
          color="#020713"
          depthWrite={false}
          opacity={0.94}
          ref={coreMaterial}
          toneMapped={false}
          transparent
        />
      </mesh>
      <pointLight
        color="#3975ff"
        decay={2}
        distance={7}
        intensity={1.4}
        position={[0, 0, 1.2]}
        ref={coreLight}
      />
      <pointLight
        color="#dbe7ff"
        decay={2}
        distance={5.5}
        intensity={3.5}
        position={[-0.7, 1.35, 2.8]}
      />

      <instancedMesh
        args={[undefined, undefined, INTAKE_PARTICLES]}
        frustumCulled={false}
        ref={intakeParticles}
        renderOrder={5}
      >
        <boxGeometry args={[0.12, 0.08, 0.34]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#ffffff"
          depthWrite={false}
          opacity={0}
          ref={intakeMaterial}
          toneMapped={false}
          transparent
          vertexColors
        />
      </instancedMesh>

      <mesh ref={sealRing} renderOrder={6} visible={false}>
        <ringGeometry args={[2.98, 3.12, 32]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#b6d81d"
          depthWrite={false}
          opacity={0}
          ref={sealMaterial}
          side={THREE.DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

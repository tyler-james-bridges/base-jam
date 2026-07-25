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
  BASE_JAM_FREQUENCY_FACE_COUNT,
  normalizedFrequencyFace,
} from "@/components/game/BaseJamFrequencyGeometry";

const CAMERA_DAMPING = 14;
const CAMERA_Z = 10.2;
const CAMERA_LOOK_Z = -7.5;
const HIT_PULSE_SECONDS = 0.58;

function shortestAngleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function BaseJamFrequencyCameraRig({
  activeFace,
  children,
  sealed,
}: {
  readonly activeFace: number;
  readonly children: ReactNode;
  readonly sealed: number;
}) {
  const { camera, gl, size } = useThree();
  const rotor = useRef<THREE.Group>(null);
  const currentAngle = useRef(
    -normalizedFrequencyFace(activeFace) *
      ((Math.PI * 2) / BASE_JAM_FREQUENCY_FACE_COUNT),
  );
  const initialized = useRef(false);
  const reducedMotion = useRef(false);
  const impactAt = useRef(-1);
  const previousSealed = useRef(sealed);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const targetMatrix = useMemo(() => new THREE.Matrix4(), []);
  const targetQuaternion = useMemo(() => new THREE.Quaternion(), []);

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
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.02;
  }, [gl]);

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const portrait = size.width / Math.max(1, size.height) < 0.75;
    const compactLandscape = !portrait && size.height < 520;
    camera.fov = portrait ? 68 : compactLandscape ? 56 : 50;
    camera.near = 0.1;
    camera.far = 60;
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  useFrame((_, delta) => {
    const elapsed = performance.now() / 1_000;
    const targetAngle =
      -normalizedFrequencyFace(activeFace) *
      ((Math.PI * 2) / BASE_JAM_FREQUENCY_FACE_COUNT);
    if (!initialized.current || reducedMotion.current) {
      currentAngle.current = targetAngle;
    } else {
      const blend = 1 - Math.exp(-CAMERA_DAMPING * delta);
      currentAngle.current +=
        shortestAngleDelta(currentAngle.current, targetAngle) * blend;
    }

    const impactAge =
      impactAt.current < 0
        ? HIT_PULSE_SECONDS + 1
        : (performance.now() - impactAt.current) / 1_000;
    const impact =
      impactAge < HIT_PULSE_SECONDS
        ? Math.sin((impactAge / HIT_PULSE_SECONDS) * Math.PI)
        : 0;
    const shake = reducedMotion.current ? 0 : impact * 0.018;

    targetPosition.set(
      Math.sin(elapsed * 70) * shake,
      BASE_JAM_FREQUENCY_CENTER_Y -
        0.34 +
        Math.cos(elapsed * 64) * shake * 0.35,
      CAMERA_Z + Math.cos(elapsed * 58) * shake * 0.4,
    );
    lookTarget.set(
      0,
      BASE_JAM_FREQUENCY_CENTER_Y - 1.05,
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

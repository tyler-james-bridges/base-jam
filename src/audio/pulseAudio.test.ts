import { afterEach, describe, expect, it, vi } from "vitest";

import { createPracticeManifest } from "@/lib/base/manifest";
import {
  createPulseChart,
  createPulseState,
} from "@/game/pulse";

import {
  derivePulseAudioProfile,
  derivePulseHitVoiceProfile,
  PulseAudioEngine,
} from "./pulseAudio";

class MockAudioParam {
  value = 0;
  cancelAndHoldAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockCompressorNode extends MockAudioNode {
  attack = new MockAudioParam();
  knee = new MockAudioParam();
  ratio = new MockAudioParam();
  release = new MockAudioParam();
  threshold = new MockAudioParam();
}

class MockFilterNode extends MockAudioNode {
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  type: BiquadFilterType = "lowpass";
}

class MockSourceNode extends MockAudioNode {
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class MockOscillatorNode extends MockSourceNode {
  detune = new MockAudioParam();
  frequency = new MockAudioParam();
  type: OscillatorType = "sine";
}

class MockBufferSourceNode extends MockSourceNode {
  buffer: AudioBuffer | null = null;
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);

function setTestWindow(value: Record<string, unknown>) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
    writable: true,
  });
}

function createMockAudioContext() {
  const gains: MockGainNode[] = [];
  const oscillators: MockOscillatorNode[] = [];
  const bufferSources: MockBufferSourceNode[] = [];
  const compressor = new MockCompressorNode();
  const mediaTrack = { stop: vi.fn() };
  const evidenceDestination = Object.assign(new MockAudioNode(), {
    stream: {
      getAudioTracks: () => [mediaTrack],
      getTracks: () => [mediaTrack],
    },
  });
  const createMediaStreamDestination = vi.fn(
    () => evidenceDestination,
  );
  const context = {
    createBiquadFilter: () => new MockFilterNode(),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const source = new MockBufferSourceNode();
      bufferSources.push(source);
      return source;
    },
    createDynamicsCompressor: () => compressor,
    createMediaStreamDestination,
    createGain: () => {
      const gain = new MockGainNode();
      gains.push(gain);
      return gain;
    },
    createOscillator: () => {
      const oscillator = new MockOscillatorNode();
      oscillators.push(oscillator);
      return oscillator;
    },
    currentTime: 4,
    destination: new MockAudioNode(),
    resume: vi.fn(),
    sampleRate: 8_000,
    state: "running",
  } as unknown as AudioContext;

  return {
    bufferSources,
    compressor,
    context,
    createMediaStreamDestination,
    evidenceDestination,
    gains,
    mediaTrack,
    oscillators,
  };
}

const quietBlock = {
  blockHash:
    "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  calldataBytes: 128,
  gasRatio: 0.18,
  txCount: 48,
} as const;

const busyBlock = {
  blockHash:
    "0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
  calldataBytes: 1_400_000,
  gasRatio: 0.94,
  txCount: 1_850,
} as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(
      globalThis,
      "window",
      originalWindowDescriptor,
    );
  } else {
    delete (globalThis as { window?: Window }).window;
  }
});

describe("derivePulseAudioProfile", () => {
  it("is deterministic for one block and bar", () => {
    expect(derivePulseAudioProfile(busyBlock, 4)).toEqual(
      derivePulseAudioProfile(busyBlock, 4),
    );
  });

  it("turns block load into bounded musical energy and brightness", () => {
    const quiet = derivePulseAudioProfile(quietBlock, 0);
    const busy = derivePulseAudioProfile(busyBlock, 0);

    expect(busy.energy).toBeGreaterThan(quiet.energy);
    expect(busy.brightness).toBeGreaterThan(quiet.brightness);
    expect(busy.energy).toBeLessThanOrEqual(0.96);
    expect(quiet.energy).toBeGreaterThanOrEqual(0.22);
  });

  it("uses hash and bar position to choose reproducible variations", () => {
    const first = derivePulseAudioProfile(quietBlock, 0);
    const later = derivePulseAudioProfile(quietBlock, 3);
    const otherHash = derivePulseAudioProfile(busyBlock, 0);

    expect(later.variation).not.toBe(first.variation);
    expect(otherHash.variation).not.toBe(first.variation);
    expect([0, 3, 5, 7, 10]).toContain(first.rootOffset);
    expect(first.swingSeconds).toBeGreaterThanOrEqual(0.003);
    expect(first.swingSeconds).toBeLessThanOrEqual(0.01);
  });
});

describe("derivePulseHitVoiceProfile", () => {
  const profile = { patternOffset: 2 };

  it("keeps each stem in a recognizable register on the block-derived scale", () => {
    const voices = ([0, 1, 2, 3] as const).map((lane) =>
      derivePulseHitVoiceProfile(lane, 1, "good", 0, profile),
    );

    expect(voices.map((voice) => voice.primaryMidi)).toEqual([
      89, 55, 69, 80,
    ]);
    for (const voice of voices) {
      expect([0, 3, 5, 7, 10]).toContain(voice.scaleDegree);
    }
  });

  it("adds a consonant grid-timed accent only for a perfect hit", () => {
    const good = derivePulseHitVoiceProfile(2, 0, "good", 3, profile);
    const perfect = derivePulseHitVoiceProfile(
      2,
      0,
      "perfect",
      3,
      profile,
    );

    expect(good).toMatchObject({
      accentDelaySeconds: null,
      accentMidi: null,
      primaryMidi: perfect.primaryMidi,
    });
    expect(perfect.accentMidi).toBe(perfect.primaryMidi + 7);
    expect(perfect.accentDelaySeconds).toBe(0.0625);
  });
});

describe("PulseAudioEngine lifecycle", () => {
  it("cancels future voices and disconnects its shared-context graph once", () => {
    vi.useFakeTimers();
    const { compressor, context, gains, oscillators } =
      createMockAudioContext();
    const chart = createPulseChart(
      [createPracticeManifest({ reason: "audio lifecycle test" })],
      1,
    );
    const engine = new PulseAudioEngine(
      context,
      chart,
      createPulseState,
    );

    engine.start(1.8);
    expect(oscillators).toHaveLength(3);
    expect(gains.slice(0, 6)).toHaveLength(6);

    engine.stop();
    for (const oscillator of oscillators) {
      expect(oscillator.stop).toHaveBeenLastCalledWith(4.06);
    }

    vi.advanceTimersByTime(90);
    expect(compressor.disconnect).toHaveBeenCalledOnce();
    for (const persistentGain of gains.slice(0, 6)) {
      expect(persistentGain.disconnect).toHaveBeenCalledOnce();
    }
    for (const oscillator of oscillators) {
      expect(oscillator.disconnect).toHaveBeenCalledOnce();
      expect(oscillator.onended).toBeNull();
    }

    engine.dispose();
    expect(compressor.disconnect).toHaveBeenCalledOnce();
    for (const persistentGain of gains.slice(0, 6)) {
      expect(persistentGain.disconnect).toHaveBeenCalledOnce();
    }
  });

  it("exposes the post-compressor mix only for evidence and cleans the tap", () => {
    setTestWindow({
      __BASE_JAM_AUDIO_EVIDENCE_ENABLED__: true,
    });
    const {
      compressor,
      context,
      createMediaStreamDestination,
      evidenceDestination,
      mediaTrack,
    } = createMockAudioContext();
    const chart = createPulseChart(
      [createPracticeManifest({ reason: "audio evidence test" })],
      1,
    );
    const engine = new PulseAudioEngine(
      context,
      chart,
      createPulseState,
    );
    const evidenceWindow = window as Window & {
      __BASE_JAM_AUDIO_EVIDENCE_STREAM__?: MediaStream;
    };

    expect(createMediaStreamDestination).toHaveBeenCalledOnce();
    expect(compressor.connect).toHaveBeenCalledWith(
      evidenceDestination,
    );
    expect(evidenceWindow.__BASE_JAM_AUDIO_EVIDENCE_STREAM__).toBe(
      evidenceDestination.stream,
    );

    engine.dispose();
    expect(mediaTrack.stop).toHaveBeenCalledOnce();
    expect(evidenceDestination.disconnect).toHaveBeenCalledOnce();
    expect(
      evidenceWindow.__BASE_JAM_AUDIO_EVIDENCE_STREAM__,
    ).toBeUndefined();
  });

  it("does not create or expose an evidence tap during normal gameplay", () => {
    setTestWindow({});
    const { context, createMediaStreamDestination } =
      createMockAudioContext();
    const chart = createPulseChart(
      [createPracticeManifest({ reason: "normal audio test" })],
      1,
    );
    const engine = new PulseAudioEngine(
      context,
      chart,
      createPulseState,
    );

    expect(createMediaStreamDestination).not.toHaveBeenCalled();
    expect(
      (
        window as Window & {
          __BASE_JAM_AUDIO_EVIDENCE_STREAM__?: MediaStream;
        }
      ).__BASE_JAM_AUDIO_EVIDENCE_STREAM__,
    ).toBeUndefined();
    engine.dispose();
  });

  it("layers perfect feedback, confirms route direction, and ducks a miss", () => {
    const { context, gains, oscillators } = createMockAudioContext();
    const chart = createPulseChart(
      [createPracticeManifest({ reason: "audio feedback test" })],
      1,
    );
    const engine = new PulseAudioEngine(
      context,
      chart,
      createPulseState,
    );

    engine.start(0);
    engine.hit(1, 1, "good");
    expect(oscillators).toHaveLength(1);

    engine.hit(1, 1, "perfect");
    expect(oscillators).toHaveLength(3);

    engine.routeSwitch(-1, true);
    expect(oscillators).toHaveLength(5);
    engine.routeSwitch(1, false);
    expect(oscillators).toHaveLength(6);

    engine.miss("wrong");
    const master = gains[0].gain;
    expect(master.cancelAndHoldAtTime).toHaveBeenCalledWith(4);
    expect(master.linearRampToValueAtTime).toHaveBeenCalledWith(0.105, 4.02);
    expect(master.setTargetAtTime).toHaveBeenLastCalledWith(
      0.36,
      4.058,
      0.055,
    );
    engine.dispose();
  });
});

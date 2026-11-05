import { it, expect, vi, afterEach } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("plays a quiet upload chime and respects the shared mute preference", async () => {
  let muted = false;
  const start = vi.fn(),
    ramp = vi.fn();
  const oscillator = () => ({
    type: "sine",
    frequency: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start,
    stop: vi.fn(),
    onended: null,
  });
  const gain = () => ({
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: ramp,
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  vi.stubGlobal("localStorage", { getItem: () => (muted ? "off" : "on") });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = async () => {};
      createOscillator = oscillator;
      createGain = gain;
    },
  );
  const { unlockAudio, playConfirmation } = await import("./sound");
  unlockAudio();
  playConfirmation("uploaded");
  expect(start).toHaveBeenCalledTimes(3);
  expect(ramp).toHaveBeenCalledWith(0.035, expect.any(Number));
  muted = true;
  playConfirmation("uploaded");
  expect(start).toHaveBeenCalledTimes(3);
});

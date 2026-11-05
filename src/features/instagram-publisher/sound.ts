let audio: AudioContext | undefined;
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
  } catch {
    /* Sound is optional. */
  }
}
export function playConfirmation(kind: "scheduled" | "published" | "uploaded") {
  try {
    if (
      !audio ||
      audio.state !== "running" ||
      localStorage.getItem("ig-sound") === "off"
    )
      return;
    const now = audio.currentTime;
    (kind === "uploaded"
      ? [392, 587.33, 783.99]
      : kind === "published"
        ? [523.25, 659.25, 783.99]
        : [440, 587.33]
    ).forEach((frequency, index) => {
      const oscillator = audio!.createOscillator(),
        gain = audio!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.11);
      gain.gain.linearRampToValueAtTime(
        kind === "uploaded" ? 0.035 : 0.07,
        now + index * 0.11 + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.11 + 0.2);
      oscillator.connect(gain);
      gain.connect(audio!.destination);
      oscillator.start(now + index * 0.11);
      oscillator.stop(now + index * 0.11 + 0.22);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  } catch {
    /* A sound failure must never fail a publication. */
  }
}

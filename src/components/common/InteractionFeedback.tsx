import { useEffect } from "react";
import "./interaction-feedback.css";

/** Cursor movement belongs to the browser; audio starts only on user clicks. */
export function InteractionFeedback() {
  useEffect(() => {
    let audio: AudioContext | undefined;
    let lastClick = 0;
    const click = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      const now = performance.now();
      if (now - lastClick < 70) return;
      lastClick = now;
      try {
        const Context = window.AudioContext;
        if (!Context) return;
        audio ??= new Context();
        if (audio.state === "suspended") void audio.resume().catch(() => {});
        const start = audio.currentTime;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(125, start);
        oscillator.frequency.exponentialRampToValueAtTime(55, start + 0.065);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.075);
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + 0.08);
      } catch { /* Interaction must always work on browsers without audio. */ }
    };
    document.addEventListener("click", click, { passive: true });
    return () => { document.removeEventListener("click", click); if (audio) void audio.close().catch(() => {}); };
  }, []);
  return null;
}

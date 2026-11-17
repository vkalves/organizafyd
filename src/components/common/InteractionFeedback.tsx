import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./interaction-feedback.css";
/** Pointer movement stays exact; only changes in shape are animated. */
export function InteractionFeedback() {
  const cursorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor || !window.matchMedia) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let target: EventTarget | null = null;
    let x = 0;
    let y = 0;
    let frame = 0;
    let active = false;
    const hide = () => {
      active = false;
      target = null;
      root.removeAttribute("data-avanca-cursor");
      cursor.dataset.visible = "false";
      cursor.dataset.pressed = "false";
    };
    const inspect = (element: Element | null) => {
      // Read the original cursor before hiding it. Text, resize, drag and
      // disabled controls keep their native feedback, including in dialogs.
      root.removeAttribute("data-avanca-cursor");
      target = element;
      const native = element ? getComputedStyle(element).cursor : "none";
      active = fine.matches && !reduced.matches && ["auto", "default", "pointer"].includes(native);
      cursor.dataset.visible = String(active);
      if (active) {
        cursor.dataset.interactive = String(native === "pointer" || !!element?.closest(
          'a[href],button:not(:disabled),[role="button"]:not([aria-disabled="true"]),[role="tab"]:not([aria-disabled="true"]),[role="menuitem"]:not([aria-disabled="true"]),summary',
        ));
        root.setAttribute("data-avanca-cursor", "");
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches || reduced.matches) { hide(); return; }
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
      if (event.target !== target) inspect(event.target instanceof Element ? event.target : null);
    };
    const refresh = () => { if (active) inspect(document.elementFromPoint(x, y)); };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    const press = () => { cursor.dataset.pressed = "true"; };
    const release = () => { cursor.dataset.pressed = "false"; refresh(); };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", move, { passive: true });
    document.addEventListener("pointerout", leave, { passive: true });
    document.addEventListener("pointerdown", press, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", hide);
    document.addEventListener("scroll", refresh, { passive: true, capture: true });
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    fine.addEventListener("change", hide);
    reduced.addEventListener("change", hide);
    return () => {
      hide();
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", move);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", hide);
      document.removeEventListener("scroll", refresh, true);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
      fine.removeEventListener("change", hide);
      reduced.removeEventListener("change", hide);
    };
  }, []);
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
  return createPortal(<div ref={cursorRef} className="avanca-cursor" aria-hidden="true">
    <svg className="avanca-cursor-arrow" width="24" height="28" viewBox="0 0 24 28">
      <path d="M4 2L4 23L10 17L14 25L18 23L14 15L22 15Z" fill="#e9ecf6" stroke="#3f424a" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
    <span className="avanca-cursor-ring" />
  </div>, document.body);
}

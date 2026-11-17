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
      cancelAnimationFrame(frame);
      frame = 0;
      active = false;
      target = null;
      root.removeAttribute("data-avanca-cursor");
      cursor.dataset.visible = "false";
      cursor.dataset.pressed = "false";
    };
    const inspect = (element: Element | null) => {
      target = element;
      // The root flag stays stable throughout mouse use. Only read the hovered
      // element: never remove a page-wide CSS rule to discover its native cursor.
      const native = element ? getComputedStyle(element).cursor : "auto";
      const disabled = element?.closest(':disabled,[aria-disabled="true"]');
      active = !disabled && ["none", "auto", "default"].includes(native);
      const interactive = !!element?.closest(
        'a[href],button,[role="button"],[role="tab"],[role="menuitem"],summary,select,label[for],label:has(input),input[type="checkbox"],input[type="radio"],.cursor-pointer',
      );
      if (cursor.dataset.visible !== String(active)) cursor.dataset.visible = String(active);
      if (cursor.dataset.interactive !== String(interactive)) cursor.dataset.interactive = String(interactive);
    };
    let nextTarget: Element | null = null;
    let hitTest = false;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (hitTest) { nextTarget = document.elementFromPoint(x, y); hitTest = false; }
        // Activate once on entry, rather than invalidating the whole document
        // on every pointerover. CSS preserves native text/resize/drag cursors.
        if (!root.hasAttribute("data-avanca-cursor")) root.setAttribute("data-avanca-cursor", "");
        if (nextTarget !== target) inspect(nextTarget);
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches || reduced.matches) { hide(); return; }
      x = event.clientX;
      y = event.clientY;
      nextTarget = event.target instanceof Element ? event.target : null;
      schedule();
    };
    const refresh = () => {
      if (!root.hasAttribute("data-avanca-cursor")) return;
      target = null;
      hitTest = true;
      schedule();
    };
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

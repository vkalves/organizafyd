import { ChessMark } from "@/components/layout/ChessMark";
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import "./welcome-animation.css";

/** The 3D piece and wordmark appear over the app, with no loading screen. */
export function WelcomeAnimation() {
  const [visible, setVisible] = useState(() => window.location.pathname.replace(/\/+$/, "") !== "/instagram/conectar");
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (!visible) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Start the presentation clock once the actual model has rendered.
    const timer = window.setTimeout(() => setVisible(false), ready ? reduced ? 600 : 3000 : 7000);
    return () => window.clearTimeout(timer);
  }, [visible, ready]);
  return <Dialog.Root open={visible} onOpenChange={setVisible}>
    <Dialog.Portal>
      <Dialog.Content className="welcome-stage" data-ready={ready}>
        <div className="welcome-stage-emblem"><ChessMark animated onReady={onReady} /></div>
        <Dialog.Title className="welcome-stage-title">AVANÇA</Dialog.Title>
        <Dialog.Description className="sr-only">Sua próxima jogada começa aqui.</Dialog.Description>
        <Dialog.Close className="welcome-stage-skip" aria-label="Pular apresentação">Pular</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

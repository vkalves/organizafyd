import { useEffect, useState, useRef } from "react";
import { Plus, ExternalLink, Copy, QrCode, Clock, ArrowLeft, Loader2, Check } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { MetaApp, MetaConfig } from "@/features/meta-developer/meta-apps";
import { loginRequest } from "./login";
import { openBrowserLogin } from "./browser-login";

export function ConnectAccount({
  onConnected: _onConnected,
  className,
  appId,
  variant = "outline",
  size = "sm",
}: {
  onConnected: (id: string) => Promise<void>;
  className?: string;
  appId?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Conectar conta
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[92vh] overflow-y-auto max-w-[460px] p-0 border border-white/10 bg-[#12151c] text-white rounded-[24px] shadow-2xl focus:outline-none"
        >
          {open && <ConnectAccountModalContent appId={appId} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectAccountModalContent({ onClose, appId }: { onClose: () => void; appId?: string }) {
  const [view, setView] = useState<"menu" | "qr">("menu");
  const [apps, setApps] = useState<MetaApp[]>([]);
  const [selectedApp, setSelectedApp] = useState(appId || "");
  const [ready, setReady] = useState<boolean | null>(null);
  const [platformReady, setPlatformReady] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(600); // 10 minutes
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Check backend readiness
  useEffect(() => {
    loginRequest<MetaConfig>("config")
      .then((config) => {
        const activeApps = (config.apps || []).filter((app) => app.active);
        setApps(activeApps);
        setPlatformReady(!!config.platformReady);
        setSelectedApp((current) =>
          activeApps.find((app) => app.id === current)?.id ?? activeApps[0]?.id ?? "",
        );
        setReady(config.ready);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao consultar configuração"));
  }, []);

  // Timer countdown for QR view
  useEffect(() => {
    if (view === "qr") {
      setSecondsLeft(600);
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [view]);

  // Helper to fetch authorization invite link
  async function generateInviteUrl(): Promise<string> {
    const data = await loginRequest<{ url: string }>("invite", {
      app_id: selectedApp || null,
    });
    return data.url;
  }

  // Continue in the same tab on mobile; reserve the desktop popup on the click.
  async function handleOpenPopup() {
    if (ready === false) {
      toast.error("Conexão aguardando ativação no servidor.");
      return;
    }
    setBusyAction("popup");
    setError("");
    try {
      const target = await openBrowserLogin(async () => {
        const url = new URL(await generateInviteUrl());
        const params = new URLSearchParams(url.hash.slice(1)); params.set("direct", "1");
        url.hash = params.toString(); return url.toString();
      });
      if (target === "popup") {
        toast.success("Janela de login aberta. Conclua a autorização na Meta.");
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar link";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  // 2. Copiar link para outro navegador (Multilogin / AdsPower / Dolphin / etc.)
  async function handleCopyLink() {
    if (ready === false) {
      toast.error("Conexão aguardando ativação no servidor.");
      return;
    }
    setBusyAction("copy");
    setError("");
    try {
      const inviteUrl = await generateInviteUrl();
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Link copiado para a área de transferência!");
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao copiar link";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  // 3. Abrir no celular (QR Code)
  async function handleOpenQr() {
    if (ready === false) {
      toast.error("Conexão aguardando ativação no servidor.");
      return;
    }
    setBusyAction("qr");
    setError("");
    try {
      const inviteUrl = await generateInviteUrl();
      const qrImage = await QRCode.toDataURL(inviteUrl, {
        width: 240,
        margin: 1.5,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setQrDataUrl(qrImage);
      setView("qr");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar QR Code";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  }

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className="p-6">
      {/* Hidden accessible title/desc for Radix Dialog */}
      <DialogHeader className="sr-only">
        <DialogTitle>Conectar Instagram</DialogTitle>
        <DialogDescription>
          Escolha como deseja autorizar a conexão com sua conta do Instagram.
        </DialogDescription>
      </DialogHeader>

      {view === "menu" ? (
        <div>
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-6">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(221,42,123,0.45)]"
              style={{
                background: "linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #8134af 100%)",
              }}
            >
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight leading-tight">
                Conectar Instagram
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">Escolha como deseja autorizar</p>
            </div>
          </div>

          {/* Warning if server not configured */}
          {ready === false && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/40 p-3 text-xs text-amber-300">
              A conexão com o Instagram não está disponível no momento. Tente novamente mais tarde.
            </div>
          )}

          {apps.length > 0 ? (
            <label className="mb-4 block text-xs text-neutral-300">
              App para esta conexão
              <select
                className="mt-2 w-full rounded-lg border border-white/15 bg-[#161922] p-3"
                value={selectedApp}
                onChange={(event) => setSelectedApp(event.target.value)}
                disabled={busyAction !== null}
              >
                {apps.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name} · {app.configId ? "Login Unificado" : "Instagram Login"}
                  </option>
                ))}
                {platformReady && <option value="">Conexão padrão da plataforma</option>}
              </select>
            </label>
          ) : platformReady && (
            <p className="mb-4 text-xs text-neutral-300">Conexão padrão da plataforma</p>
          )}
          <p role="note" className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-200">
            <strong>Convite pendente?</strong> Aceite no Instagram pelo computador ou navegador em modo desktop antes de conectar. O app do celular pode não mostrar o convite.
          </p>
          {/* Options List */}
          <div className="space-y-3">
            {/* 1. Popup neste navegador */}
            <button
              type="button"
              disabled={busyAction !== null || ready !== true}
              onClick={() => void handleOpenPopup()}
              className="w-full text-left rounded-xl p-4 flex items-start gap-3.5 bg-[#161922] hover:bg-[#1c212c] border border-white/10 hover:border-white/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group active:scale-[0.99]"
            >
              <div className="p-1 text-sky-400 shrink-0 mt-0.5 group-hover:text-sky-300">
                {busyAction === "popup" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <ExternalLink className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-white leading-tight">
                  Continuar neste navegador
                </div>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  No celular, a autorização continua nesta mesma aba. Na Meta, escolha o perfil que deseja conectar.
                </p>
              </div>
            </button>

            {/* 2. Copiar link para outro navegador */}
            <button
              type="button"
              disabled={busyAction !== null || ready !== true}
              onClick={() => void handleCopyLink()}
              className="w-full text-left rounded-xl p-4 flex items-start gap-3.5 bg-[#161922] hover:bg-[#1c212c] border border-white/10 hover:border-white/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group active:scale-[0.99]"
            >
              <div className="p-1 text-sky-400 shrink-0 mt-0.5 group-hover:text-sky-300">
                {busyAction === "copy" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : copied ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-white leading-tight flex items-center justify-between">
                  <span>Copiar link para outro navegador</span>
                  {copied && (
                    <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      Copiado!
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  Gera link pra colar em Multilogin / AdsPower / Dolphin / outro perfil. Ideal pra
                  conectar conta IG de cliente sem mexer no seu login.
                </p>
              </div>
            </button>

            {/* 3. Abrir no celular (QR Code) */}
            <button
              type="button"
              disabled={busyAction !== null || ready !== true}
              onClick={() => void handleOpenQr()}
              className="w-full text-left rounded-xl p-4 flex items-start gap-3.5 bg-[#161922] hover:bg-[#1c212c] border border-white/10 hover:border-white/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group active:scale-[0.99]"
            >
              <div className="p-1 text-sky-400 shrink-0 mt-0.5 group-hover:text-sky-300">
                {busyAction === "qr" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <QrCode className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-white leading-tight">
                  Abrir no celular (QR Code)
                </div>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  Autorize pelo navegador do celular. Se houver convite pendente, aceite antes pelo computador ou em modo desktop.
                </p>
              </div>
            </button>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive mt-3">
              {error}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-5 pt-3 border-t border-white/10">
            <div className="flex items-center gap-1.5 text-xs text-neutral-400">
              <Clock className="w-3.5 h-3.5 text-neutral-300" />
              <span>Link válido por 10 minutos</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium text-neutral-300 bg-[#161922] hover:bg-[#1e2330] border border-white/10 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        /* QR Code Sub-View */
        <div className="text-center py-2">
          <h3 className="text-base font-bold text-white mb-1">Escanear com o Celular</h3>
          <p className="text-xs text-neutral-400 mb-4 max-w-xs mx-auto">
            Abra o link no navegador do celular para autorizar. Aceite convites pendentes antes, pelo computador ou em modo desktop.
          </p>

          {/* QR Code Container */}
          <div className="inline-block bg-white p-3 rounded-2xl shadow-xl border border-neutral-200 mb-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code Instagram Connect"
                className="w-48 h-48 block mx-auto rounded-lg"
              />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-neutral-600" />
              </div>
            )}
          </div>

          <p className="text-xs text-neutral-400 max-w-xs mx-auto mb-4">
            O código expira em{" "}
            <span className="text-white font-medium">{formatTimer(secondsLeft)}</span>. Assim que
            autorizar no celular, o sistema atualizará automaticamente.
          </p>

          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-300 bg-[#161922] hover:bg-[#1e2330] border border-white/10 px-4 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar para opções
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-neutral-400 hover:text-white px-3 py-2 transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

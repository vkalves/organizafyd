import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Post } from "./model";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { listPosts } from "./api";
import { unlockAudio, playConfirmation } from "./sound";
export function PublicationFeedback() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["instagram-publisher", user?.id],
    queryFn: () => listPosts(user!.id),
    enabled: !!user,
    refetchInterval: 30000,
  });
  return <PublicationSound posts={query.data} userId={user?.id ?? ""} />;
}
export function PublicationSound({
  posts,
  userId,
}: {
  posts?: Post[];
  userId: string;
}) {
  const previous = useRef<Map<string, string>>();
  const owner = useRef(userId);
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("ig-sound") !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const activate = () => unlockAudio();
    window.addEventListener("pointerdown", activate, { once: true });
    window.addEventListener("keydown", activate, { once: true });
    return () => {
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
    };
  }, []);
  useEffect(() => {
    if (owner.current !== userId) {
      previous.current = undefined;
      owner.current = userId;
    }
    if (!posts) return;
    const confirmed = posts.filter(
      (p) =>
        p.status === "published" &&
        previous.current?.has(p.id) &&
        previous.current.get(p.id) !== "published",
    );
    if (confirmed.length) {
      if (enabled) playConfirmation("published");
      toast.success(
        `${confirmed.length} publicação(ões) confirmada(s) pelo Instagram.`,
      );
    }
    previous.current = new Map(posts.map((p) => [p.id, p.status]));
  }, [posts, enabled, userId]);
  return (
    <button
      type="button"
      className="shell-icon-button"
      title={enabled ? "Silenciar confirmações" : "Ativar sons de confirmação"}
      aria-pressed={enabled}
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        try {
          localStorage.setItem("ig-sound", next ? "on" : "off");
        } catch {
          /* Local preferences may be unavailable. */
        }
        unlockAudio();
        if (next) playConfirmation("scheduled");
      }}
    >
      {enabled ? (
        <Volume2 size={18} aria-hidden="true" />
      ) : (
        <VolumeX size={18} aria-hidden="true" />
      )}
      <span className="sr-only">Som: {enabled ? "ativado" : "desativado"}</span>
    </button>
  );
}

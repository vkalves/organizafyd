import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { HotfyDashboard, type InstagramView } from "./HotfyDashboard";
import { listAccounts, listPosts, connections } from "./api";
import { useInstagramMonitor } from "./InstagramAlerts";
import { monitorRequest } from "./monitor";
import { ConnectAccount } from "./ConnectAccount";
import { toast } from "sonner";
import "./hotfy-dashboard.css";
export function InstagramOverview() {
  const { user } = useAuth(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const monitor = useInstagramMonitor(),
    [reading, setReading] = useState(false);
  const accounts = useQuery({
    queryKey: ["instagram-publisher-accounts", user?.id],
    queryFn: () => listAccounts(user!.id),
    enabled: !!user,
  });
  const posts = useQuery({
    queryKey: ["instagram-publisher", user?.id],
    queryFn: () => listPosts(user!.id),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const links = useQuery({
    queryKey: ["ig-connections", user?.id],
    queryFn: connections,
    enabled: !!user,
    refetchInterval: 30000,
  });
  function go(view: InstagramView, format?: "Reel" | "Story") {
    navigate(`/instagram?view=${view}${format ? "&format=" + format : ""}`);
  }
  return (
    <section
      aria-label="Visão geral do Instagram"
      className="ig-hotfy !max-w-none"
    >
      <div className="ig-panel-head">
        <div>
          <p className="page-eyebrow">Dashboard principal</p>
          <h2 className="mt-2 text-xl font-medium">
            Sua operação no Instagram
          </h2>
        </div>
        <button className="ig-pill" onClick={() => go("flows")}>
          Abrir Instagram →
        </button>
      </div>
      <HotfyDashboard
        accounts={accounts.data ?? []}
        posts={posts.data ?? []}
        connections={links.data ?? []}
        monitor={monitor.data}
        loading={accounts.isLoading || posts.isLoading}
        failed={accounts.isError || posts.isError}
        monitorFailed={monitor.isError}
        view="dashboard"
        go={go}
        connect={
          <ConnectAccount
            onConnected={async () => {
              await cache.invalidateQueries({
                queryKey: ["instagram-publisher-accounts", user?.id],
              });
              await links.refetch();
            }}
          />
        }
        reading={reading}
        markRead={(id) => {
          setReading(true);
          void monitorRequest("read", id)
            .then(() => monitor.refetch())
            .catch(() => toast.error("Não foi possível marcar o alerta."))
            .finally(() => setReading(false));
        }}
      />
    </section>
  );
}

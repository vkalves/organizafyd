import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { monitorRequest, healthLabels } from './monitor';
export function useInstagramMonitor() {
 const { user } = useAuth();
 return useQuery({ queryKey: ['instagram-monitor', user?.id], queryFn: () => monitorRequest(), enabled: !!user, refetchInterval: 30000, retry: 1 });
}
export function InstagramAlerts() {
 const { user } = useAuth();
 const monitor = useInstagramMonitor();
 const shown = useRef(new Set<string>());
 const currentUser = useRef(user?.id);
 useEffect(() => {
  if (currentUser.current !== user?.id) { shown.current.clear(); currentUser.current = user?.id; }
  const alerts = monitor.data?.alerts.filter(a => !a.read_at && !a.resolved_at) ?? [];
  const fresh = alerts.filter(a => !shown.current.has(a.id));
  for (const a of fresh) shown.current.add(a.id);
  if (fresh.length) toast.warning(fresh.length === 1 ? `Instagram: ${healthLabels[fresh[0].state]}` : `${fresh.length} novos alertas do Instagram`, { id: 'instagram-health-alerts', description: 'Abra o sino para ver as contas afetadas.', duration: 8000 });
 }, [monitor.data, user?.id]);
 const count = monitor.data?.alerts.filter(a => !a.read_at && !a.resolved_at).length ?? 0;

 return <Link to="/avanca/alertas" className="shell-icon-button relative" aria-label={monitor.isError ? 'Alertas do Instagram: monitoramento indisponível' : `Alertas do Instagram: ${count} não lidos`} title="Alertas do Instagram"><Bell className="h-4 w-4" />{(count > 0 || monitor.isError) && <span className=" -right-0.5 -top-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{monitor.isError ? '!' : count}</span>}</Link>;
}

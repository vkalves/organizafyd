import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { monitorRequest, healthLabels } from './monitor';
import { playConfirmation } from './sound';
function previousNotifications(userId?: string) {
 try { const ids = JSON.parse(localStorage.getItem(`avanca:notifications-shown:${userId}`) || '[]'); return new Set<string>(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []); } catch { return new Set<string>(); }
}
export function useInstagramMonitor() {
 const { user } = useAuth();
 return useQuery({ queryKey: ['instagram-monitor', user?.id], queryFn: () => monitorRequest(), enabled: !!user, refetchInterval: 30000, retry: 1 });
}
export function InstagramAlerts() {
 const { user } = useAuth();
 const monitor = useInstagramMonitor();
 const shown = useRef(previousNotifications(user?.id));
 const currentUser = useRef(user?.id);
 useEffect(() => {
  if (currentUser.current !== user?.id) { shown.current = previousNotifications(user?.id); currentUser.current = user?.id; }
  const alerts = monitor.data?.alerts.filter(a => !a.read_at && !a.resolved_at) ?? [];
  const fresh = alerts.filter(a => !shown.current.has(a.id));
  for (const a of fresh) shown.current.add(a.id);
  if (fresh.length) {
    try { localStorage.setItem(`avanca:notifications-shown:${user?.id}`, JSON.stringify(alerts.map(a => a.id))); } catch { /* The current session still deduplicates notifications. */ }
    playConfirmation('alert');
    toast.warning(fresh.length === 1 ? `Instagram: ${healthLabels[fresh[0].state]}` : `${fresh.length} novas notificações do Instagram`, { id: 'instagram-health-alerts', description: 'Abra o sino para ver as contas afetadas.', duration: 8000 });
  }
 }, [monitor.data, user?.id]);
 const count = monitor.data?.alerts.filter(a => !a.read_at && !a.resolved_at).length ?? 0;

 return <Link to="/avanca/alertas" className="shell-icon-button relative" aria-label={monitor.isError ? 'Notificações do Instagram: monitoramento indisponível' : `Notificações do Instagram: ${count} não lidos`} title="Notificações do Instagram"><Bell className="h-4 w-4" />{(count > 0 || monitor.isError) && <span className=" -right-0.5 -top-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{monitor.isError ? '!' : count}</span>}</Link>;
}

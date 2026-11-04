export type HealthState = 'unknown' | 'healthy' | 'reconnect' | 'permissions' | 'unavailable' | 'temporary';
export function classify(code?: number, httpStatus = 200): HealthState {
  if (code === 190 || code === 102) return 'reconnect';
  if (code === 10 || code === 200) return 'permissions';
  if (httpStatus === 429 || httpStatus >= 500 || [1, 2, 4, 17, 32, 613].includes(code ?? 0)) return 'temporary';
  return 'unavailable';
}
export function transition(previous: { state: HealthState; candidate: HealthState; failures: number }, result: HealthState) {
  const failures = result === 'healthy' ? 0 : previous.candidate === result ? previous.failures + 1 : 1;
  const threshold = result === 'temporary' ? 3 : result === 'unavailable' ? 2 : 1;
  return { state: failures >= threshold || result === 'healthy' ? result : previous.state, candidate: result, failures };
}

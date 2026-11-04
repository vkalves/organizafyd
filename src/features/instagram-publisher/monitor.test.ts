import { describe, it, expect } from 'vitest';
import { classify, transition } from '../../../supabase/functions/instagram-monitor/health';
const initial = { state: 'healthy' as const, candidate: 'healthy' as const, failures: 0 };
describe('Instagram account monitoring', () => {
 it('distinguishes invalid credentials, permissions, API throttling and inaccessible profiles', () => {
  expect(classify(190,400)).toBe('reconnect');
  expect(classify(200,403)).toBe('permissions');
  expect(classify(4,400)).toBe('temporary');
  expect(classify(undefined,503)).toBe('temporary');
  expect(classify(100,400)).toBe('unavailable');
 });
 it('requires two matching inaccessible-profile checks and resets on recovery', () => {
  const first=transition(initial,'unavailable'); expect(first.state).toBe('healthy');
  const second=transition(first,'unavailable'); expect(second.state).toBe('unavailable');
  expect(transition(second,'healthy')).toEqual({state:'healthy',candidate:'healthy',failures:0});
 });
 it('does not combine different errors or label a transient outage as a dropped account', () => {
  const first=transition(initial,'unavailable');
  const second=transition(first,'temporary'); expect(second.failures).toBe(1);
  const third=transition(second,'temporary'); expect(third.state).toBe('healthy');
  expect(transition(third,'temporary').state).toBe('temporary');
 });
 it('immediately flags credentials requiring reconnection', () => expect(transition(initial,'reconnect').state).toBe('reconnect'));
});

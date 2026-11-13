import { describe, expect, it } from 'vitest';
import { connectionSiteOrigin, integrationOrigins } from '../../../supabase/functions/_shared/integration-origins';
describe('integration origin policy', () => {
  it('allows exact ASCII, internationalized, existing and Zyon hosts', () => {
    const origins = integrationOrigins();
    for (const value of ['https://avanca.online','https://xn--avana-1ra.online','https://www.organizafy.site','https://zyon-control-studio.adventurouswarbler3.chatgpt.site']) expect(origins.has(value)).toBe(true);
    expect(origins.has('https://avanca.online.attacker.example')).toBe(false);
    expect(origins.has('https://avanca.online/path')).toBe(false);
    expect(origins.has('null')).toBe(false);
  });
  it('preserves legacy callback default and supports explicit server configuration', () => {
    expect(connectionSiteOrigin()).toBe('https://www.organizafy.site');
    expect(connectionSiteOrigin('https://avanca.online/')).toBe('https://avanca.online');
    expect(integrationOrigins('https://integration.example','https://callback.example').has('https://callback.example')).toBe(true);
  });
  it.each(['http://avanca.online','https://user:secret@avanca.online','https://avanca.online/path','https://avanca.online?redirect=other','https://avanca.online#fragment','https://*.example.com','https://example.com:8443'])('rejects unsafe server origin %s', value => {
    expect(()=>connectionSiteOrigin(value)).toThrow('invalid_integration_origin');
  });
});

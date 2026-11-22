export interface CognitoVerifyOptions {
  region: string;
  userPoolId: string;
  clientId?: string;
  fetch?: typeof fetch;
}

export interface VerifiedCognitoUser {
  id: string;
  email?: string;
  cognitoSub: string;
  displayName?: string;
  claims: Record<string, unknown>;
}

interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

const jwksCache = new Map<string, { fetchedAt: number; keys: Map<string, CryptoKey> }>();

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJsonPart(part: string): Record<string, any> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
  } catch {
    return null;
  }
}

async function getCognitoPublicKey(
  issuer: string,
  kid: string,
  fetcher: typeof fetch,
): Promise<CryptoKey | null> {
  const cached = jwksCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < 3600_000 && cached.keys.has(kid)) {
    return cached.keys.get(kid)!;
  }

  const response = await fetcher(`${issuer}/.well-known/jwks.json`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { keys?: JwkKey[] };
  if (!Array.isArray(payload.keys)) return null;

  const keyMap = new Map<string, CryptoKey>();
  for (const jwk of payload.keys) {
    if (jwk.kty === "RSA" && jwk.kid) {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keyMap.set(jwk.kid, cryptoKey);
    }
  }

  jwksCache.set(issuer, { fetchedAt: Date.now(), keys: keyMap });
  return keyMap.get(kid) || null;
}

export async function verifyCognitoJwt(
  token: string,
  options: CognitoVerifyOptions,
): Promise<VerifiedCognitoUser | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = decodeJsonPart(parts[0]);
  const payload = decodeJsonPart(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") {
    return null;
  }

  const expectedIssuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;
  if (payload.iss !== expectedIssuer) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (!["id", "access"].includes(String(payload.token_use))) return null;

  if (options.clientId) {
    const tokenClient = payload.aud || payload.client_id;
    if (tokenClient !== options.clientId) return null;
  }

  const fetcher = options.fetch || fetch;
  const key = await getCognitoPublicKey(expectedIssuer, header.kid, fetcher);
  if (!key) return null;

  const signedContent = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedContent);
  if (!valid) return null;

  const cognitoSub = String(payload.sub || "");
  if (!cognitoSub) return null;
  const userId = String(payload["custom:user_id"] || cognitoSub);

  return {
    id: userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
    cognitoSub,
    displayName:
      typeof payload["custom:display_name"] === "string"
        ? payload["custom:display_name"]
        : typeof payload.name === "string"
          ? payload.name
          : undefined,
    claims: payload,
  };
}

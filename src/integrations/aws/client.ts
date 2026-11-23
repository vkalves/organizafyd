import type { Database } from "@/integrations/supabase/types";
import { withUploadTimeout } from "@/lib/storage/upload-fetch";

export interface AwsUser {
  id: string;
  email?: string;
  aud: string;
  role?: string;
  created_at?: string;
  updated_at?: string;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
}

export interface AwsSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  user: AwsUser;
}

export interface AwsAuthError {
  message: string;
  status?: number;
  code?: string;
  name?: string;
}

export interface AwsClientConfig {
  apiUrl: string;
  clientKey?: string;
  region?: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  storage?: Storage;
  fetch?: typeof fetch;
}

const SESSION_STORAGE_KEY = "avanca.aws.auth.session";

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function userFromCognitoClaims(claims: Record<string, any>, fallbackEmail?: string): AwsUser {
  const id = String(claims["custom:user_id"] || claims.sub || "");
  const email = String(claims.email || fallbackEmail || "");
  const displayName = claims["custom:display_name"] || claims.name || claims.preferred_username;
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : new Date().toISOString(),
    user_metadata: {
      ...(displayName ? { display_name: displayName } : {}),
      ...(email ? { email } : {}),
    },
    app_metadata: {
      provider: "cognito",
      cognito_sub: claims.sub,
    },
  };
}

class PostgrestQueryBuilder<T = any> implements PromiseLike<{ data: T | null; error: any; count?: number | null; status: number }> {
  private method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  private params = new URLSearchParams();
  private bodyPayload: unknown = undefined;
  private extraHeaders: Record<string, string> = {};
  private expectSingle = false;
  private expectMaybeSingle = false;

  constructor(
    private readonly baseUrl: string,
    private readonly table: string,
    private readonly getHeaders: () => Promise<Record<string, string>>,
    private readonly customFetch: typeof fetch,
  ) {}

  select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.method === "GET") {
      this.params.set("select", columns);
    } else {
      this.params.set("select", columns);
      this.appendPrefer("return=representation");
    }
    if (options?.count) {
      this.appendPrefer(`count=${options.count}`);
    }
    return this;
  }

  insert(values: unknown, options?: { count?: "exact" | "planned" | "estimated" }) {
    this.method = "POST";
    this.bodyPayload = values;
    this.appendPrefer("return=representation");
    if (options?.count) this.appendPrefer(`count=${options.count}`);
    return this;
  }

  update(values: unknown, options?: { count?: "exact" | "planned" | "estimated" }) {
    this.method = "PATCH";
    this.bodyPayload = values;
    this.appendPrefer("return=representation");
    if (options?.count) this.appendPrefer(`count=${options.count}`);
    return this;
  }

  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean; count?: "exact" | "planned" | "estimated" }) {
    this.method = "POST";
    this.bodyPayload = values;
    this.appendPrefer("return=representation");
    this.appendPrefer(
      options?.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates",
    );
    if (options?.onConflict) {
      this.params.set("on_conflict", options.onConflict);
    }
    if (options?.count) this.appendPrefer(`count=${options.count}`);
    return this;
  }

  delete(options?: { count?: "exact" | "planned" | "estimated" }) {
    this.method = "DELETE";
    if (options?.count) this.appendPrefer(`count=${options.count}`);
    return this;
  }

  eq(column: string, value: unknown) {
    this.params.append(column, `eq.${String(value)}`);
    return this;
  }

  neq(column: string, value: unknown) {
    this.params.append(column, `neq.${String(value)}`);
    return this;
  }

  gt(column: string, value: unknown) {
    this.params.append(column, `gt.${String(value)}`);
    return this;
  }

  gte(column: string, value: unknown) {
    this.params.append(column, `gte.${String(value)}`);
    return this;
  }

  lt(column: string, value: unknown) {
    this.params.append(column, `lt.${String(value)}`);
    return this;
  }

  lte(column: string, value: unknown) {
    this.params.append(column, `lte.${String(value)}`);
    return this;
  }

  like(column: string, pattern: string) {
    this.params.append(column, `like.${pattern}`);
    return this;
  }

  ilike(column: string, pattern: string) {
    this.params.append(column, `ilike.${pattern}`);
    return this;
  }

  is(column: string, value: null | boolean) {
    this.params.append(column, `is.${String(value)}`);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const serialized = values
      .map((v) => {
        const s = String(v);
        return /[,()"\\\s]/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;
      })
      .join(",");
    this.params.append(column, `in.(${serialized})`);
    return this;
  }

  contains(column: string, value: unknown) {
    const formatted = Array.isArray(value)
      ? `{${value.map((x) => String(x)).join(",")}}`
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
    this.params.append(column, `cs.${formatted}`);
    return this;
  }

  containedBy(column: string, value: unknown) {
    const formatted = Array.isArray(value)
      ? `{${value.map((x) => String(x)).join(",")}}`
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
    this.params.append(column, `cd.${formatted}`);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.params.append(column, `not.${operator}.${String(value)}`);
    return this;
  }

  or(filters: string, options?: { foreignTable?: string }) {
    const key = options?.foreignTable ? `${options.foreignTable}.or` : "or";
    this.params.append(key, `(${filters})`);
    return this;
  }

  filter(column: string, operator: string, value: unknown) {
    this.params.append(column, `${operator}.${String(value)}`);
    return this;
  }

  match(query: Record<string, unknown>) {
    for (const [k, v] of Object.entries(query)) {
      this.eq(k, v);
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string }) {
    const key = options?.foreignTable ? `${options.foreignTable}.order` : "order";
    const dir = options?.ascending === false ? "desc" : "asc";
    const nulls = options?.nullsFirst === undefined ? "" : options.nullsFirst ? ".nullsfirst" : ".nullslast";
    const existing = this.params.get(key);
    const clause = `${column}.${dir}${nulls}`;
    this.params.set(key, existing ? `${existing},${clause}` : clause);
    return this;
  }

  limit(count: number, options?: { foreignTable?: string }) {
    const key = options?.foreignTable ? `${options.foreignTable}.limit` : "limit";
    this.params.set(key, String(count));
    return this;
  }

  range(from: number, to: number) {
    this.params.set("offset", String(from));
    this.params.set("limit", String(Math.max(0, to - from + 1)));
    this.extraHeaders["Range-Unit"] = "items";
    this.extraHeaders["Range"] = `${from}-${to}`;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this;
  }

  maybeSingle() {
    this.expectMaybeSingle = true;
    return this;
  }

  private appendPrefer(value: string) {
    const current = this.extraHeaders["Prefer"];
    if (!current) {
      this.extraHeaders["Prefer"] = value;
    } else if (!current.split(",").map((s) => s.trim()).includes(value)) {
      this.extraHeaders["Prefer"] = `${current},${value}`;
    }
  }

  private async execute(): Promise<{ data: T | null; error: any; count?: number | null; status: number }> {
    const headers = { ...(await this.getHeaders()), ...this.extraHeaders };
    if (this.expectSingle) {
      headers["Accept"] = "application/vnd.pgrst.object+json";
    }
    const qs = this.params.toString();
    const url = `${this.baseUrl}/rest/v1/${encodeURIComponent(this.table)}${qs ? `?${qs}` : ""}`;
    try {
      const response = await this.customFetch(url, {
        method: this.method,
        headers,
        body: this.bodyPayload !== undefined ? JSON.stringify(this.bodyPayload) : undefined,
      });
      const text = await response.text();
      const parsed = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

      if (!response.ok) {
        return {
          data: null,
          error: {
            message: parsed?.message || parsed?.error || `HTTP ${response.status}`,
            code: parsed?.code || String(response.status),
            details: parsed?.details || null,
            hint: parsed?.hint || null,
          },
          status: response.status,
        };
      }

      let data: any = parsed;
      if (this.expectSingle) {
        if (Array.isArray(parsed)) {
          if (parsed.length !== 1) {
            return {
              data: null,
              error: {
                message: parsed.length === 0 ? "JSON object requested, multiple (or no) rows returned" : "Multiple rows returned",
                code: "PGRST116",
              },
              status: 406,
            };
          }
          data = parsed[0];
        }
      } else if (this.expectMaybeSingle) {
        if (Array.isArray(parsed)) {
          if (parsed.length > 1) {
            return {
              data: null,
              error: { message: "Multiple rows returned", code: "PGRST116" },
              status: 406,
            };
          }
          data = parsed[0] ?? null;
        }
      }

      const contentRange = response.headers.get("content-range");
      const count = contentRange && contentRange.includes("/")
        ? Number(contentRange.split("/")[1]) || null
        : null;

      return { data: data as T, error: null, count, status: response.status };
    } catch (err) {
      return {
        data: null,
        error: {
          message: err instanceof Error ? err.message : "Network error",
          code: "NETWORK_ERROR",
        },
        status: 0,
      };
    }
  }

  then<TResult1 = { data: T | null; error: any; count?: number | null; status: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: T | null; error: any; count?: number | null; status: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createAwsClient<DB = Database>(config: AwsClientConfig) {
  const baseUrl = (config.apiUrl || "").replace(/\/$/, "");
  const clientKey = config.clientKey || config.cognitoClientId || "aws-cognito-public-client";
  const region = config.region || "us-east-2";
  const cognitoClientId = config.cognitoClientId || "";
  const customFetch = config.fetch || ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const storageBackend = config.storage || (typeof localStorage !== "undefined" ? localStorage : undefined);

  const listeners = new Set<(event: string, session: AwsSession | null) => void>();

  const readStoredSession = (): AwsSession | null => {
    if (!storageBackend) return null;
    try {
      const raw = storageBackend.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AwsSession;
      if (!parsed?.access_token || !parsed?.user?.id) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeStoredSession = (session: AwsSession | null, event?: string) => {
    if (storageBackend) {
      try {
        if (session) {
          storageBackend.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
        } else {
          storageBackend.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        // Ignore storage quota errors in restricted environments
      }
    }
    if (event) {
      for (const listener of listeners) {
        try {
          listener(event, session);
        } catch {
          // Listener failure must not break auth flow
        }
      }
    }
  };

  const cognitoRpc = async (target: string, payload: Record<string, unknown>) => {
    const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;
    const response = await customFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        data: null,
        error: {
          message: data.message || data.__type || "Falha na autenticação AWS Cognito.",
          code: data.__type || String(response.status),
          status: response.status,
        } as AwsAuthError,
      };
    }
    return { data, error: null };
  };

  const refreshSessionIfNeeded = async (current: AwsSession | null): Promise<AwsSession | null> => {
    if (!current) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (current.expires_at && current.expires_at > nowSec + 30) {
      return current;
    }
    if (!current.refresh_token) return current;

    try {
      if (cognitoClientId) {
        const { data, error } = await cognitoRpc("InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: cognitoClientId,
          AuthParameters: {
            REFRESH_TOKEN: current.refresh_token,
          },
        });
        if (error || !data?.AuthenticationResult) {
          writeStoredSession(null, "SIGNED_OUT");
          return null;
        }
        const authResult = data.AuthenticationResult;
        const token = authResult.IdToken || authResult.AccessToken;
        const claims = decodeJwtPayload(token) || {};
        const expiresIn = Number(authResult.ExpiresIn || 3600);
        const refreshed: AwsSession = {
          access_token: token,
          refresh_token: authResult.RefreshToken || current.refresh_token,
          token_type: "bearer",
          expires_in: expiresIn,
          expires_at: Math.floor(Date.now() / 1000) + expiresIn,
          user: claims.sub ? userFromCognitoClaims(claims, current.user.email) : current.user,
        };
        writeStoredSession(refreshed, "TOKEN_REFRESHED");
        return refreshed;
      }

      if (!baseUrl) return current;
      const response = await customFetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: clientKey,
        },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!response.ok) {
        writeStoredSession(null, "SIGNED_OUT");
        return null;
      }
      const data = await response.json();
      const expiresIn = Number(data.expires_in || 3600);
      const refreshed: AwsSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || current.refresh_token,
        token_type: "bearer",
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        user: data.user || current.user,
      };
      writeStoredSession(refreshed, "TOKEN_REFRESHED");
      return refreshed;
    } catch {
      return current;
    }
  };

  const getHeaders = async (): Promise<Record<string, string>> => {
    const session = await refreshSessionIfNeeded(readStoredSession());
    const token = session?.access_token || clientKey;
    return {
      "Content-Type": "application/json",
      apikey: clientKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const auth = {
    onAuthStateChange(callback: (event: string, session: AwsSession | null) => void) {
      listeners.add(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(callback);
            },
          },
        },
      };
    },

    async getSession(): Promise<{ data: { session: AwsSession | null }; error: AwsAuthError | null }> {
      const session = await refreshSessionIfNeeded(readStoredSession());
      return { data: { session }, error: null };
    },

    async getUser(jwt?: string): Promise<{ data: { user: AwsUser | null }; error: AwsAuthError | null }> {
      if (jwt) {
        const claims = decodeJwtPayload(jwt);
        if (claims?.sub) {
          return { data: { user: userFromCognitoClaims(claims) }, error: null };
        }
      }
      const session = await refreshSessionIfNeeded(readStoredSession());
      if (!session) {
        return { data: { user: null }, error: null };
      }
      if (!baseUrl) {
        return { data: { user: session.user }, error: null };
      }
      try {
        const response = await customFetch(`${baseUrl}/auth/v1/user`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            apikey: clientKey,
            Authorization: `Bearer ${jwt || session.access_token}`,
          },
        });
        if (!response.ok) {
          if (response.status === 401) {
            writeStoredSession(null, "SIGNED_OUT");
          }
          const errData = await response.json().catch(() => ({}));
          return {
            data: { user: null },
            error: { message: errData.message || errData.error || "Sessão inválida.", status: response.status },
          };
        }
        const user = (await response.json()) as AwsUser;
        return { data: { user }, error: null };
      } catch {
        return { data: { user: session.user }, error: null };
      }
    },

    async signUp(params: {
      email: string;
      password: string;
      options?: { data?: Record<string, any>; emailRedirectTo?: string };
    }): Promise<{ data: { user: AwsUser | null; session: AwsSession | null; userConfirmed?: boolean }; error: AwsAuthError | null }> {
      const displayName = params.options?.data?.display_name;
      if (cognitoClientId) {
        const userAttributes = [{ Name: "email", Value: params.email }];
        if (displayName) {
          userAttributes.push({ Name: "custom:display_name", Value: String(displayName) });
        }
        const { data, error } = await cognitoRpc("SignUp", {
          ClientId: cognitoClientId,
          Username: params.email,
          Password: params.password,
          UserAttributes: userAttributes,
        });
        if (error) return { data: { user: null, session: null }, error };
        const user: AwsUser = {
          id: String(data.UserSub || crypto.randomUUID()),
          email: params.email,
          aud: "authenticated",
          role: "authenticated",
          user_metadata: { ...(displayName ? { display_name: displayName } : {}) },
          app_metadata: { provider: "cognito" },
        };
        return { data: { user, session: null, userConfirmed: Boolean(data.UserConfirmed) }, error: null };
      }

      try {
        const response = await customFetch(`${baseUrl}/auth/v1/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: clientKey },
          body: JSON.stringify({
            email: params.email,
            password: params.password,
            data: params.options?.data || {},
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            data: { user: null, session: null },
            error: { message: payload.msg || payload.message || payload.error || "Falha ao criar conta.", status: response.status },
          };
        }
        if (payload.access_token && payload.user) {
          const expiresIn = Number(payload.expires_in || 3600);
          const session: AwsSession = {
            access_token: payload.access_token,
            refresh_token: payload.refresh_token || "",
            token_type: "bearer",
            expires_in: expiresIn,
            expires_at: Math.floor(Date.now() / 1000) + expiresIn,
            user: payload.user,
          };
          writeStoredSession(session, "SIGNED_IN");
          return { data: { user: payload.user, session }, error: null };
        }
        return { data: { user: payload.user || payload, session: null }, error: null };
      } catch (err) {
        return {
          data: { user: null, session: null },
          error: { message: err instanceof Error ? err.message : "Erro de conexão." },
        };
      }
    },

    async confirmSignUp(params: {
      email: string;
      code: string;
    }): Promise<{ error: AwsAuthError | null }> {
      if (cognitoClientId) {
        const { error } = await cognitoRpc("ConfirmSignUp", {
          ClientId: cognitoClientId,
          Username: params.email.trim(),
          ConfirmationCode: params.code.trim(),
        });
        return { error };
      }
      return { error: null };
    },

    async resendConfirmationCode(email: string): Promise<{ error: AwsAuthError | null }> {
      if (cognitoClientId) {
        const { error } = await cognitoRpc("ResendConfirmationCode", {
          ClientId: cognitoClientId,
          Username: email.trim(),
        });
        return { error };
      }
      return { error: null };
    },

    async signInWithPassword(params: {
      email: string;
      password: string;
    }): Promise<{ data: { user: AwsUser | null; session: AwsSession | null }; error: AwsAuthError | null }> {
      if (cognitoClientId) {
        const { data, error } = await cognitoRpc("InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: cognitoClientId,
          AuthParameters: {
            USERNAME: params.email,
            PASSWORD: params.password,
          },
        });
        if (error || !data?.AuthenticationResult) {
          return { data: { user: null, session: null }, error: error || { message: "Credenciais inválidas." } };
        }
        const authResult = data.AuthenticationResult;
        const token = authResult.IdToken || authResult.AccessToken;
        const claims = decodeJwtPayload(token) || {};
        const user = userFromCognitoClaims(claims, params.email);
        const expiresIn = Number(authResult.ExpiresIn || 3600);
        const session: AwsSession = {
          access_token: token,
          refresh_token: authResult.RefreshToken || "",
          token_type: "bearer",
          expires_in: expiresIn,
          expires_at: Math.floor(Date.now() / 1000) + expiresIn,
          user,
        };
        writeStoredSession(session, "SIGNED_IN");
        return { data: { user, session }, error: null };
      }

      try {
        const response = await customFetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: clientKey },
          body: JSON.stringify({ email: params.email, password: params.password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.access_token) {
          return {
            data: { user: null, session: null },
            error: {
              message: payload.error_description || payload.msg || payload.message || payload.error || "Credenciais inválidas.",
              status: response.status,
            },
          };
        }
        const expiresIn = Number(payload.expires_in || 3600);
        const session: AwsSession = {
          access_token: payload.access_token,
          refresh_token: payload.refresh_token || "",
          token_type: "bearer",
          expires_in: expiresIn,
          expires_at: Math.floor(Date.now() / 1000) + expiresIn,
          user: payload.user,
        };
        writeStoredSession(session, "SIGNED_IN");
        return { data: { user: payload.user, session }, error: null };
      } catch (err) {
        return {
          data: { user: null, session: null },
          error: { message: err instanceof Error ? err.message : "Erro de conexão." },
        };
      }
    },

    async signOut(): Promise<{ error: AwsAuthError | null }> {
      const session = readStoredSession();
      writeStoredSession(null, "SIGNED_OUT");
      if (session?.access_token && baseUrl) {
        await customFetch(`${baseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: clientKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        }).catch(() => null);
      }
      return { error: null };
    },

    async resetPasswordForEmail(
      email: string,
      options?: { redirectTo?: string },
    ): Promise<{ data: Record<string, never> | null; error: AwsAuthError | null }> {
      if (cognitoClientId) {
        const { error } = await cognitoRpc("ForgotPassword", {
          ClientId: cognitoClientId,
          Username: email,
        });
        return { data: error ? null : {}, error };
      }

      try {
        const response = await customFetch(`${baseUrl}/auth/v1/recover`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: clientKey },
          body: JSON.stringify({ email, redirect_to: options?.redirectTo }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          return {
            data: null,
            error: { message: payload.msg || payload.message || payload.error || "Não foi possível enviar o e-mail de recuperação." },
          };
        }
        return { data: {}, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : "Erro de conexão." },
        };
      }
    },

    async updateUser(attributes: {
      password?: string;
      email?: string;
      data?: Record<string, unknown>;
      code?: string;
    }): Promise<{ data: { user: AwsUser | null }; error: AwsAuthError | null }> {
      const session = await refreshSessionIfNeeded(readStoredSession());
      if (cognitoClientId && attributes.password && attributes.code && attributes.email) {
        const { error } = await cognitoRpc("ConfirmForgotPassword", {
          ClientId: cognitoClientId,
          Username: attributes.email,
          ConfirmationCode: attributes.code,
          Password: attributes.password,
        });
        return { data: { user: session?.user ?? null }, error };
      }

      try {
        const response = await customFetch(`${baseUrl}/auth/v1/user`, {
          method: "PUT",
          headers: await getHeaders(),
          body: JSON.stringify(attributes),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            data: { user: null },
            error: { message: payload.msg || payload.message || payload.error || "Não foi possível atualizar o usuário." },
          };
        }
        const updatedUser = (payload.user || payload) as AwsUser;
        if (session && updatedUser?.id) {
          writeStoredSession({ ...session, user: updatedUser }, "USER_UPDATED");
        }
        return { data: { user: updatedUser }, error: null };
      } catch (err) {
        return {
          data: { user: null },
          error: { message: err instanceof Error ? err.message : "Erro de conexão." },
        };
      }
    },
  };

  const functions = {
    async invoke<T = any>(
      functionName: string,
      options: {
        body?: unknown;
        headers?: Record<string, string>;
        method?: "POST" | "GET" | "PUT" | "PATCH" | "DELETE";
        timeout?: number;
      } = {},
    ): Promise<{ data: T | null; error: any }> {
      const headers = { ...(await getHeaders()), ...(options.headers || {}) };
      const controller = new AbortController();
      const timeoutMs = options.timeout || 60_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await customFetch(`${baseUrl}/functions/v1/${encodeURIComponent(functionName)}`, {
          method: options.method || "POST",
          headers,
          body:
            options.body === undefined
              ? undefined
              : typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const clone = response.clone();
          const errPayload = await response.json().catch(() => null);
          return {
            data: null,
            error: {
              name: "FunctionsHttpError",
              message: errPayload?.error || errPayload?.message || `Function returned status ${response.status}`,
              context: clone,
            },
          };
        }
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const isBinary =
          contentType.includes("application/octet-stream") ||
          contentType.startsWith("video/") ||
          contentType.startsWith("image/") ||
          contentType.startsWith("audio/");
        const data = contentType.includes("application/json")
          ? await response.json()
          : isBinary
            ? ((await response.blob()) as unknown as T)
            : ((await response.text()) as unknown as T);
        return { data: data as T, error: null };
      } catch (err) {
        return {
          data: null,
          error: {
            name: "FunctionsFetchError",
            message: err instanceof Error ? err.message : "Failed to invoke AWS Lambda function",
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };

  const s3StorageGateway = {
    from(bucket: string) {
      const request = async (action: string, payload: Record<string, unknown>) => {
        const result = await functions.invoke("s3-storage", {
          body: { action, bucket, ...payload },
          timeout: 60_000,
        });
        if (result.error) {
          const details = await result.error.context?.json?.().catch(() => null);
          return {
            data: null,
            error: {
              message:
                details?.error || result.error.message || "Não foi possível acessar o armazenamento S3.",
              statusCode: details?.statusCode || String(result.error.context?.status || 500),
            },
          };
        }
        return result;
      };

      return {
        async upload(
          path: string,
          body: Blob,
          options: { contentType?: string; upsert?: boolean; cacheControl?: string } = {},
        ) {
          const presigned = await request("upload", {
            path,
            size: body.size,
            contentType: options.contentType || body.type || "application/octet-stream",
            upsert: options.upsert || false,
          });
          if (presigned.error) return presigned;
          const form = new FormData();
          for (const [k, v] of Object.entries(presigned.data.fields || {})) {
            form.append(k, String(v));
          }
          form.append("file", body);
          const response = await customFetch(presigned.data.url, {
            method: "POST",
            body: form,
          });
          if (!response.ok) {
            return {
              data: null,
              error: { message: "Falha ao enviar o arquivo para o S3.", statusCode: String(response.status) },
            };
          }
          return { data: { path, fullPath: `${bucket}/${path}`, id: path }, error: null };
        },
        createSignedUrl(path: string, expiresIn: number) {
          return request("signed", { path, expiresIn });
        },
        copy(source: string, path: string) {
          return request("copy", { source, path });
        },
        getPublicUrl(path: string) {
          const query = new URLSearchParams({ bucket, path });
          return {
            data: {
              publicUrl: `${baseUrl}/functions/v1/s3-storage?${query}`,
            },
          };
        },
        list(path = "", options: Record<string, unknown> = {}) {
          return request("list", { ...options, path });
        },
        remove(paths: string[]) {
          return request("remove", { paths });
        },
        async download(path: string) {
          const signed = await request("signed", { path, expiresIn: 600 });
          if (signed.error) return signed;
          const response = await customFetch(signed.data.signedUrl);
          if (!response.ok) {
            return { data: null, error: { message: "Não foi possível baixar o arquivo do S3." } };
          }
          return { data: await response.blob(), error: null };
        },
      };
    },
  };

  return {
    auth,
    functions,
    storage: s3StorageGateway,
    from<T = any>(table: string) {
      return new PostgrestQueryBuilder<T>(baseUrl, table, getHeaders, customFetch);
    },
    async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: any }> {
      const headers = await getHeaders();
      try {
        const response = await customFetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
        });
        const text = await response.text();
        const parsed = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
        if (!response.ok) {
          return {
            data: null,
            error: {
              message: parsed?.message || parsed?.error || `RPC ${fn} failed (${response.status})`,
              code: parsed?.code || String(response.status),
            },
          };
        }
        return { data: parsed as T, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : "Network error" },
        };
      }
    },
  };
}

const metaEnv: Record<string, string | undefined> =
  (typeof import.meta !== "undefined" && (import.meta as any).env) ||
  (typeof process !== "undefined" && process.env) ||
  {};

const AWS_API_URL =
  metaEnv.VITE_AWS_API_URL ||
  metaEnv.VITE_SUPABASE_URL ||
  "";

const AWS_CLIENT_KEY =
  metaEnv.VITE_AWS_CLIENT_KEY ||
  metaEnv.VITE_AWS_COGNITO_CLIENT_ID ||
  metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

export const awsClient = createAwsClient<Database>({
  apiUrl: AWS_API_URL,
  clientKey: AWS_CLIENT_KEY,
  region: metaEnv.VITE_AWS_REGION || "us-east-2",
  cognitoUserPoolId: metaEnv.VITE_AWS_COGNITO_USER_POOL_ID,
  cognitoClientId: metaEnv.VITE_AWS_COGNITO_CLIENT_ID,
  fetch: withUploadTimeout((input, init) => fetch(input, init)),
});

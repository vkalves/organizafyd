/**
 * AWS Cognito User Pool Auth Gateway (/auth/v1/*) + RDS auth.users Synchronization
 *
 * Bridges AWS Cognito User Pool authentication with the RDS PostgreSQL auth.users
 * table so existing foreign keys, profile triggers, and account approval triggers
 * fire automatically on AWS.
 */
import { type SqlExecutor, runInRlsTransaction } from "./api-gateway";

export interface CognitoAuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  verifyJwt: (token: string) => Promise<{
    id: string;
    email?: string;
    cognitoSub: string;
    displayName?: string;
  } | null>;
  fetch?: typeof fetch;
}

export function createCognitoAuthHandler(db: SqlExecutor, config: CognitoAuthConfig) {
  const customFetch = config.fetch || fetch;
  const cognitoUrl = `https://cognito-idp.${config.region}.amazonaws.com/`;

  async function callCognito(target: string, payload: Record<string, unknown>) {
    const response = await customFetch(cognitoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, any>;
    return { ok: response.ok, status: response.status, data };
  }

  async function syncUserInRds(params: {
    id: string;
    email: string;
    displayName?: string;
    cognitoSub: string;
  }): Promise<string> {
    return runInRlsTransaction(
      db,
      { role: "service_role", userId: null },
      async () => {
        const res = await db.query<{ user_id: string }>(
          "SELECT auth.sync_cognito_user($1::uuid, $2, $3, $4) AS user_id",
          [params.id, params.email, params.displayName || null, params.cognitoSub],
        );
        return res.rows[0]?.user_id || params.id;
      },
    );
  }

  return async function handleAuthRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/auth\/v1/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (path === "/token" && req.method === "POST") {
      const grantType = url.searchParams.get("grant_type") || "password";
      const body = (await req.json().catch(() => ({}))) as Record<string, any>;

      if (grantType === "password") {
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) {
          return reply({ error: "invalid_grant", error_description: "Email and password required" }, 400);
        }

        const res = await callCognito("InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: config.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        });
        if (!res.ok || !res.data.AuthenticationResult) {
          return reply(
            {
              error: "invalid_grant",
              error_description: res.data.message || "Invalid login credentials",
            },
            400,
          );
        }

        const authResult = res.data.AuthenticationResult;
        const token = String(authResult.IdToken || authResult.AccessToken);
        const verified = await config.verifyJwt(token);
        if (!verified) {
          return reply({ error: "invalid_token" }, 401);
        }

        const rdsUserId = await syncUserInRds({
          id: verified.id,
          email: verified.email || email,
          displayName: verified.displayName,
          cognitoSub: verified.cognitoSub,
        });

        return reply({
          access_token: token,
          refresh_token: authResult.RefreshToken || "",
          token_type: "bearer",
          expires_in: Number(authResult.ExpiresIn || 3600),
          user: {
            id: rdsUserId,
            email: verified.email || email,
            aud: "authenticated",
            role: "authenticated",
            user_metadata: verified.displayName ? { display_name: verified.displayName } : {},
          },
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = String(body.refresh_token || "");
        if (!refreshToken) {
          return reply({ error: "invalid_grant" }, 400);
        }
        const res = await callCognito("InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: config.clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        });
        if (!res.ok || !res.data.AuthenticationResult) {
          return reply({ error: "invalid_grant" }, 401);
        }
        const authResult = res.data.AuthenticationResult;
        const token = String(authResult.IdToken || authResult.AccessToken);
        const verified = await config.verifyJwt(token);
        if (!verified) {
          return reply({ error: "invalid_token" }, 401);
        }
        return reply({
          access_token: token,
          refresh_token: authResult.RefreshToken || refreshToken,
          token_type: "bearer",
          expires_in: Number(authResult.ExpiresIn || 3600),
          user: {
            id: verified.id,
            email: verified.email || "",
            aud: "authenticated",
            role: "authenticated",
            user_metadata: verified.displayName ? { display_name: verified.displayName } : {},
          },
        });
      }

      return reply({ error: "unsupported_grant_type" }, 400);
    }

    if (path === "/signup" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, any>;
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = body.data?.display_name ? String(body.data.display_name) : undefined;
      if (!email || !password) {
        return reply({ error: "invalid_signup" }, 400);
      }

      const attributes = [{ Name: "email", Value: email }];
      if (displayName) attributes.push({ Name: "name", Value: displayName });

      const res = await callCognito("SignUp", {
        ClientId: config.clientId,
        Username: email,
        Password: password,
        UserAttributes: attributes,
      });
      if (!res.ok) {
        return reply({ error: res.data.message || "signup_failed" }, 400);
      }

      const sub = String(res.data.UserSub || crypto.randomUUID());
      const userId = await syncUserInRds({
        id: sub,
        email,
        displayName,
        cognitoSub: sub,
      });

      return reply({
        user: {
          id: userId,
          email,
          aud: "authenticated",
          role: "authenticated",
          user_metadata: displayName ? { display_name: displayName } : {},
        },
      });
    }

    if (path === "/user" && req.method === "GET") {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const verified = await config.verifyJwt(token);
      if (!verified) {
        return reply({ error: "unauthorized" }, 401);
      }
      const userId = await syncUserInRds({
        id: verified.id,
        email: verified.email || "",
        displayName: verified.displayName,
        cognitoSub: verified.cognitoSub,
      });
      return reply({
        id: userId,
        email: verified.email || "",
        aud: "authenticated",
        role: "authenticated",
        user_metadata: verified.displayName ? { display_name: verified.displayName } : {},
      });
    }

    if (path === "/recover" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, any>;
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return reply({ error: "email_required" }, 400);
      const res = await callCognito("ForgotPassword", {
        ClientId: config.clientId,
        Username: email,
      });
      if (!res.ok) {
        return reply({ error: res.data.message || "recover_failed" }, 400);
      }
      return reply({});
    }

    if (path === "/logout" && req.method === "POST") {
      return reply({});
    }

    return reply({ error: "not_found" }, 404);
  };
}

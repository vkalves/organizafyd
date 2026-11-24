import pg from "pg";
import {
  handleRestRequest,
  runInRlsTransaction,
  type SessionContext,
  type SqlExecutor,
} from "./api-gateway";
import { verifyCognitoJwt } from "../../../supabase/functions/_shared/cognito-jwt";
import { createAwsClient } from "../../../src/integrations/aws/client";

const { Pool } = pg;

function formatPgTimestamptz(val: string): string {
  const iso = val.replace(" ", "T");
  return /[+-]\d{2}$/.test(iso) ? `${iso}:00` : iso;
}

pg.types.setTypeParser(1184, formatPgTimestamptz);
pg.types.setTypeParser(1114, (val: string) => val.replace(" ", "T"));

export const REGION = process.env.AWS_REGION || "us-east-2";
export const USER_POOL_ID = process.env.AWS_COGNITO_USER_POOL_ID || "us-east-2_8hN58guGo";
export const CLIENT_ID = process.env.AWS_COGNITO_CLIENT_ID || "5vv5jjam04u8kqbfn9c4guhjv6";
export const S3_BUCKET = process.env.AWS_S3_BUCKET || "avanca-files-172021821070-us-east-2";
export const API_URL = process.env.AWS_API_URL || "https://u1qlecg8vl.execute-api.us-east-2.amazonaws.com";
export const SERVICE_KEY = process.env.AWS_SERVICE_ROLE_KEY || "aws-service-role";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connStr = (process.env.DATABASE_URL || "").replace(/[?&]sslmode=[^&]+/g, "");
    pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });
  }
  return pool;
}

export function createClientExecutor(client: pg.PoolClient): SqlExecutor {
  return {
    async query<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params as any[]);
      return { rows: res.rows as T[], rowCount: res.rowCount };
    },
  };
}

export async function withDbClient<T>(fn: (exec: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(createClientExecutor(client));
  } finally {
    client.release();
  }
}

const syncedUsersCache = new Map<string, string>();

export async function ensureCognitoUserSynced(verified: {
  id: string;
  email?: string;
  displayName?: string;
  cognitoSub: string;
}): Promise<string> {
  const cached = syncedUsersCache.get(verified.cognitoSub);
  if (cached) return cached;
  const rdsUserId = await withDbClient((exec) =>
    runInRlsTransaction(exec, { role: "service_role", userId: null }, async () => {
      const res = await exec.query<{ id: string }>(
        "SELECT auth.sync_cognito_user($1::uuid, $2, $3, $4) AS id",
        [verified.id, verified.email || null, verified.displayName || null, verified.cognitoSub],
      );
      return res.rows[0]?.id || verified.id;
    }),
  );
  syncedUsersCache.set(verified.cognitoSub, rdsUserId);
  return rdsUserId;
}

export async function authenticateRequest(req: Request): Promise<{
  session: SessionContext;
  user: { id: string; email?: string; displayName?: string } | null;
}> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === CLIENT_ID) {
    return { session: { role: "anon", userId: null }, user: null };
  }
  if (token === SERVICE_KEY) {
    return { session: { role: "service_role", userId: null }, user: null };
  }

  const verified = await verifyCognitoJwt(token, {
    region: REGION,
    userPoolId: USER_POOL_ID,
  }).catch(() => null);

  if (!verified) {
    return { session: { role: "anon", userId: null }, user: null };
  }

  const rdsUserId = await ensureCognitoUserSynced(verified);

  return {
    session: {
      role: "authenticated",
      userId: rdsUserId,
      email: verified.email,
    },
    user: {
      id: rdsUserId,
      email: verified.email,
      displayName: verified.displayName,
    },
  };
}

let internalHttpRouter: ((req: Request) => Promise<Response>) | null = null;
export function setInternalHttpRouter(router: (req: Request) => Promise<Response>) {
  internalHttpRouter = router;
}

export function createInternalServiceDb() {
  const client = createAwsClient({
    apiUrl: API_URL,
    clientKey: SERVICE_KEY,
    fetch: async (input, init) => {
      const req = new Request(String(input), init);
      if (new URL(req.url).pathname.includes("/rest/v1/")) {
        return withDbClient((exec) =>
          handleRestRequest(req, exec, { role: "service_role", userId: null }),
        );
      }
      if (internalHttpRouter) {
        return internalHttpRouter(req);
      }
      return fetch(input, init);
    },
  });

  client.auth.getUser = (async (jwt?: string) => {
    if (!jwt) return { data: { user: null }, error: { message: "unauthorized", status: 401 } };
    const verified = await verifyCognitoJwt(jwt, {
      region: REGION,
      userPoolId: USER_POOL_ID,
    }).catch(() => null);
    if (!verified) return { data: { user: null }, error: { message: "unauthorized", status: 401 } };
    const rdsUserId = await ensureCognitoUserSynced(verified);
    return {
      data: {
        user: {
          id: rdsUserId,
          email: verified.email,
          aud: "authenticated",
          role: "authenticated",
          user_metadata: verified.displayName ? { display_name: verified.displayName } : {},
          app_metadata: { provider: "cognito" },
        },
      },
      error: null,
    };
  }) as any;

  return client as any;
}

export const servedHandlers: Array<(req: Request) => Promise<Response> | Response> = [];

(globalThis as any).__AVANCA_CREATE_BACKEND_CLIENT__ = createInternalServiceDb;
(globalThis as any).Deno = {
  env: {
    get(key: string): string | undefined {
      if (key === "SUPABASE_URL" || key === "AWS_API_URL") return API_URL;
      if (key === "SUPABASE_SERVICE_ROLE_KEY" || key === "AWS_SERVICE_ROLE_KEY") return SERVICE_KEY;
      if (key === "AWS_S3_BUCKET") return S3_BUCKET;
      if (key === "AWS_REGION") return REGION;
      return process.env[key];
    },
  },
  serve(fn: (req: Request) => Promise<Response> | Response) {
    servedHandlers.push(fn);
    return { finished: Promise.resolve() };
  },
};

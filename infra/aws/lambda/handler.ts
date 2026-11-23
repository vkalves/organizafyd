import pg from "pg";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  type ApiGatewayV2Event,
  type ApiGatewayV2Result,
  eventToFetchRequest,
  fetchResponseToResult,
  handleRestRequest,
  runInRlsTransaction,
  type SessionContext,
  type SqlExecutor,
} from "./api-gateway";
import { createCognitoAuthHandler } from "./cognito-auth";
import { verifyCognitoJwt } from "../../../supabase/functions/_shared/cognito-jwt";
import { createAwsClient } from "../../../src/integrations/aws/client";
import { createAdminHandler } from "../../../supabase/functions/app-admin/handler";
import { accountHandler } from "../../../supabase/functions/instagram-accounts/handler";
import { monitorHandler } from "../../../supabase/functions/instagram-monitor/handler";
import { createMonitorRepository } from "../../../supabase/functions/instagram-monitor/repository";
import { createReelImportHandler } from "../../../supabase/functions/instagram-reel-import/handler";
import { createGoogleCalendarHandler } from "../../../supabase/functions/google-calendar/handler";
import { SupabaseCalendarStore } from "../../../supabase/functions/google-calendar/store";
import { createXHandler } from "../../../supabase/functions/x-publisher/handler";
import { createTikTokHandler } from "../../../supabase/functions/tiktok-publisher/handler";
import {
  buckets,
  ownsPath,
  uploadAllowed,
  validBucket,
  validPath,
  validServerCopy,
} from "../../../supabase/functions/s3-storage/policy";
import { reserveStorage, syncStorageInventory } from "../../../supabase/functions/s3-storage/quota";

const { Pool } = pg;

const REGION = process.env.AWS_REGION || "us-east-2";
const USER_POOL_ID = process.env.AWS_COGNITO_USER_POOL_ID || "us-east-2_8hN58guGo";
const CLIENT_ID = process.env.AWS_COGNITO_CLIENT_ID || "5vv5jjam04u8kqbfn9c4guhjv6";
const S3_BUCKET = process.env.AWS_S3_BUCKET || "avanca-files-172021821070-us-east-2";
const API_URL = process.env.AWS_API_URL || "https://u1qlecg8vl.execute-api.us-east-2.amazonaws.com";
const SERVICE_KEY = process.env.AWS_SERVICE_ROLE_KEY || "aws-service-role";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connStr = (process.env.DATABASE_URL || "").replace(/[?&]sslmode=[^&]+/g, "");
    pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

function createClientExecutor(client: pg.PoolClient): SqlExecutor {
  return {
    async query<T = Record<string, any>>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params as any[]);
      return { rows: res.rows as T[], rowCount: res.rowCount };
    },
  };
}

async function withDbClient<T>(fn: (exec: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(createClientExecutor(client));
  } finally {
    client.release();
  }
}

const syncedUsersCache = new Set<string>();

async function authenticateRequest(req: Request): Promise<{
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

  let rdsUserId = verified.id;
  if (!syncedUsersCache.has(verified.cognitoSub)) {
    rdsUserId = await withDbClient((exec) =>
      runInRlsTransaction(exec, { role: "service_role", userId: null }, async () => {
        const res = await exec.query<{ id: string }>(
          "SELECT auth.sync_cognito_user($1::uuid, $2, $3, $4) AS id",
          [verified.id, verified.email || null, verified.displayName || null, verified.cognitoSub],
        );
        return res.rows[0]?.id || verified.id;
      }),
    );
    syncedUsersCache.add(verified.cognitoSub);
  }

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

function createInternalServiceDb() {
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
      return handleHttpRequest(req);
    },
  });

  client.auth.getUser = (async (jwt?: string) => {
    if (!jwt) return { data: { user: null }, error: { message: "unauthorized", status: 401 } };
    const verified = await verifyCognitoJwt(jwt, {
      region: REGION,
      userPoolId: USER_POOL_ID,
    }).catch(() => null);
    if (!verified) return { data: { user: null }, error: { message: "unauthorized", status: 401 } };
    return {
      data: {
        user: {
          id: verified.id,
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

const s3Client = new S3Client({ region: REGION });

async function s3Head(bucket: string, key: string) {
  try {
    return await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(e?.name)) {
      return null;
    }
    throw e;
  }
}

async function handleS3Storage(req: Request, db: any): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });

  const url = new URL(req.url);
  const isPublic = req.method === "GET" || req.method === "HEAD";
  const body = isPublic
    ? {
        action: "public",
        bucket: url.searchParams.get("bucket"),
        path: url.searchParams.get("path"),
      }
    : await req.json().catch(() => ({}));

  if (!validBucket(body.bucket)) return reply({ error: "invalid_bucket" }, 400);
  const bucket = body.bucket as keyof typeof buckets;
  if (isPublic && !buckets[bucket].public) return reply({ error: "not_found" }, 404);

  let admin = false;
  let user = "";
  if (!isPublic) {
    const { session } = await authenticateRequest(req);
    admin = session.role === "service_role";
    if (!admin) {
      if (!session.userId) return reply({ error: "unauthorized" }, 401);
      user = session.userId;
    }
  }

  const paths = body.action === "remove" ? body.paths : [body.path];
  if (
    body.action !== "list" &&
    (!Array.isArray(paths) || !paths.length || paths.some((p: unknown) => !validPath(p)))
  ) {
    return reply({ error: "invalid_path" }, 400);
  }
  if (!admin && !isPublic && body.action !== "list" && paths.some((p: string) => !ownsPath(user, p))) {
    return reply({ error: "forbidden" }, 403);
  }

  const key = `${bucket}/${body.path}`;
  const inventory = (owner: string) =>
    syncStorageInventory(db, owner, (prefix, continuation) =>
      s3Client.send(
        new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: continuation,
        }),
      ),
    );

  if (body.action === "quota") {
    const owner = body.path.split("/")[0];
    await inventory(owner);
    const result = await db.rpc("avanca_storage_access", { p_user: owner });
    return reply(result.data || { storage_limit_bytes: 1073741824, storage_used_bytes: 0 });
  }

  if (body.action === "upload") {
    if (!uploadAllowed(bucket, body.contentType, body.size) || body.upsert) {
      return reply({ error: "invalid_upload" }, 400);
    }
    const existing = await s3Head(S3_BUCKET, key);
    if (existing) {
      return reply({ error: "The resource already exists", statusCode: "409" }, 409);
    }
    const owner = body.path.split("/")[0];
    await inventory(owner);
    const quotaError = await reserveStorage(db, owner, bucket, body.path, body.size);
    if (quotaError) {
      return reply({ error: quotaError }, quotaError === "storage_quota_exceeded" ? 413 : 409);
    }
    const post = await createPresignedPost(s3Client, {
      Bucket: S3_BUCKET,
      Key: key,
      Expires: 120,
      Fields: {
        "Content-Type": body.contentType,
        "Cache-Control": bucket === "media" ? "public,max-age=300" : "no-store",
      },
      Conditions: [
        ["content-length-range", body.size, body.size],
        ["eq", "$Content-Type", body.contentType],
      ],
    });
    return reply(post);
  }

  if (body.action === "signed" || body.action === "public") {
    const object = await s3Head(S3_BUCKET, key);
    if (!object) return reply({ error: "not_found" }, 404);
    const expires = Math.max(60, Math.min(3600, Number(body.expiresIn) || 600));
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        ResponseContentDisposition: "inline",
        ResponseCacheControl: buckets[bucket].public ? "public,max-age=60" : "private,no-store",
      }),
      { expiresIn: expires },
    );
    if (isPublic) {
      return new Response(null, { status: 307, headers: { ...headers, Location: signedUrl } });
    }
    return reply({ signedUrl });
  }

  if (body.action === "copy") {
    if (!validServerCopy(admin, body.source, body.path)) return reply({ error: "forbidden" }, 403);
    const sourceObj = await s3Head(S3_BUCKET, `${bucket}/${body.source}`);
    if (!sourceObj) return reply({ error: "not_found" }, 404);
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        CopySource: `${S3_BUCKET}/${`${bucket}/${body.source}`.split("/").map(encodeURIComponent).join("/")}`,
      }),
    );
    return reply({ path: body.path });
  }

  if (body.action === "list") {
    const prefix = `${bucket}/${body.path}/`;
    const page = await s3Client.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, Delimiter: "/" }),
    );
    const items = (page.Contents || []).map((obj) => ({
      name: obj.Key!.slice(prefix.length),
      id: obj.Key,
      updated_at: obj.LastModified?.toISOString(),
      created_at: obj.LastModified?.toISOString(),
      metadata: { size: obj.Size },
    }));
    return reply(items);
  }

  if (body.action === "remove") {
    if (!admin && !buckets[bucket].delete) return reply({ error: "forbidden" }, 403);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: body.paths.map((p: string) => ({ Key: `${bucket}/${p}` })) },
      }),
    );
    await db.rpc("avanca_storage_removed", { p_bucket: bucket, p_paths: body.paths });
    return reply(body.paths.map((name: string) => ({ name })));
  }

  return reply({ error: "invalid_action" }, 400);
}

async function handleHttpRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const origin = req.headers.get("origin") || "*";
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,prefer,accept,range,x-client-info,x-migration-token",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Expose-Headers": "content-range",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const withCors = (res: Response) => {
    const newHeaders = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      if (!newHeaders.has(k)) newHeaders.set(k, v);
    }
    return new Response(res.body, { status: res.status, headers: newHeaders });
  };

  if (path.includes("/auth/v1")) {
    return withCors(
      await withDbClient(async (exec) => {
        const handler = createCognitoAuthHandler(exec, {
          region: REGION,
          userPoolId: USER_POOL_ID,
          clientId: CLIENT_ID,
          verifyJwt: (jwt) => verifyCognitoJwt(jwt, { region: REGION, userPoolId: USER_POOL_ID }),
        });
        return handler(req);
      }),
    );
  }

  if (path.includes("/rest/v1/")) {
    const { session } = await authenticateRequest(req);
    return withCors(
      await withDbClient((exec) => handleRestRequest(req, exec, session)),
    );
  }

  if (path.includes("/functions/v1/")) {
    const fnName = path.split("/functions/v1/")[1]?.split("/")[0] || "";
    const db = createInternalServiceDb();

    if (fnName === "app-admin") {
      const adminHandler = createAdminHandler(
        db,
        async () => {},
        new Set([origin, "https://xn--avana-1ra.online", "https://organizafy.site", "https://www.organizafy.site", "https://organizafyd.vercel.app"]),
      );
      return withCors(await adminHandler(req));
    }

    if (fnName === "s3-storage") {
      return withCors(await handleS3Storage(req, db));
    }

    if (fnName === "instagram-monitor") {
      const handler = monitorHandler(
        createMonitorRepository(db),
        new Set([origin, "https://xn--avana-1ra.online", "https://organizafy.site", "https://www.organizafy.site", "https://organizafyd.vercel.app"]),
      );
      return withCors(await handler(req));
    }

    if (fnName === "instagram-reel-import") {
      const handler = createReelImportHandler(async (token) => {
        const { data, error } = await db.auth.getUser(token);
        return !error && !!data.user;
      });
      return withCors(await handler(req));
    }

    if (fnName === "google-calendar") {
      const handler = createGoogleCalendarHandler({
        store: new SupabaseCalendarStore(db),
        config: {
          supabaseUrl: API_URL,
          clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
          appUrl: process.env.GOOGLE_CALENDAR_APP_URL || "https://www.organizafy.site",
          encryptionKey: process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY,
          workerSecret: process.env.GOOGLE_CALENDAR_WORKER_SECRET,
        },
      });
      return withCors(await handler(req));
    }

    if (fnName === "x-publisher") {
      const handler = createXHandler(db, {
        appUrl: process.env.X_APP_URL || "https://www.organizafy.site",
        supabaseUrl: API_URL,
        clientId: process.env.X_CLIENT_ID,
        clientSecret: process.env.X_CLIENT_SECRET,
        encryptionKey: process.env.X_ENCRYPTION_KEY,
        workerSecret: process.env.X_WORKER_SECRET,
      });
      return withCors(await handler(req));
    }

    if (fnName === "tiktok-publisher") {
      const handler = createTikTokHandler(db, {
        appUrl: process.env.TIKTOK_APP_URL || "https://www.organizafy.site",
        supabaseUrl: API_URL,
        clientId: process.env.TIKTOK_CLIENT_KEY,
        clientSecret: process.env.TIKTOK_CLIENT_SECRET,
        encryptionKey: process.env.TIKTOK_ENCRYPTION_KEY,
        workerSecret: process.env.TIKTOK_WORKER_SECRET,
      });
      return withCors(await handler(req));
    }

    if (fnName === "instagram-login") {
      const body = await req.json().catch(() => ({}));
      const { user } = await authenticateRequest(req);
      if (!user) {
        return withCors(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
      }
      if (body.action === "config" || body.action === "list_apps") {
        const appsRes = await db.rpc("ig_list_meta_apps", { p_user: user.id });
        const prefRes = await db
          .from("ig_user_meta_app_preferences")
          .select("default_meta_app_id")
          .eq("user_id", user.id)
          .maybeSingle();
        return withCors(
          new Response(
            JSON.stringify({
              apps: appsRes.data || [],
              defaultAppId: prefRes.data?.default_meta_app_id || null,
              ready: Array.isArray(appsRes.data) && appsRes.data.some((a: any) => a.active),
              platformReady: false,
              callback: `${API_URL}/functions/v1/instagram-login`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
    }

    if (fnName === "instagram-publisher") {
      const body = await req.json().catch(() => ({}));
      const { user } = await authenticateRequest(req);
      if (!user) {
        return withCors(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
      }
      if (body.action === "status") {
        const conns = await db
          .from("ig_publisher_connections")
          .select("account_id,graph_id,username,token_expires_at,last_published_at,last_error,provider,paused,reconnect_required")
          .eq("user_id", user.id);
        const access = await db.rpc("avanca_user_access", { p_user: user.id });
        return withCors(
          new Response(
            JSON.stringify({
              ready: true,
              accounts: conns.data || [],
              access: access.data || { is_admin: true, connected_accounts: 0, max_accounts: 10, connection_allowed: true },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (body.action === "published_today") {
        return withCors(
          new Response(
            JSON.stringify({ total: 0, byAccount: {} }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (body.action === "library_shares") {
        return withCors(
          new Response(
            JSON.stringify({ incoming: [], outgoing: [] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
    }
  }

  return withCors(
    new Response(JSON.stringify({ status: "ok", provider: "aws" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Result> {
  const req = eventToFetchRequest(event);
  const res = await handleHttpRequest(req);
  return fetchResponseToResult(res);
}

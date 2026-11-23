import {
  API_URL,
  authenticateRequest,
  CLIENT_ID,
  createInternalServiceDb,
  REGION,
  S3_BUCKET,
  servedHandlers,
  setInternalHttpRouter,
  USER_POOL_ID,
  withDbClient,
} from "./deno-setup";

// Import all 11 production Edge Function entrypoints in exact registration order:
import "../../../supabase/functions/app-admin/index";
import "../../../supabase/functions/google-calendar/index";
import "../../../supabase/functions/instagram-accounts/index";
import "../../../supabase/functions/instagram-login/index";
import "../../../supabase/functions/instagram-media/index";
import "../../../supabase/functions/instagram-monitor/index";
import "../../../supabase/functions/instagram-publisher/index";
import "../../../supabase/functions/instagram-reel-import/index";
import "../../../supabase/functions/reset-daily-tasks/index";
import "../../../supabase/functions/tiktok-publisher/index";
import "../../../supabase/functions/x-publisher/index";

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
} from "./api-gateway";
import { createCognitoAuthHandler } from "./cognito-auth";
import { verifyCognitoJwt } from "../../../supabase/functions/_shared/cognito-jwt";
import {
  buckets,
  ownsPath,
  uploadAllowed,
  validBucket,
  validPath,
  validServerCopy,
} from "../../../supabase/functions/s3-storage/policy";
import { reserveStorage, syncStorageInventory } from "../../../supabase/functions/s3-storage/quota";

const FUNCTION_ORDER = [
  "app-admin",
  "google-calendar",
  "instagram-accounts",
  "instagram-login",
  "instagram-media",
  "instagram-monitor",
  "instagram-publisher",
  "instagram-reel-import",
  "reset-daily-tasks",
  "tiktok-publisher",
  "x-publisher",
] as const;

const functionRegistry = new Map<string, (req: Request) => Promise<Response> | Response>();
FUNCTION_ORDER.forEach((name, idx) => {
  if (servedHandlers[idx]) {
    functionRegistry.set(name, servedHandlers[idx]);
  }
});

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
  const origin = req.headers.get("origin") || "https://xn--avana-1ra.online";
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
      newHeaders.set(k, v);
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
    if (fnName === "s3-storage") {
      return withCors(await handleS3Storage(req, createInternalServiceDb()));
    }
    const fnHandler = functionRegistry.get(fnName);
    if (fnHandler) {
      return withCors(await fnHandler(req));
    }
    return withCors(
      new Response(JSON.stringify({ error: "function_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  return withCors(
    new Response(JSON.stringify({ status: "ok", provider: "aws", endpoint: API_URL }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

setInternalHttpRouter(handleHttpRequest);

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Result> {
  const req = eventToFetchRequest(event);
  const res = await handleHttpRequest(req);
  return fetchResponseToResult(res);
}

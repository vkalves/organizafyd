import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "npm:@aws-sdk/client-s3@3.922.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.922.0";
import { createPresignedPost } from "npm:@aws-sdk/s3-presigned-post@3.922.0";
import {
  buckets,
  ownsPath,
  uploadAllowed,
  validBucket,
  validPath,
} from "./policy.ts";
import { reserveStorage, syncStorageInventory } from "./quota.ts";
const base = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(base, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = new Set([
  "https://xn--avana-1ra.online",
  "https://www.xn--avana-1ra.online",
  "https://organizafy.site",
  "https://www.organizafy.site",
  "https://organizafyd.vercel.app",
]);
let cached: { at: number; value: any } | undefined;
async function config() {
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  const { data, error } = await db.rpc("aws_storage_config");
  if (error || !data?.bucket || data.region !== "us-east-2") {
    throw new Error("storage_not_configured");
  }
  cached = { at: Date.now(), value: data };
  return data;
}
async function equal(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  return x.reduce((n, v, i) => n | (v ^ y[i]), 0) === 0;
}
function missing(e: any) {
  return e?.$metadata?.httpStatusCode === 404 ||
    ["NotFound", "NoSuchKey"].includes(e?.name);
}
async function head(s3: S3Client, bucket: string, key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": origins.has(origin)
      ? origin
      : "https://xn--avana-1ra.online",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info,x-migration-token",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    Vary: "Origin",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !origins.has(origin)) {
    return reply({ error: "origin_not_allowed" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (!["GET", "HEAD", "POST"].includes(req.method)) {
    return reply({ error: "method_not_allowed" }, 405);
  }
  try {
    const url = new URL(req.url);
    const isPublic = req.method === "GET" || req.method === "HEAD";
    const raw = isPublic ? "" : await req.text();
    if (raw.length > 32768) return reply({ error: "request_too_large" }, 413);
    const body = isPublic
      ? {
        action: "public",
        bucket: url.searchParams.get("bucket"),
        path: url.searchParams.get("path"),
      }
      : JSON.parse(raw);
    if (!validBucket(body.bucket)) {
      return reply({ error: "invalid_bucket" }, 400);
    }
    const bucket = body.bucket as keyof typeof buckets;
    if (isPublic && !buckets[bucket].public) {
      return reply({ error: "not_found" }, 404);
    }
    let admin = false, user = "";
    // Authenticate before reading any AWS credentials. Public requests only access public buckets.
    if (!isPublic) {
      const token =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      admin = !!token && await equal(token, service);
      if (!admin && body.action !== "migrate") {
        const { data, error } = token
          ? await db.auth.getUser(token)
          : { data: { user: null }, error: true };
        if (error || !data.user) return reply({ error: "unauthorized" }, 401);
        user = data.user.id;
      }
    }
    const cfg = await config();
    if (body.action === "migrate" && !admin) {
      const token = req.headers.get("x-migration-token") || "";
      if (
        !cfg.migrationToken || Date.now() >= cfg.migrationExpires || !token ||
        !await equal(token, cfg.migrationToken)
      ) return reply({ error: "unauthorized" }, 401);
      admin = true;
    }
    const paths = body.action === "remove" ? body.paths : [body.path];
    if (
      body.action !== "list" &&
      (!Array.isArray(paths) || !paths.length || paths.length > 100 ||
        paths.some((p: unknown) => !validPath(p)))
    ) return reply({ error: "invalid_path" }, 400);
    if (
      !admin && !isPublic && body.action !== "list" &&
      paths.some((p: string) => !ownsPath(user, p))
    ) return reply({ error: "forbidden" }, 403);
    if (
      body.action === "list" &&
      (typeof body.path !== "string" ||
        (!admin && body.path !== user && !ownsPath(user, body.path)) ||
        body.path.split("/").some((p: string) =>
          !p || p === "." || p === ".."
        ) || /[\\\x00-\x1f]/.test(body.path))
    ) return reply({ error: "forbidden" }, 403);
    const s3 = new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
    const key = `${bucket}/${body.path}`;
    const inventory = (owner: string) => syncStorageInventory(db, owner, (prefix, continuation) => s3.send(new ListObjectsV2Command({
      Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: continuation,
    })));
    if (body.action === "quota") {
      const owner = body.path.split("/")[0];
      await inventory(owner);
      const result = await db.rpc("avanca_storage_access", { p_user: owner });
      if (result.error) throw new Error("storage_usage_failed");
      return reply(result.data);
    }
    if (body.action === "upload") {
      if (!uploadAllowed(bucket, body.contentType, body.size) || body.upsert) {
        return reply({ error: "invalid_upload" }, 400);
      }
      const [existing, legacy] = await Promise.all([
        head(s3, cfg.bucket, key),
        db.storage.from(bucket).list(
          body.path.slice(0, body.path.lastIndexOf("/")),
          { search: body.path.split("/").at(-1), limit: 100 },
        ),
      ]);
      if (legacy.error) throw new Error("legacy_storage_unavailable");
      if (
        existing ||
        legacy.data?.some((x: any) => x.name === body.path.split("/").at(-1))
      ) {
        return reply({
          error: "The resource already exists",
          statusCode: "409",
        }, 409);
      }
      const owner = body.path.split("/")[0];
      await inventory(owner);
      const quotaError = await reserveStorage(db, owner, bucket, body.path, body.size);
      if (quotaError) return reply({ error: quotaError }, quotaError === "storage_quota_exceeded" ? 413 : 409);
      const post = await createPresignedPost(s3, {
        Bucket: cfg.bucket,
        Key: key,
        Expires: 120,
        Fields: {
          "Content-Type": body.contentType,
          "Cache-Control": bucket === "media"
            ? "public,max-age=300"
            : "no-store",
        },
        Conditions: [["content-length-range", body.size, body.size], [
          "eq",
          "$Content-Type",
          body.contentType,
        ]],
      });
      return reply(post);
    }
    if (
      body.action === "signed" || body.action === "public" ||
      body.action === "migrate"
    ) {
      const object = await head(s3, cfg.bucket, key);
      const expires = Math.max(
        60,
        Math.min(3600, Number(body.expiresIn) || 600),
      );
      if (body.action === "migrate") {
        const source = await db.storage.from(bucket).createSignedUrl(
          body.path,
          3600,
        );
        if (source.error) return reply({ error: "source_missing" }, 404);
        return reply({
          source: source.data.signedUrl,
          exists: !!object,
          size: object?.ContentLength,
        });
      }
      let signedUrl: string;
      if (object) {
        signedUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            ResponseContentDisposition: "inline",
            ResponseCacheControl: buckets[bucket].public
              ? "public,max-age=60"
              : "private,no-store",
          }),
          { expiresIn: expires },
        );
      } else {
        const legacy = await db.storage.from(bucket).createSignedUrl(
          body.path,
          expires,
        );
        if (legacy.error) return reply({ error: "not_found" }, 404);
        signedUrl = legacy.data.signedUrl;
      }
      if (isPublic) {
        return new Response(null, {
          status: 307,
          headers: { ...headers, Location: signedUrl },
        });
      }
      return reply({ signedUrl });
    }
    if (body.action === "list") {
      const limit = Math.max(
        1,
        Math.min(1000, Math.floor(Number(body.limit) || 100)),
      );
      const offset = Math.max(
        0,
        Math.min(10000, Math.floor(Number(body.offset) || 0)),
      );
      const prefix = `${bucket}/${body.path}/`;
      // Read every S3 page before applying the shared sort/offset to both providers.
      let continuation: string | undefined;
      const objects: any[] = [];
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            Delimiter: "/",
            ContinuationToken: continuation,
          }),
        );
        objects.push(
          ...(page.CommonPrefixes || []).map((p) => ({
            Key: p.Prefix!.slice(0, -1),
            folder: true,
          })),
        );
        objects.push(
          ...(page.Contents || []).filter((x) =>
            !body.search ||
            x.Key!.slice(prefix.length).includes(String(body.search))
          ),
        );
        continuation = page.NextContinuationToken;
        if (objects.length > 10000) throw new Error("listing_too_large");
      } while (continuation);
      const legacy = await db.storage.from(bucket).list(body.path, {
        limit: Math.min(10000, offset + limit),
        search: typeof body.search === "string" ? body.search : undefined,
        sortBy: body.sortBy,
      });
      if (legacy.error) throw new Error("legacy_storage_unavailable");
      const merged = new Map((legacy.data || []).map((x) => [x.name, x]));
      for (const object of objects) {
        const name = object.Key.slice(prefix.length);
        if (body.search && !name.includes(String(body.search))) continue;
        merged.set(
          name,
          {
            name,
            id: object.folder ? null : object.Key,
            updated_at: object.LastModified?.toISOString(),
            created_at: object.LastModified?.toISOString(),
            last_accessed_at: null,
            metadata: object.folder ? null : { size: object.Size },
            s3Key: object.folder ? null : object.Key,
          } as any,
        );
      }
      const column =
        ["name", "created_at", "updated_at"].includes(body.sortBy?.column)
          ? body.sortBy.column
          : "name";
      const sign = body.sortBy?.order === "desc" ? -1 : 1;
      const selected: any[] = [...merged.values()].sort((a: any, b: any) =>
        String(a[column] || "").localeCompare(String(b[column] || "")) * sign
      ).slice(offset, offset + limit);
      // Bound S3 HEAD concurrency; retrieve MIME metadata only for the requested page.
      const result: any[] = [];
      for (let i = 0; i < selected.length; i += 8) {
        result.push(
          ...await Promise.all(
            selected.slice(i, i + 8).map(async (row) => {
              const { s3Key, ...value } = row;
              if (!s3Key) return value;
              const details = await head(s3, cfg.bucket, s3Key);
              if (!details) {
                return null;
              }
              return {
                ...value,
                metadata: {
                  size: details.ContentLength,
                  mimetype: details.ContentType,
                  eTag: details.ETag,
                },
              };
            }),
          ),
        );
      }
      return reply(result.filter(Boolean));
    }
    if (body.action === "remove") {
      if (!admin && !buckets[bucket].delete) {
        return reply({ error: "forbidden" }, 403);
      }
      const removed = await s3.send(
        new DeleteObjectsCommand({
          Bucket: cfg.bucket,
          Delete: {
            Objects: body.paths.map((p: string) => ({ Key: `${bucket}/${p}` })),
          },
        }),
      );
      if (removed.Errors?.length) throw new Error("delete_failed");
      const legacy = await db.storage.from(bucket).remove(body.paths);
      if (legacy.error) throw new Error("legacy_delete_failed");
      const released = await db.rpc("avanca_storage_removed", { p_bucket: bucket, p_paths: body.paths });
      if (released.error) throw new Error("storage_release_failed");
      return reply(body.paths.map((name: string) => ({ name })));
    }
    return reply({ error: "invalid_action" }, 400);
  } catch (e) {
    console.error(
      "aws_storage_request_failed",
      e instanceof Error ? e.name : "unknown",
    );
    return reply({ error: "storage_unavailable" }, 503);
  }
});

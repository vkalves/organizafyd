// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAwsClient } from "./client";
import {
  handleRestRequest,
  runInRlsTransaction,
  type SessionContext,
  type SqlExecutor,
} from "../../../infra/aws/lambda/api-gateway";
import { createCognitoAuthHandler } from "../../../infra/aws/lambda/cognito-auth";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe("AWS RDS PostgreSQL Bootstrap + Cognito Auth + API Gateway Integration", () => {
  let pg: PGlite;
  let sqlExecutor: SqlExecutor;

  beforeAll(async () => {
    pg = new PGlite();
    sqlExecutor = {
      async query<T = Record<string, any>>(sql: string, params: unknown[] = []) {
        const res = await pg.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      },
    };

    const bootstrapSql = readFileSync(
      new URL("../../../infra/aws/rds-bootstrap.sql", import.meta.url),
      "utf8",
    );
    await pg.exec(bootstrapSql);

    // Apply initial core schema migration and account approval migration
    const initialMigration = readFileSync(
      new URL(
        "../../../supabase/migrations/20260228024700_d19e6b2d-1067-48a3-a330-cddd980f1c26.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(initialMigration);

    const awsStorageBridge = readFileSync(
      new URL(
        "../../../supabase/migrations/20261110203709_aws_storage_bridge.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(awsStorageBridge);
  }, 30000);

  afterAll(async () => {
    await pg.close();
  });

  it("bootstraps RDS schema, syncs Cognito users into auth.users, and fires profile triggers", async () => {
    const syncedId = await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () => {
        const res = await sqlExecutor.query<{ id: string }>(
          "SELECT auth.sync_cognito_user($1::uuid, $2, $3, $4) AS id",
          [USER_A, "alice@example.com", "Alice AWS", "cognito-sub-alice"],
        );
        await sqlExecutor.query(
          "SELECT auth.sync_cognito_user($1::uuid, $2, $3, $4)",
          [USER_B, "bob@example.com", "Bob AWS", "cognito-sub-bob"],
        );
        return res.rows[0].id;
      },
    );

    expect(syncedId).toBe(USER_A);

    // Verify that the trigger on auth.users automatically created the user's profile row
    const profiles = await sqlExecutor.query<{ user_id: string; display_name: string }>(
      "SELECT user_id, display_name FROM public.profiles WHERE user_id = $1",
      [USER_A],
    );
    expect(profiles.rows).toEqual([
      { user_id: USER_A, display_name: "Alice AWS" },
    ]);
  });

  it("supports Vault secrets and aws_storage_config() for service_role while blocking authenticated users", async () => {
    const configPayload = JSON.stringify({
      bucket: "avanca-files-108327566923-us-east-2",
      region: "us-east-2",
      nativeOnly: true,
    });

    await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () => {
        await sqlExecutor.query(
          "SELECT vault.create_secret($1, 'avanca_aws_storage', 'S3 config')",
          [configPayload],
        );
      },
    );

    const serviceRead = await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () => {
        const res = await sqlExecutor.query<{ cfg: any }>(
          "SELECT public.aws_storage_config() AS cfg",
        );
        return res.rows[0].cfg;
      },
    );
    expect(serviceRead.bucket).toBe("avanca-files-108327566923-us-east-2");
    expect(serviceRead.nativeOnly).toBe(true);

    await expect(
      runInRlsTransaction(
        sqlExecutor,
        { role: "authenticated", userId: USER_A },
        async () => {
          await sqlExecutor.query("SELECT public.aws_storage_config()");
        },
      ),
    ).rejects.toThrow();
  });

  it("executes full CRUD and enforces PostgreSQL RLS through createAwsClient + AWS API Gateway handler", async () => {
    let activeSession: SessionContext = {
      role: "authenticated",
      userId: USER_A,
      email: "alice@example.com",
    };

    const client = createAwsClient({
      apiUrl: "https://api.organizafy.site",
      clientKey: "cognito-client-id",
      storage: new MemoryStorage(),
      fetch: async (input, init) => {
        const req = new Request(String(input), init);
        return handleRestRequest(req, sqlExecutor, activeSession);
      },
    });

    // 1. User A creates a task
    const created = await client
      .from("tasks")
      .insert({
        user_id: USER_A,
        title: "Migrar banco para AWS RDS",
        priority: "high",
        status: "todo",
      })
      .select()
      .single();

    expect(created.error).toBeNull();
    expect(created.data.title).toBe("Migrar banco para AWS RDS");
    const taskId = created.data.id;

    // 2. User A lists tasks
    const listA = await client
      .from("tasks")
      .select("*")
      .eq("user_id", USER_A)
      .order("created_at", { ascending: false });
    expect(listA.error).toBeNull();
    expect(listA.data).toHaveLength(1);

    // 3. Switch to User B: RLS prevents User B from reading or updating User A's task
    activeSession = {
      role: "authenticated",
      userId: USER_B,
      email: "bob@example.com",
    };

    const listB = await client.from("tasks").select("*");
    expect(listB.error).toBeNull();
    expect(listB.data).toHaveLength(0);

    const crossUpdate = await client
      .from("tasks")
      .update({ title: "Tentativa não autorizada" })
      .eq("id", taskId)
      .select()
      .maybeSingle();
    expect(crossUpdate.data).toBeNull();

    // 4. Switch back to User A: update and delete succeed
    activeSession = {
      role: "authenticated",
      userId: USER_A,
      email: "alice@example.com",
    };

    const updated = await client
      .from("tasks")
      .update({ status: "done" })
      .eq("id", taskId)
      .select()
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data.status).toBe("done");

    const deleted = await client.from("tasks").delete().eq("id", taskId);
    expect(deleted.error).toBeNull();
  });

  it("authenticates via AWS Cognito Auth Gateway (/auth/v1/*) and persists session in createAwsClient", async () => {
    const authHandler = createCognitoAuthHandler(sqlExecutor, {
      region: "us-east-2",
      userPoolId: "us-east-2_AvancaPool",
      clientId: "cognito-web-client",
      verifyJwt: async (token) => {
        if (token === "valid-cognito-id-token") {
          return {
            id: USER_A,
            email: "alice@example.com",
            cognitoSub: "cognito-sub-alice",
            displayName: "Alice AWS",
          };
        }
        return null;
      },
      fetch: async (_input, init) => {
        const target = (init?.headers as Record<string, string>)?.["X-Amz-Target"] || "";
        if (target.endsWith(".InitiateAuth")) {
          return new Response(
            JSON.stringify({
              AuthenticationResult: {
                IdToken: "valid-cognito-id-token",
                AccessToken: "valid-cognito-access-token",
                RefreshToken: "valid-cognito-refresh-token",
                ExpiresIn: 3600,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    const memoryStorage = new MemoryStorage();
    const client = createAwsClient({
      apiUrl: "https://api.organizafy.site",
      clientKey: "cognito-web-client",
      storage: memoryStorage,
      fetch: async (input, init) => authHandler(new Request(String(input), init)),
    });

    const signInRes = await client.auth.signInWithPassword({
      email: "alice@example.com",
      password: "secure-password",
    });
    expect(signInRes.error).toBeNull();
    expect(signInRes.data.user?.id).toBe(USER_A);
    expect(signInRes.data.session?.access_token).toBe("valid-cognito-id-token");

    const sessionRes = await client.auth.getSession();
    expect(sessionRes.data.session?.user.email).toBe("alice@example.com");

    const userRes = await client.auth.getUser();
    expect(userRes.data.user?.id).toBe(USER_A);

    await client.auth.signOut();
    expect((await client.auth.getSession()).data.session).toBeNull();
  });

  it("verifies RS256 AWS Cognito JWT tokens against Cognito User Pool JWKS", async () => {
    const { verifyCognitoJwt } = await import("../../../supabase/functions/_shared/aws-backend");
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const toBase64Url = (bytes: Uint8Array) =>
      Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const header = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "cognito-key-1", typ: "JWT" })),
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = toBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          sub: "cognito-sub-alice",
          "custom:user_id": USER_A,
          "custom:display_name": "Alice AWS",
          email: "alice@example.com",
          iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TestPool",
          aud: "cognito-client-123",
          token_use: "id",
          exp: nowSec + 3600,
          iat: nowSec,
        }),
      ),
    );
    const sigBytes = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const jwt = `${header}.${payload}.${toBase64Url(new Uint8Array(sigBytes))}`;

    const verified = await verifyCognitoJwt(jwt, {
      region: "us-east-2",
      userPoolId: "us-east-2_TestPool",
      clientId: "cognito-client-123",
      fetch: async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...publicJwk, kid: "cognito-key-1", alg: "RS256", use: "sig" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(USER_A);
    expect(verified?.email).toBe("alice@example.com");
    expect(verified?.cognitoSub).toBe("cognito-sub-alice");
    expect(verified?.displayName).toBe("Alice AWS");
  });

  it("synchronizes Instagram account health, alerts, live Meta username updates, and read counts end-to-end", async () => {
    const { createMonitorRepository } = await import(
      "../../../supabase/functions/instagram-monitor/repository"
    );

    for (const relPath of [
      "../../../supabase/migrations/20260920000000_instagram.sql",
      "../../../supabase/migrations/20261103051144_instagram_publisher_live.sql",
      "../../../supabase/migrations/20261103090600_instagram_oauth.sql",
      "../../../supabase/migrations/20261104062523_instagram_account_monitor.sql",
      "../../../supabase/migrations/20261124000000_instagram_account_alerts_real_sync.sql",
    ]) {
      await pg.exec(readFileSync(new URL(relPath, import.meta.url), "utf8"));
    }

    const serviceClient = createAwsClient({
      apiUrl: "https://api.organizafy.site",
      clientKey: "service-role-key",
      storage: new MemoryStorage(),
      fetch: async (input, init) =>
        handleRestRequest(
          new Request(String(input), init),
          sqlExecutor,
          { role: "service_role", userId: null },
        ),
    });

    // 1. Connect an account for USER_A
    const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () => {
        const secretRes = await sqlExecutor.query<{ id: string }>(
          "SELECT vault.create_secret('live-meta-token') AS id",
        );
        const secretId = secretRes.rows[0].id;
        await sqlExecutor.query(
          "INSERT INTO public.instagram_accounts (id, user_id, username, name, status) VALUES ($1, $2, 'old_handle', 'Old Handle', 'active')",
          [accountId, USER_A],
        );
        await sqlExecutor.query(
          "INSERT INTO public.ig_publisher_connections (account_id, user_id, graph_id, secret_id, provider) VALUES ($1, $2, '17841400001', $3, 'instagram')",
          [accountId, USER_A, secretId],
        );
      },
    );

    let metaResponse: { status: number; body: Record<string, unknown> } = {
      status: 200,
      body: { id: "17841400001", username: "updated_real_handle" },
    };

    const repo = createMonitorRepository(
      serviceClient as any,
      (async () =>
        new Response(JSON.stringify(metaResponse.body), {
          status: metaResponse.status,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    );

    // Initial connection trigger already populated ig_account_health as healthy
    const initialStatus = (await repo.status(USER_A)) as {
      health: Array<{ account_id: string; state: string }>;
      alerts: Array<{ id: string; state: string; read_at: string | null; resolved_at: string | null }>;
    };
    expect(initialStatus.health).toHaveLength(1);
    expect(initialStatus.health[0].state).toBe("healthy");
    expect(initialStatus.alerts).toHaveLength(0);

    // 2. Manual refresh verifies against Meta API and updates the real username in instagram_accounts
    const refreshOk = await repo.refresh(USER_A, accountId);
    expect(refreshOk).toBe("checked");

    const updatedAccount = await serviceClient
      .from("instagram_accounts")
      .select("username")
      .eq("id", accountId)
      .single();
    expect(updatedAccount.data?.username).toBe("updated_real_handle");

    // 3. Simulate Meta token revocation (error code 190) on next check
    await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () => {
        await sqlExecutor.query(
          "UPDATE public.ig_account_health SET checked_at = now() - interval '2 minutes', next_check_at = now() + interval '3 minutes' WHERE account_id = $1",
          [accountId],
        );
      },
    );
    metaResponse = {
      status: 400,
      body: { error: { code: 190, message: "Invalid OAuth access token." } },
    };

    expect(await repo.refresh(USER_A, accountId)).toBe("checked");

    const degradedStatus = (await repo.status(USER_A)) as {
      health: Array<{ account_id: string; state: string; error_code: string }>;
      alerts: Array<{ id: string; state: string; read_at: string | null; resolved_at: string | null }>;
    };
    expect(degradedStatus.health[0].state).toBe("reconnect");
    expect(degradedStatus.health[0].error_code).toBe("meta_190");
    expect(degradedStatus.alerts).toHaveLength(1);
    expect(degradedStatus.alerts[0].state).toBe("reconnect");
    expect(degradedStatus.alerts[0].read_at).toBeNull();
    expect(degradedStatus.alerts[0].resolved_at).toBeNull();

    // Verify trigger also marked ig_publisher_connections.reconnect_required = true
    const connAfterError = await serviceClient
      .from("ig_publisher_connections")
      .select("reconnect_required")
      .eq("account_id", accountId)
      .single();
    expect(connAfterError.data?.reconnect_required).toBe(true);

    // 4. Mark alert as read and verify exact updated count via Content-Range
    const readCount = await repo.read(USER_A, degradedStatus.alerts[0].id);
    expect(readCount).toBe(1);
    expect(await repo.read(USER_A, degradedStatus.alerts[0].id)).toBe(0);

    // 5. Reconnecting the account automatically restores healthy state and resolves the alert
    await serviceClient
      .from("ig_publisher_connections")
      .update({ reconnect_required: false })
      .eq("account_id", accountId);

    const recoveredStatus = (await repo.status(USER_A)) as {
      health: Array<{ account_id: string; state: string }>;
      alerts: Array<{ id: string; state: string; resolved_at: string | null }>;
    };
    expect(recoveredStatus.health[0].state).toBe("healthy");
    expect(recoveredStatus.alerts).toHaveLength(1);
    expect(recoveredStatus.alerts[0].resolved_at).not.toBeNull();
  });

  it("claims due Instagram publication jobs as structured objects and chains RPC order/range on ig_flow_used", async () => {
    for (const relPath of [
      "../../../supabase/migrations/20261016000000_x_publisher.sql",
      "../../../supabase/migrations/20261017000000_tiktok_publisher.sql",
      "../../../supabase/migrations/20261104114149_instagram_flows.sql",
      "../../../supabase/migrations/20261106000000_instagram_campaigns.sql",
      "../../../supabase/migrations/20261111210717_meta_app_panel.sql",
      "../../../supabase/migrations/20261112020647_isolate_flow_account_and_media_failures.sql",
      "../../../supabase/migrations/20261112223428_administration_and_instagram_account_limits.sql",
      "../../../supabase/migrations/20261112233603_user_media_storage_quotas.sql",
      "../../../supabase/migrations/20261113003551_account_approval.sql",
      "../../../supabase/migrations/20261113085700_share_active_instagram_flows.sql",
      "../../../supabase/migrations/20261113123501_gap_account_delay.sql",
      "../../../supabase/migrations/20261113134117_scalable_instagram_flows.sql",
      "../../../supabase/migrations/20261115193929_publisher_capacity.sql",
      "../../../supabase/migrations/20261116191940_flow_queue_recovery.sql",
    ]) {
      await pg.exec(readFileSync(new URL(relPath, import.meta.url), "utf8"));
    }

    const serviceClient = createAwsClient({
      apiUrl: "https://api.organizafy.site",
      clientKey: "service-role-key",
      storage: new MemoryStorage(),
      fetch: async (input, init) =>
        handleRestRequest(
          new Request(String(input), init),
          sqlExecutor,
          { role: "service_role", userId: null },
        ),
    });

    const accountId = crypto.randomUUID();
    const secretRes = await runInRlsTransaction(
      sqlExecutor,
      { role: "service_role", userId: null },
      async () =>
        sqlExecutor.query<{ id: string }>(
          "SELECT vault.create_secret($1, $2, $3) AS id",
          ["EAAB_publish_token", `ig_pub_${accountId}`, "publish token"],
        ),
    );

    await serviceClient.from("instagram_accounts").insert({
      id: accountId,
      user_id: USER_A,
      username: "conta_publicacao_real",
      name: "Conta Real",
      status: "active",
    });

    await serviceClient.from("ig_publisher_connections").insert({
      account_id: accountId,
      user_id: USER_A,
      graph_id: "17841400999888777",
      secret_id: secretRes.rows[0].id,
      provider: "instagram",
      paused: false,
      reconnect_required: false,
    });

    const jobId = crypto.randomUUID();
    const mediaUrl = `storage://${USER_A}/${crypto.randomUUID()}.mp4`;
    const pastIso = new Date(Date.now() - 5_000).toISOString();

    const insertRes = await serviceClient.from("ig_publication_jobs").insert({
      id: jobId,
      user_id: USER_A,
      account_id: accountId,
      caption: "Reel teste real",
      format: "Reel",
      media_urls: [mediaUrl],
      scheduled_at: pastIso,
    });
    expect(insertRes.error).toBeNull();

    // Duplicate insert must preserve PostgreSQL SQLSTATE 23505
    const dupRes = await serviceClient.from("ig_publication_jobs").insert({
      id: jobId,
      user_id: USER_A,
      account_id: accountId,
      caption: "Reel teste real",
      format: "Reel",
      media_urls: [mediaUrl],
      scheduled_at: pastIso,
    });
    expect(dupRes.error?.code).toBe("23505");

    // Chained .order().range() on set-returning RPC ig_flow_used
    const usedRes = await serviceClient
      .rpc("ig_flow_used", { p_user: USER_A, p_urls: [mediaUrl] })
      .order("account_id")
      .order("url")
      .order("flow_id")
      .range(0, 99);
    expect(usedRes.error).toBeNull();
    expect(usedRes.data).toEqual([
      { account_id: accountId, url: mediaUrl, flow_id: null },
    ]);

    // Claiming due job via ig_claim_job_partition returns structured job row array
    const lockToken = crypto.randomUUID();
    const claimedRes = await serviceClient.rpc("ig_claim_job_partition", {
      p_token: lockToken,
      p_shard: 0,
      p_shards: 1,
    });
    expect(claimedRes.error).toBeNull();
    expect(Array.isArray(claimedRes.data)).toBe(true);
    expect(claimedRes.data).toHaveLength(1);
    expect(claimedRes.data[0]).toMatchObject({
      id: jobId,
      user_id: USER_A,
      account_id: accountId,
      format: "Reel",
      media_urls: [mediaUrl],
      status: "processing",
      lock_token: lockToken,
    });

    // Authenticated user upserting ig_flow_preferences (PK = user_id, no id column)
    const userClient = createAwsClient({
      apiUrl: "https://api.organizafy.site",
      clientKey: "cognito-client-id",
      storage: new MemoryStorage(),
      fetch: async (input, init) =>
        handleRestRequest(
          new Request(String(input), init),
          sqlExecutor,
          { role: "authenticated", userId: USER_A, email: "alice@example.com" },
        ),
    });

    const prefsFirst = await (userClient as any)
      .from("ig_flow_preferences")
      .upsert({ user_id: USER_A, folders: ["bianca r"], captions: [] });
    expect(prefsFirst.error).toBeNull();

    const prefsSecond = await (userClient as any)
      .from("ig_flow_preferences")
      .upsert(
        {
          user_id: USER_A,
          folders: ["bianca r", "ofertas"],
          captions: [],
          folder_captions: { "bianca r": ["Legenda 1"] },
        },
        { onConflict: "user_id" },
      );
    expect(prefsSecond.error).toBeNull();

    const prefsRead = await (userClient as any)
      .from("ig_flow_preferences")
      .select("*")
      .eq("user_id", USER_A)
      .single();
    expect(prefsRead.error).toBeNull();
    expect(prefsRead.data.folders).toEqual(["bianca r", "ofertas"]);
    expect(prefsRead.data.folder_captions).toEqual({ "bianca r": ["Legenda 1"] });
  });
});

/**
 * AWS Lambda + API Gateway HTTP API (v2) Runtime for Avança (organizafyd)
 *
 * Provides:
 * 1. /auth/v1/*      -> AWS Cognito User Pool Authentication + RDS auth.users sync
 * 2. /rest/v1/*      -> PostgREST-compatible SQL executor on AWS RDS / Aurora PostgreSQL
 *                       with full Row-Level Security (SET LOCAL ROLE + request.jwt.claim.sub)
 * 3. /functions/v1/* -> AWS Lambda Web Request/Response adapter for all 12 application functions
 */

export interface SqlExecutor {
  query<T = Record<string, any>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface SessionContext {
  role: "anon" | "authenticated" | "service_role";
  userId: string | null;
  email?: string;
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

export function assertIdentifier(name: string, kind = "identifier"): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`invalid_${kind}`);
  }
  return `"${name}"`;
}

export function parseSelectColumns(selectParam: string | null): string {
  if (!selectParam || selectParam.trim() === "*" || selectParam.trim() === "") {
    return "*";
  }
  const cols = selectParam
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!cols.length) return "*";
  return cols
    .map((col) => {
      if (col === "*") return "*";
      return assertIdentifier(col, "column");
    })
    .join(", ");
}

function parseInList(raw: string): string[] {
  const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
  if (!inner.trim()) return [];
  const items: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      items.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items;
}

function formatColumnRef(column: string): string {
  if (column.includes("->>")) {
    const parts = column.split("->>");
    if (parts.length === 2 && IDENTIFIER_RE.test(parts[0]) && IDENTIFIER_RE.test(parts[1])) {
      return `"${parts[0]}"->>'${parts[1]}'`;
    }
  }
  return assertIdentifier(column, "column");
}

export function buildFilterClause(
  column: string,
  expression: string,
  params: unknown[],
): string {
  const col = formatColumnRef(column);
  if (expression.startsWith("not.")) {
    const inner = buildFilterClause(column, expression.slice(4), params);
    return `NOT (${inner})`;
  }
  const dotIdx = expression.indexOf(".");
  if (dotIdx === -1) {
    throw new Error("invalid_filter");
  }
  const op = expression.slice(0, dotIdx);
  const val = expression.slice(dotIdx + 1);

  switch (op) {
    case "eq":
      params.push(val);
      return `${col} = $${params.length}`;
    case "neq":
      params.push(val);
      return `${col} <> $${params.length}`;
    case "gt":
      params.push(val);
      return `${col} > $${params.length}`;
    case "gte":
      params.push(val);
      return `${col} >= $${params.length}`;
    case "lt":
      params.push(val);
      return `${col} < $${params.length}`;
    case "lte":
      params.push(val);
      return `${col} <= $${params.length}`;
    case "like":
      params.push(val);
      return `${col}::text LIKE $${params.length}`;
    case "ilike":
      params.push(val);
      return `${col}::text ILIKE $${params.length}`;
    case "is":
      if (val === "null") return `${col} IS NULL`;
      if (val === "true") return `${col} IS TRUE`;
      if (val === "false") return `${col} IS FALSE`;
      throw new Error("invalid_is_filter");
    case "in": {
      const list = parseInList(val);
      if (!list.length) return "FALSE";
      const placeholders = list.map((item) => {
        params.push(item);
        return `$${params.length}`;
      });
      return `${col} IN (${placeholders.join(", ")})`;
    }
    case "cs": {
      params.push(val);
      const isJson = val.trim().startsWith('{"') || val.trim().startsWith("[");
      return isJson
        ? `${col}::jsonb @> $${params.length}::jsonb`
        : `${col} @> $${params.length}::text[]`;
    }
    case "cd": {
      params.push(val);
      const isJson = val.trim().startsWith('{"') || val.trim().startsWith("[");
      return isJson
        ? `${col}::jsonb <@ $${params.length}::jsonb`
        : `${col} <@ $${params.length}::text[]`;
    }
    default:
      throw new Error(`unsupported_operator_${op}`);
  }
}

export function buildWhereAndModifiers(
  searchParams: URLSearchParams,
  params: unknown[],
): { whereSql: string; orderSql: string; limitSql: string; offsetSql: string } {
  const reserved = new Set(["select", "order", "limit", "offset", "on_conflict"]);
  const conditions: string[] = [];

  for (const [key, value] of searchParams.entries()) {
    if (reserved.has(key)) continue;
    if (key === "or") {
      const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
      const parts = inner.split(",").map((part) => {
        const firstDot = part.indexOf(".");
        if (firstDot === -1) throw new Error("invalid_or_filter");
        const colName = part.slice(0, firstDot);
        const expr = part.slice(firstDot + 1);
        return buildFilterClause(colName, expr, params);
      });
      if (parts.length) {
        conditions.push(`(${parts.join(" OR ")})`);
      }
      continue;
    }
    conditions.push(buildFilterClause(key, value, params));
  }

  let orderSql = "";
  const orderParam = searchParams.get("order");
  if (orderParam) {
    const clauses = orderParam.split(",").map((part) => {
      const tokens = part.trim().split(".");
      const col = assertIdentifier(tokens[0], "column");
      const dir = tokens[1]?.toLowerCase() === "desc" ? "DESC" : "ASC";
      const nulls =
        tokens[2]?.toLowerCase() === "nullsfirst"
          ? " NULLS FIRST"
          : tokens[2]?.toLowerCase() === "nullslast"
            ? " NULLS LAST"
            : "";
      return `${col} ${dir}${nulls}`;
    });
    if (clauses.length) {
      orderSql = ` ORDER BY ${clauses.join(", ")}`;
    }
  }

  let limitSql = "";
  const limitParam = searchParams.get("limit");
  if (limitParam !== null) {
    const n = Math.max(0, Math.min(10000, Number(limitParam)));
    if (Number.isFinite(n)) {
      params.push(n);
      limitSql = ` LIMIT $${params.length}`;
    }
  }

  let offsetSql = "";
  const offsetParam = searchParams.get("offset");
  if (offsetParam !== null) {
    const n = Math.max(0, Number(offsetParam));
    if (Number.isFinite(n)) {
      params.push(n);
      offsetSql = ` OFFSET $${params.length}`;
    }
  }

  const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return { whereSql, orderSql, limitSql, offsetSql };
}

export async function runInRlsTransaction<T>(
  db: SqlExecutor,
  session: SessionContext,
  work: () => Promise<T>,
): Promise<T> {
  await db.query("BEGIN");
  try {
    const claimsJson = JSON.stringify({
      sub: session.userId || null,
      role: session.role,
      email: session.email || null,
    });
    await db.query(
      `SELECT
         set_config('request.jwt.claim.sub', $1, true),
         set_config('request.jwt.claim.role', $2, true),
         set_config('request.jwt.claims', $3, true)`,
      [session.userId || "", session.role, claimsJson],
    );
    await db.query(`SET LOCAL ROLE ${session.role}`);
    const result = await work();
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => null);
    throw err;
  }
}

const JSONB_RPC_PARAMS = new Set([
  "p_objects",
  "p_jobs",
  "p_settings",
  "p_values",
  "p_result",
]);

const JSONB_COLUMNS = new Set([
  "checklist",
  "media",
  "jobs",
  "folder_captions",
  "settings",
  "operation_result",
  "last_error_details",
  "details",
  "data",
]);

function isJsonbValue(colOrParam: string, val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (JSONB_RPC_PARAMS.has(colOrParam) || JSONB_COLUMNS.has(colOrParam)) {
    return typeof val === "object";
  }
  if (typeof val === "object" && !Array.isArray(val)) {
    return true;
  }
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null) {
    return true;
  }
  return false;
}

const primaryKeyCache = new Map<string, string>();

async function resolvePrimaryKeyColumns(db: SqlExecutor, tableName: string): Promise<string> {
  const cached = primaryKeyCache.get(tableName);
  if (cached) return cached;
  try {
    const res = await db.query<{ col: string }>(
      `SELECT a.attname AS col
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public'
          AND c.relname = $1
          AND i.indisprimary
        ORDER BY k.ord`,
      [tableName],
    );
    const cols = res.rows
      .map((r) => String(r.col).trim())
      .filter((col) => IDENTIFIER_RE.test(col))
      .join(",");
    if (cols) {
      primaryKeyCache.set(tableName, cols);
      return cols;
    }
  } catch {
    // Fallback to id if catalog introspection fails
  }
  return "id";
}

export async function handleRestRequest(
  req: Request,
  db: SqlExecutor,
  session: SessionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const pathAfterRest = url.pathname.replace(/^.*\/rest\/v1\//, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    if (pathAfterRest.startsWith("rpc/")) {
      const fnName = pathAfterRest.slice(4);
      const safeFn = assertIdentifier(fnName, "function");
      const rawBody = req.method === "POST" ? await req.text() : "";
      const args = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      const entries = Object.entries(args);
      const params: unknown[] = [];
      const namedArgs = entries.map(([k, v]) => {
        if (!IDENTIFIER_RE.test(k)) throw new Error("invalid_parameter");
        const asJsonb = isJsonbValue(k, v);
        params.push(asJsonb ? JSON.stringify(v) : v);
        return asJsonb ? `${k} := $${params.length}::jsonb` : `${k} := $${params.length}`;
      });
      const setReturningRpcs = new Set([
        "get_public_media",
        "ig_claim_job",
        "ig_claim_job_partition",
        "ig_campaign_due",
        "ig_campaign_progress",
        "ig_claim_health_checks",
        "ig_flow_used",
        "ig_flow_job_inputs",
        "ig_upgrade_legacy_selection",
        "tiktok_due_accounts",
        "tiktok_due_accounts_partition",
        "x_due_accounts",
        "x_due_accounts_partition",
        "claim_due_google_calendar_users",
        "google_calendar_due_users",
        "ig_flow_usage",
        "ig_account_flow_progress",
      ]);
      const isSetReturning = setReturningRpcs.has(fnName);
      const prefer = req.headers.get("Prefer") || "";
      const expectSingleObject =
        (req.headers.get("Accept") || "").includes("application/vnd.pgrst.object+json");
      let modifierSql = "";
      if (isSetReturning) {
        const { whereSql, orderSql, limitSql, offsetSql } = buildWhereAndModifiers(
          url.searchParams,
          params,
        );
        modifierSql = `${whereSql}${orderSql}${limitSql}${offsetSql}`;
      }
      const sql = isSetReturning
        ? `SELECT * FROM public.${safeFn}(${namedArgs.join(", ")})${modifierSql}`
        : `SELECT public.${safeFn}(${namedArgs.join(", ")}) AS result`;
      const data = await runInRlsTransaction(db, session, async () => {
        const res = await db.query<Record<string, unknown>>(sql, params);
        if (isSetReturning) {
          if (fnName === "ig_account_flow_progress" || fnName === "ig_flow_job_inputs") {
            return res.rows.map((r) => Object.values(r)[0]);
          }
          return res.rows;
        }
        return res.rows.length === 1 ? res.rows[0].result : res.rows.map((r) => r.result);
      });
      if (prefer.includes("count=") && Array.isArray(data)) {
        headers["Content-Range"] = data.length ? `0-${data.length - 1}/${data.length}` : "*/0";
      }
      if (expectSingleObject && Array.isArray(data)) {
        if (data.length !== 1) {
          return new Response(
            JSON.stringify({
              message: "JSON object requested, multiple (or no) rows returned",
              code: "PGRST116",
            }),
            { status: 406, headers },
          );
        }
        return new Response(JSON.stringify(data[0]), { status: 200, headers });
      }
      return new Response(JSON.stringify(data), { status: 200, headers });
    }

    const tableName = decodeURIComponent(pathAfterRest.split("/")[0]);
    const safeTable = `public.${assertIdentifier(tableName, "table")}`;
    const selectCols = parseSelectColumns(url.searchParams.get("select"));
    const prefer = req.headers.get("Prefer") || "";
    const expectSingleObject =
      (req.headers.get("Accept") || "").includes("application/vnd.pgrst.object+json");

    const rows = await runInRlsTransaction(db, session, async () => {
      if (req.method === "GET") {
        const params: unknown[] = [];
        const { whereSql, orderSql, limitSql, offsetSql } = buildWhereAndModifiers(
          url.searchParams,
          params,
        );
        const sql = `SELECT ${selectCols} FROM ${safeTable}${whereSql}${orderSql}${limitSql}${offsetSql}`;
        return (await db.query(sql, params)).rows;
      }

      if (req.method === "POST") {
        const payload = await req.json();
        const items = Array.isArray(payload) ? payload : [payload];
        if (!items.length) return [];
        const columns = Object.keys(items[0]);
        const safeCols = columns.map((c) => assertIdentifier(c, "column"));
        const params: unknown[] = [];
        const valueTuples = items.map((item) => {
          const placeholders = columns.map((col) => {
            const val = item[col];
            const asJsonb = isJsonbValue(col, val);
            params.push(asJsonb ? JSON.stringify(val) : val);
            return asJsonb ? `$${params.length}::jsonb` : `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });

        let conflictClause = "";
        if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
          const onConflict =
            url.searchParams.get("on_conflict") ||
            (await resolvePrimaryKeyColumns(db, tableName));
          const conflictCols = onConflict
            .split(",")
            .map((c) => assertIdentifier(c.trim(), "column"))
            .join(", ");
          if (prefer.includes("resolution=ignore-duplicates")) {
            conflictClause = ` ON CONFLICT (${conflictCols}) DO NOTHING`;
          } else {
            const updates = safeCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
            conflictClause = ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`;
          }
        }

        const sql = `INSERT INTO ${safeTable} (${safeCols.join(", ")}) VALUES ${valueTuples.join(", ")}${conflictClause} RETURNING ${selectCols}`;
        return (await db.query(sql, params)).rows;
      }

      if (req.method === "PATCH") {
        const payload = (await req.json()) as Record<string, unknown>;
        const entries = Object.entries(payload);
        if (!entries.length) return [];
        const params: unknown[] = [];
        const setClauses = entries.map(([col, val]) => {
          const safeCol = assertIdentifier(col, "column");
          const asJsonb = isJsonbValue(col, val);
          params.push(asJsonb ? JSON.stringify(val) : val);
          return asJsonb ? `${safeCol} = $${params.length}::jsonb` : `${safeCol} = $${params.length}`;
        });
        const { whereSql } = buildWhereAndModifiers(url.searchParams, params);
        const sql = `UPDATE ${safeTable} SET ${setClauses.join(", ")}${whereSql} RETURNING ${selectCols}`;
        return (await db.query(sql, params)).rows;
      }

      if (req.method === "DELETE") {
        const params: unknown[] = [];
        const { whereSql } = buildWhereAndModifiers(url.searchParams, params);
        const sql = `DELETE FROM ${safeTable}${whereSql} RETURNING ${selectCols}`;
        return (await db.query(sql, params)).rows;
      }

      throw new Error("method_not_allowed");
    });

    if (prefer.includes("count=")) {
      headers["Content-Range"] = rows.length
        ? `0-${rows.length - 1}/${rows.length}`
        : "*/0";
    }

    if (expectSingleObject) {
      if (rows.length !== 1) {
        return new Response(
          JSON.stringify({
            message: "JSON object requested, multiple (or no) rows returned",
            code: "PGRST116",
          }),
          { status: 406, headers },
        );
      }
      return new Response(JSON.stringify(rows[0]), { status: 200, headers });
    }

    return new Response(JSON.stringify(rows), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "database_error";
    const pgCode = typeof (err as any)?.code === "string" ? (err as any).code : undefined;
    const status = message === "permission denied" ? 403 : pgCode === "23505" ? 409 : 400;
    return new Response(
      JSON.stringify({ message, error: message, ...(pgCode ? { code: pgCode } : {}) }),
      { status, headers },
    );
  }
}

export interface ApiGatewayV2Event {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  source?: string;
  "detail-type"?: string;
  requestContext?: {
    http?: {
      method: string;
      path: string;
    };
    domainName?: string;
  };
}

export interface ApiGatewayV2Result {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export function eventToFetchRequest(event: ApiGatewayV2Event): Request {
  const host = event.headers?.host || event.requestContext?.domainName || "api.organizafy.site";
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `${proto}://${host}${event.rawPath || "/"}${qs}`;
  const method = (event.requestContext?.http?.method || "GET").toUpperCase();

  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (v !== undefined) headers.set(k, v);
  }

  let body: BodyInit | undefined = undefined;
  if (event.body && !["GET", "HEAD"].includes(method)) {
    body = event.isBase64Encoded
      ? Uint8Array.from(atob(event.body), (c) => c.charCodeAt(0))
      : event.body;
  }

  return new Request(url, { method, headers, body });
}

export async function fetchResponseToResult(response: Response): Promise<ApiGatewayV2Result> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const contentType = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  const isBinary =
    contentType.includes("application/octet-stream") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("image/") ||
    contentType.startsWith("audio/");
  if (isBinary) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength === 0) {
      return { statusCode: response.status, headers, body: "" };
    }
    const base64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(ab).toString("base64")
        : (() => {
            const bytes = new Uint8Array(ab);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
          })();
    return {
      statusCode: response.status,
      headers,
      body: base64,
      isBase64Encoded: true,
    };
  }
  const body = await response.text();
  return {
    statusCode: response.status,
    headers,
    body,
  };
}

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

export function buildFilterClause(
  column: string,
  expression: string,
  params: unknown[],
): string {
  const col = assertIdentifier(column, "column");
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
    case "cs":
      params.push(val);
      return `${col} @> $${params.length}`;
    case "cd":
      params.push(val);
      return `${col} <@ $${params.length}`;
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
      sub: session.userId || "",
      role: session.role,
      email: session.email || "",
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
        params.push(typeof v === "object" && v !== null && !Array.isArray(v) ? JSON.stringify(v) : v);
        return `${k} := $${params.length}`;
      });
      const sql = `SELECT public.${safeFn}(${namedArgs.join(", ")}) AS result`;
      const data = await runInRlsTransaction(db, session, async () => {
        const res = await db.query<{ result: unknown }>(sql, params);
        return res.rows.length === 1 ? res.rows[0].result : res.rows.map((r) => r.result);
      });
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
            params.push(
              val !== null && typeof val === "object" && !Array.isArray(val)
                ? JSON.stringify(val)
                : val,
            );
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });

        let conflictClause = "";
        if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
          const onConflict = url.searchParams.get("on_conflict") || "id";
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
          params.push(
            val !== null && typeof val === "object" && !Array.isArray(val)
              ? JSON.stringify(val)
              : val,
          );
          return `${safeCol} = $${params.length}`;
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
    const status = message === "permission denied" ? 403 : 400;
    return new Response(JSON.stringify({ message, error: message }), { status, headers });
  }
}

export interface ApiGatewayV2Event {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext: {
    http: {
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
  const host = event.headers?.host || event.requestContext.domainName || "api.organizafy.site";
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `${proto}://${host}${event.rawPath}${qs}`;
  const method = event.requestContext.http.method.toUpperCase();

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
  const body = await response.text();
  return {
    statusCode: response.status,
    headers,
    body,
  };
}

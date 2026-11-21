"""Read-only preflight for the AVANÇA two-admin Supabase migration.

This script never prints database URLs, tokens, passwords, or row contents.
It does not mutate either database and does not trigger publishing.
"""
import os
import sys
import psycopg

EXPECTED = {
    "old": "csaplfphtvufxjhbpstl",
    "new": "uwrsfhyjhzsaucctlksz",
}
ADMIN_IDS = (
    "1a7652be-b8f0-429c-96b7-ce8dbcddb4b0",
    "cbfb42a3-2340-4784-8796-893a40f8b522",
)
TABLES = (
    "avanca_admins",
    "ig_flows",
    "ig_publisher_connections",
    "ig_publication_jobs",
    "ig_flow_library",
    "instagram_accounts",
    "ig_meta_apps",
)
def check(label, env):
    url = os.environ.get(env)
    if not url:
        raise RuntimeError(f"{env} is missing from GitHub Actions secrets")
    # Reject accidentally swapped credentials without displaying them.
    if EXPECTED[label] not in url:
        raise RuntimeError(f"{env} points to a different Supabase project")
    print(f"{label}: secret present; project identifier matched")
    try:
        conn = psycopg.connect(url, connect_timeout=12, sslmode="require")
    except psycopg.OperationalError as exc:
        msg = str(exc).lower()
        if "network is unreachable" in msg or "no route to host" in msg:
            reason = "network unreachable (direct connection may require IPv6; use Supabase Session pooler)"
        elif "name or service not known" in msg or "could not translate host name" in msg:
            reason = "DNS hostname resolution failed"
        elif "password authentication failed" in msg:
            reason = "database password rejected"
        elif "connection refused" in msg:
            reason = "connection refused by database endpoint"
        elif "timeout" in msg or "timed out" in msg:
            reason = "connection timed out (check network and pooler endpoint)"
        else:
            reason = "database connection failed; inspect Supabase connection settings"
        raise RuntimeError(f"{label}: {reason}") from None
    with conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute("SELECT current_database(), current_user")
            database, role = cur.fetchone()
            print(f"{label}: connected to database {database}, role {role}")
            cur.execute("SELECT count(*) FROM auth.users")
            print(f"{label}: auth users = {cur.fetchone()[0]}")
            for table in TABLES:
                cur.execute(
                    f"SELECT count(*) FROM public.{table} WHERE user_id = ANY(%s::uuid[])",
                    (list(ADMIN_IDS),),
                )
                print(f"{label}: admin {table} = {cur.fetchone()[0]}")
            cur.execute(
                "SELECT count(*) FROM public.ig_account_health h "
                "WHERE EXISTS (SELECT 1 FROM public.ig_publisher_connections c "
                "WHERE c.account_id = h.account_id AND c.user_id = ANY(%s::uuid[]))",
                (list(ADMIN_IDS),),
            )
            print(f"{label}: admin ig_account_health = {cur.fetchone()[0]}")
            cur.execute(
                "SELECT count(*) FROM public.ig_flow_shared_accounts s "
                "WHERE EXISTS (SELECT 1 FROM public.ig_flows f "
                "WHERE f.id = s.flow_id AND f.user_id = ANY(%s::uuid[]))",
                (list(ADMIN_IDS),),
            )
            print(f"{label}: admin ig_flow_shared_accounts = {cur.fetchone()[0]}")
            cur.execute(
                "WITH refs AS ("
                " SELECT secret_id FROM public.ig_publisher_connections "
                " WHERE user_id = ANY(%s::uuid[]) AND secret_id IS NOT NULL "
                " UNION "
                " SELECT secret_id FROM public.ig_meta_apps "
                " WHERE user_id = ANY(%s::uuid[]) AND secret_id IS NOT NULL"
                ") SELECT count(*), count(*) FILTER (WHERE v.id IS NULL) "
                "FROM refs LEFT JOIN vault.secrets v ON v.id = refs.secret_id",
                (list(ADMIN_IDS), list(ADMIN_IDS)),
            )
            secret_count, missing_secrets = cur.fetchone()
            print(f"{label}: referenced Vault secrets = {secret_count}; missing = {missing_secrets}")
            if label == "old" and missing_secrets:
                raise RuntimeError("Old project has broken Vault references")
            cur.execute(
                "SELECT count(*) FROM public.ig_publication_jobs j "
                "WHERE j.user_id = ANY(%s::uuid[]) AND j.flow_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM public.ig_flows f "
                "WHERE f.id = j.flow_id AND f.user_id = ANY(%s::uuid[]))",
                (list(ADMIN_IDS), list(ADMIN_IDS)),
            )
            foreign_flow_jobs = cur.fetchone()[0]
            print(f"{label}: cross-owner publication flows = {foreign_flow_jobs}")
            if foreign_flow_jobs:
                raise RuntimeError("Publication jobs reference another owner's flow")
            cur.execute(
                "SELECT bucket_id, count(*) FROM storage.objects "
                "WHERE split_part(name, '/', 1) = ANY(%s::text[]) "
                "GROUP BY bucket_id ORDER BY bucket_id",
                (list(ADMIN_IDS),),
            )
            for bucket, count in cur.fetchall():
                print(f"{label}: admin storage {bucket} = {count}")
        conn.rollback()
def main():
    for label, env in (("old", "OLD_SUPABASE_DB_URL"), ("new", "NEW_SUPABASE_DB_URL")):
        check(label, env)
    print("Preflight passed. No records were changed.")
if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # psycopg exceptions may contain connection details; never print them.
        if isinstance(exc, RuntimeError):
            print(f"Preflight failed: {exc}", file=sys.stderr)
        else:
            print(f"Preflight failed ({type(exc).__name__}); verify table schema and database permissions.", file=sys.stderr)
        sys.exit(1)

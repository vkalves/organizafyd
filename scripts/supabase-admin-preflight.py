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
        raise RuntimeError(f"{env} is missing")
    # Reject accidentally swapped credentials without displaying them.
    if f"db.{EXPECTED[label]}.supabase.co" not in url:
        raise RuntimeError(f"{env} does not point to the expected project")
    with psycopg.connect(url, connect_timeout=12, sslmode="require") as conn:
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
        print(f"Preflight failed ({type(exc).__name__}). Check secrets, SSL, network, and permissions.", file=sys.stderr)
        sys.exit(1)

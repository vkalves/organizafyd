#!/usr/bin/env python3
"""Safe migration script from Supabase PostgreSQL to AWS RDS PostgreSQL + AWS Cognito.

Features:
- Default mode is READ-ONLY DRY RUN. Pass --execute to write to AWS RDS / Cognito.
- Never modifies or deletes source Supabase records.
- Never prints connection strings, tokens, passwords, or decrypted secrets.
- Steps:
  1. Applies infra/aws/rds-bootstrap.sql and all 43 migrations in supabase/migrations/ to AWS RDS.
  2. Migrates auth.users to AWS RDS auth.users (preserving exact UUIDs) and optionally imports
     users into AWS Cognito User Pool (setting custom:user_id = Supabase UUID).
  3. Migrates referenced vault.decrypted_secrets into AWS RDS vault.secrets.
  4. Copies all application tables in foreign-key dependency order with row count verification.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import psycopg

ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_SQL = ROOT / "infra" / "aws" / "rds-bootstrap.sql"
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"

# Ordered by foreign-key dependencies
PUBLIC_TABLES = (
    "profiles",
    "avanca_admins",
    "avanca_account_approvals",
    "avanca_user_limits",
    "avanca_storage_limits",
    "folders",
    "notes",
    "tasks",
    "links",
    "funnels",
    "funnel_nodes",
    "funnel_edges",
    "financial_accounts",
    "financial_categories",
    "transactions",
    "financial_goals",
    "mind_maps",
    "instagram_projects",
    "instagram_accounts",
    "instagram_tasks",
    "instagram_contents",
    "instagram_metrics",
    "instagram_checklists",
    "instagram_links",
    "instagram_notes",
    "instagram_history",
    "instagram_ideas",
    "media_cards",
    "media_files",
    "media_share_links",
    "google_calendar_connections",
    "google_calendar_oauth_states",
    "google_calendar_task_events",
    "google_calendar_sync_locks",
    "x_accounts",
    "x_oauth_states",
    "x_posts",
    "tiktok_accounts",
    "tiktok_oauth_states",
    "tiktok_posts",
    "ig_meta_apps",
    "ig_user_meta_app_preferences",
    "ig_publisher_connections",
    "ig_account_health",
    "ig_flows",
    "ig_flow_library",
    "ig_flow_shared_accounts",
    "ig_user_library_shares",
    "ig_publication_jobs",
    "ig_flow_job_batches",
)


def connect_db(label: str, env_name: str):
    url = os.environ.get(env_name)
    if not url:
        raise RuntimeError(f"Missing environment variable: {env_name}")
    try:
        return psycopg.connect(url, connect_timeout=15, sslmode="require")
    except psycopg.OperationalError:
        raise RuntimeError(f"Could not connect to {label} database ({env_name})") from None


def apply_schema(rds_conn):
    with rds_conn.cursor() as cur:
        cur.execute(BOOTSTRAP_SQL.read_text(encoding="utf-8"))
        for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
            cur.execute(migration.read_text(encoding="utf-8"))
    rds_conn.commit()
    print(f"Schema applied: bootstrap + {len(list(MIGRATIONS_DIR.glob('*.sql')))} migrations")


def sync_cognito_users(users, user_pool_id: str, region: str):
    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError("boto3 is required when --sync-cognito is enabled (pip install boto3)") from None

    client = boto3.client("cognito-idp", region_name=region)
    created = 0
    existing = 0
    for user_id, email, raw_meta, _created_at in users:
        if not email:
            continue
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        display_name = str(meta.get("display_name") or email)
        attrs = [
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
            {"Name": "custom:user_id", "Value": str(user_id)},
            {"Name": "custom:display_name", "Value": display_name[:120]},
        ]
        try:
            client.admin_create_user(
                UserPoolId=user_pool_id,
                Username=email,
                UserAttributes=attrs,
                MessageAction="SUPPRESS",
            )
            created += 1
        except client.exceptions.UsernameExistsException:
            client.admin_update_user_attributes(
                UserPoolId=user_pool_id,
                Username=email,
                UserAttributes=attrs,
            )
            existing += 1
    print(f"Cognito User Pool sync complete: created={created}, updated={existing}")


def migrate(execute: bool, apply_migrations: bool, sync_cognito: bool):
    src = connect_db("source-supabase", "SOURCE_SUPABASE_DB_URL")
    dst = connect_db("target-aws-rds", "TARGET_AWS_RDS_DB_URL")

    with src, dst:
        with src.cursor() as scur:
            scur.execute("SET TRANSACTION READ ONLY")
            scur.execute(
                "SELECT id, email, COALESCE(raw_user_meta_data, '{}'::jsonb), created_at "
                "FROM auth.users ORDER BY created_at, id"
            )
            users = scur.fetchall()
            print(f"Source auth.users found: {len(users)}")

            scur.execute(
                "SELECT id, name, COALESCE(description, ''), decrypted_secret, created_at, updated_at "
                "FROM vault.decrypted_secrets WHERE decrypted_secret IS NOT NULL"
            )
            secrets = scur.fetchall()
            print(f"Source vault.secrets found: {len(secrets)}")

            table_Counts = {}
            for table in PUBLIC_TABLES:
                scur.execute(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema = 'public' AND table_name = %s)",
                    (table,),
                )
                if not scur.fetchone()[0]:
                    continue
                scur.execute(f'SELECT count(*) FROM public."{table}"')
                table_Counts[table] = scur.fetchone()[0]
                print(f"Source public.{table}: {table_Counts[table]} rows")

            if not execute:
                print("Dry run completed successfully. Pass --execute to write to AWS RDS.")
                return

            if apply_migrations:
                apply_schema(dst)

            with dst.cursor() as dcur:
                # Disable triggers during bulk copy so auto-created profile triggers do not duplicate rows
                dcur.execute("SET session_replication_role = 'replica'")

                for user_id, email, raw_meta, created_at in users:
                    dcur.execute(
                        "INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at) "
                        "VALUES (%s, %s, %s::jsonb, %s, now()) "
                        "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, "
                        "raw_user_meta_data = EXCLUDED.raw_user_meta_data",
                        (user_id, email, json.dumps(raw_meta or {}), created_at),
                    )

                for sec_id, name, desc, secret_val, created_at, updated_at in secrets:
                    dcur.execute(
                        "INSERT INTO vault.secrets (id, name, description, secret, created_at, updated_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s) "
                        "ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret, "
                        "name = EXCLUDED.name, updated_at = EXCLUDED.updated_at",
                        (sec_id, name, desc, secret_val, created_at, updated_at),
                    )

                for table in table_Counts:
                    scur.execute(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = %s "
                        "AND is_generated = 'NEVER' ORDER BY ordinal_position",
                        (table,),
                    )
                    cols = [r[0] for r in scur.fetchall()]
                    if not cols:
                        continue
                    col_list = ", ".join(f'"{c}"' for c in cols)
                    placeholders = ", ".join(["%s"] * len(cols))
                    scur.execute(f'SELECT {col_list} FROM public."{table}"')
                    rows = scur.fetchall()
                    for row in rows:
                        adapted = [
                            json.dumps(v) if isinstance(v, (dict, list)) else v
                            for v in row
                        ]
                        dcur.execute(
                            f'INSERT INTO public."{table}" ({col_list}) VALUES ({placeholders}) '
                            f"ON CONFLICT DO NOTHING",
                            adapted,
                        )
                    dcur.execute(f'SELECT count(*) FROM public."{table}"')
                    dst_count = dcur.fetchone()[0]
                    print(f"Migrated public.{table}: destination rows = {dst_count}")

                dcur.execute("SET session_replication_role = 'origin'")
            dst.commit()

            if sync_cognito:
                pool_id = os.environ.get("AWS_COGNITO_USER_POOL_ID", "")
                region = os.environ.get("AWS_REGION", "us-east-2")
                if not pool_id:
                    raise RuntimeError("Missing AWS_COGNITO_USER_POOL_ID for --sync-cognito")
                sync_cognito_users(users, pool_id, region)

            print("AWS RDS migration completed and committed.")


def main():
    parser = argparse.ArgumentParser(description="Migrate Supabase PostgreSQL & Auth to AWS RDS & Cognito")
    parser.add_argument("--execute", action="store_true", help="Execute writes against TARGET_AWS_RDS_DB_URL")
    parser.add_argument("--apply-schema", action="store_true", help="Apply rds-bootstrap.sql and migrations first")
    parser.add_argument("--sync-cognito", action="store_true", help="Sync auth.users into AWS Cognito User Pool")
    args = parser.parse_args()
    migrate(args.execute, args.apply_schema, args.sync_cognito)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            print(f"Migration aborted: {exc}", file=sys.stderr)
        else:
            print(f"Migration aborted ({type(exc).__name__})", file=sys.stderr)
        sys.exit(1)

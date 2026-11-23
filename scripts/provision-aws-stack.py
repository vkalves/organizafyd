#!/usr/bin/env python3
"""Idempotent AWS Stack Provisioner for Avança (organizafyd).

Provisions or reuses in AWS (default region us-east-2):
1. AWS Cognito User Pool (avanca-users) & Web Client (avanca-web-client)
2. AWS S3 Bucket (avanca-files-108327566923-us-east-2)
3. AWS RDS PostgreSQL 16 Instance (avanca-postgres) + Security Group
4. AWS Secrets Manager Secret (avanca/backend/config)
5. AWS API Gateway HTTP API v2 (avanca-api)

Never prints secret keys or database passwords to logs.
Writes public frontend configuration (VITE_AWS_*) to GITHUB_STEP_SUMMARY and GITHUB_ENV.
"""
import argparse
import json
import os
import secrets
import string
import sys
import time
from urllib.parse import quote

ALLOWED_ORIGINS = [
    "https://xn--avana-1ra.online",
    "https://www.xn--avana-1ra.online",
    "https://organizafy.site",
    "https://www.organizafy.site",
    "https://organizafyd.vercel.app",
]


def generate_password(length=32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def ensure_cognito(cognito, pool_name="avanca-users", client_name="avanca-web-client"):
    pool_id = None
    paginator = cognito.get_paginator("list_user_pools")
    for page in paginator.paginate(MaxResults=60):
        for pool in page.get("UserPools", []):
            if pool.get("Name") == pool_name:
                pool_id = pool["Id"]
                break
        if pool_id:
            break

    if not pool_id:
        res = cognito.create_user_pool(
            PoolName=pool_name,
            UsernameAttributes=["email"],
            AutoVerifiedAttributes=["email"],
            Policies={
                "PasswordPolicy": {
                    "MinimumLength": 6,
                    "RequireUppercase": False,
                    "RequireLowercase": False,
                    "RequireNumbers": False,
                    "RequireSymbols": False,
                    "TemporaryPasswordValidityDays": 7,
                }
            },
            Schema=[
                {
                    "Name": "email",
                    "AttributeDataType": "String",
                    "Required": True,
                    "Mutable": True,
                },
                {
                    "Name": "user_id",
                    "AttributeDataType": "String",
                    "Required": False,
                    "Mutable": True,
                    "StringAttributeConstraints": {"MinLength": "1", "MaxLength": "64"},
                },
                {
                    "Name": "display_name",
                    "AttributeDataType": "String",
                    "Required": False,
                    "Mutable": True,
                    "StringAttributeConstraints": {"MinLength": "1", "MaxLength": "120"},
                },
            ],
            AccountRecoverySetting={
                "RecoveryMechanisms": [{"Priority": 1, "Name": "verified_email"}]
            },
        )
        pool_id = res["UserPool"]["Id"]
        print(f"Created Cognito User Pool: {pool_id}")
    else:
        print(f"Reusing existing Cognito User Pool: {pool_id}")

    client_id = None
    clients = cognito.list_user_pool_clients(UserPoolId=pool_id, MaxResults=60).get(
        "UserPoolClients", []
    )
    for c in clients:
        if c.get("ClientName") == client_name:
            client_id = c["ClientId"]
            break

    if not client_id:
        res = cognito.create_user_pool_client(
            UserPoolId=pool_id,
            ClientName=client_name,
            GenerateSecret=False,
            PreventUserExistenceErrors="ENABLED",
            ExplicitAuthFlows=[
                "ALLOW_USER_PASSWORD_AUTH",
                "ALLOW_REFRESH_TOKEN_AUTH",
                "ALLOW_USER_SRP_AUTH",
            ],
            AccessTokenValidity=1,
            IdTokenValidity=1,
            RefreshTokenValidity=30,
            TokenValidityUnits={
                "AccessToken": "hours",
                "IdToken": "hours",
                "RefreshToken": "days",
            },
        )
        client_id = res["UserPoolClient"]["ClientId"]
        print(f"Created Cognito App Client: {client_id}")
    else:
        print(f"Reusing existing Cognito App Client: {client_id}")

    return pool_id, client_id


def ensure_s3_bucket(s3, bucket_name: str, region: str):
    try:
        s3.head_bucket(Bucket=bucket_name)
        print(f"Verified existing S3 bucket: {bucket_name}")
    except Exception:
        create_kwargs = {"Bucket": bucket_name}
        if region != "us-east-1":
            create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**create_kwargs)
        s3.put_public_access_block(
            Bucket=bucket_name,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )
        s3.put_bucket_versioning(
            Bucket=bucket_name, VersioningConfiguration={"Status": "Enabled"}
        )
        print(f"Created S3 bucket: {bucket_name}")


def ensure_api_gateway(apigw, api_name="avanca-api"):
    api_id = None
    api_endpoint = None
    for item in apigw.get_apis().get("Items", []):
        if item.get("Name") == api_name:
            api_id = item["ApiId"]
            api_endpoint = item["ApiEndpoint"]
            break

    if not api_id:
        res = apigw.create_api(
            Name=api_name,
            ProtocolType="HTTP",
            CorsConfiguration={
                "AllowOrigins": ALLOWED_ORIGINS,
                "AllowMethods": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                "AllowHeaders": [
                    "authorization",
                    "apikey",
                    "content-type",
                    "prefer",
                    "accept",
                    "range",
                    "x-client-info",
                ],
                "ExposeHeaders": ["content-range"],
                "MaxAge": 300,
            },
        )
        api_id = res["ApiId"]
        api_endpoint = res["ApiEndpoint"]
        apigw.create_stage(ApiId=api_id, StageName="$default", AutoDeploy=True)
        print(f"Created API Gateway HTTP API: {api_endpoint}")
    else:
        print(f"Reusing existing API Gateway HTTP API: {api_endpoint}")

    return api_id, api_endpoint


def ensure_secrets_manager(sm, secret_name: str, defaults: dict) -> dict:
    try:
        existing = sm.get_secret_value(SecretId=secret_name)
        data = json.loads(existing.get("SecretString", "{}"))
        changed = False
        for k, v in defaults.items():
            if not data.get(k) and v:
                data[k] = v
                changed = True
        if changed:
            sm.put_secret_value(SecretId=secret_name, SecretString=json.dumps(data))
        return data
    except sm.exceptions.ResourceNotFoundException:
        sm.create_secret(Name=secret_name, SecretString=json.dumps(defaults))
        print(f"Created Secrets Manager entry: {secret_name}")
        return defaults


def ensure_rds(rds, ec2, sm, secret_name="avanca/backend/config", db_identifier="avanca-postgres"):
    secret_data = ensure_secrets_manager(
        sm,
        secret_name,
        {
            "RDS_MASTER_PASSWORD": generate_password(32),
            "AWS_SERVICE_ROLE_KEY": generate_password(64),
        },
    )
    master_password = secret_data["RDS_MASTER_PASSWORD"]

    # Ensure security group allowing PostgreSQL 5432
    vpcs = ec2.describe_vpcs(Filters=[{"Name": "is-default", "Values": ["true"]}]).get("Vpcs", [])
    if not vpcs:
        vpcs = ec2.describe_vpcs().get("Vpcs", [])
    vpc_id = vpcs[0]["VpcId"]

    sg_name = "avanca-postgres-sg"
    sgs = ec2.describe_security_groups(
        Filters=[
            {"Name": "group-name", "Values": [sg_name]},
            {"Name": "vpc-id", "Values": [vpc_id]},
        ]
    ).get("SecurityGroups", [])
    if sgs:
        sg_id = sgs[0]["GroupId"]
    else:
        sg_id = ec2.create_security_group(
            GroupName=sg_name,
            Description="Avanca RDS PostgreSQL access",
            VpcId=vpc_id,
        )["GroupId"]
        ec2.authorize_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    "IpProtocol": "tcp",
                    "FromPort": 5432,
                    "ToPort": 5432,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "SSL PostgreSQL access"}],
                }
            ],
        )

    try:
        instances = rds.describe_db_instances(DBInstanceIdentifier=db_identifier)["DBInstances"]
        instance = instances[0]
        print(f"Found existing RDS instance: {db_identifier} (status={instance['DBInstanceStatus']})")
    except rds.exceptions.DBInstanceNotFoundFault:
        print(f"Creating RDS PostgreSQL instance: {db_identifier} (this takes ~5-8 minutes)...")
        rds.create_db_instance(
            DBInstanceIdentifier=db_identifier,
            DBName="avanca",
            Engine="postgres",
            DBInstanceClass="db.t4g.micro",
            AllocatedStorage=20,
            MaxAllocatedStorage=100,
            StorageType="gp3",
            StorageEncrypted=True,
            MasterUsername="avanca_admin",
            MasterUserPassword=master_password,
            VpcSecurityGroupIds=[sg_id],
            PubliclyAccessible=True,
            BackupRetentionPeriod=7,
            CopyTagsToSnapshot=True,
            DeletionProtection=False,
        )

    # Wait until endpoint is available
    for _ in range(90):
        instance = rds.describe_db_instances(DBInstanceIdentifier=db_identifier)["DBInstances"][0]
        endpoint = instance.get("Endpoint", {}).get("Address")
        status = instance.get("DBInstanceStatus")
        if endpoint and status == "available":
            port = instance["Endpoint"].get("Port", 5432)
            db_url = f"postgresql://avanca_admin:{quote(master_password, safe='')}@{endpoint}:{port}/avanca?sslmode=require"
            secret_data["DATABASE_URL"] = db_url
            secret_data["RDS_ENDPOINT"] = f"{endpoint}:{port}"
            sm.put_secret_value(SecretId=secret_name, SecretString=json.dumps(secret_data))
            print(f"RDS PostgreSQL ready at: {endpoint}:{port}")
            return db_url, f"{endpoint}:{port}"
        time.sleep(15)

    raise RuntimeError("Timed out waiting for RDS PostgreSQL instance to become available")


def main():
    parser = argparse.ArgumentParser(description="Provision AWS stack for Avança")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-2"))
    parser.add_argument("--bucket", default=os.environ.get("AWS_S3_BUCKET", ""))
    parser.add_argument("--skip-rds", action="store_true", help="Skip RDS creation if using an existing TARGET_AWS_RDS_DB_URL")
    args = parser.parse_args()

    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError("boto3 is required (pip install boto3)") from None

    session = boto3.Session(region_name=args.region)
    sts = session.client("sts")
    account_id = sts.get_caller_identity()["Account"]
    bucket_name = args.bucket or f"avanca-files-{account_id}-{args.region}"

    cognito = session.client("cognito-idp")
    s3 = session.client("s3")
    apigw = session.client("apigatewayv2")
    sm = session.client("secretsmanager")
    rds = session.client("rds")
    ec2 = session.client("ec2")

    ensure_s3_bucket(s3, bucket_name, args.region)
    pool_id, client_id = ensure_cognito(cognito)
    _api_id, api_endpoint = ensure_api_gateway(apigw)

    rds_endpoint = ""
    if not args.skip_rds and not os.environ.get("TARGET_AWS_RDS_DB_URL"):
        db_url, rds_endpoint = ensure_rds(rds, ec2, sm)
    else:
        db_url = os.environ.get("TARGET_AWS_RDS_DB_URL", "")

    ensure_secrets_manager(
        sm,
        "avanca/backend/config",
        {
            "AWS_COGNITO_USER_POOL_ID": pool_id,
            "AWS_COGNITO_CLIENT_ID": client_id,
            "AWS_API_URL": api_endpoint,
            "AWS_S3_BUCKET": bucket_name,
            "AWS_REGION": args.region,
        },
    )

    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as f:
            f.write(f"AWS_COGNITO_USER_POOL_ID={pool_id}\n")
            f.write(f"AWS_COGNITO_CLIENT_ID={client_id}\n")
            f.write(f"VITE_AWS_API_URL={api_endpoint}\n")
            f.write(f"VITE_AWS_REGION={args.region}\n")
            if db_url:
                f.write(f"TARGET_AWS_RDS_DB_URL={db_url}\n")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    summary_md = (
        "## Infraestrutura AWS Provisionada (`us-east-2`)\n\n"
        "Copie as variáveis públicas abaixo para o painel da **Vercel** (*Settings → Environment Variables*):\n\n"
        "```dotenv\n"
        f"VITE_AWS_API_URL={api_endpoint}\n"
        f"VITE_AWS_REGION={args.region}\n"
        f"VITE_AWS_COGNITO_USER_POOL_ID={pool_id}\n"
        f"VITE_AWS_COGNITO_CLIENT_ID={client_id}\n"
        "VITE_STORAGE_PROVIDER=aws\n"
        "```\n"
    )
    if rds_endpoint:
        summary_md += f"\n- **RDS Endpoint**: `{rds_endpoint}` (credenciais salvas no AWS Secrets Manager em `avanca/backend/config`)\n"
    print(summary_md)
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(summary_md)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Provisioning failed: {exc}", file=sys.stderr)
        sys.exit(1)

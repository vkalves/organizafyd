# =============================================================================
# Terraform Infrastructure for Avança (organizafyd) — Complete AWS Stack
# =============================================================================
# Components:
# 1. AWS RDS PostgreSQL 16 (Database + RLS + Vault schema)
# 2. AWS Cognito User Pool & Client (Authentication)
# 3. AWS S3 Bucket (Media Storage — avanca-files-*)
# 4. AWS Lambda + API Gateway HTTP API v2 (/auth/v1, /rest/v1, /functions/v1/*)
# 5. Amazon EventBridge Schedules (Background Publishers & Monitors)
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "aws_region" {
  type        = string
  default     = "us-east-2"
  description = "AWS region for all Avança resources"
}

variable "project_name" {
  type        = string
  default     = "avanca"
  description = "Project prefix for resource naming"
}

variable "s3_bucket_name" {
  type        = string
  default     = "avanca-files-108327566923-us-east-2"
  description = "Private S3 bucket for media, instagram-publisher, x-media, and tiktok-media"
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS PostgreSQL instance class"
}

variable "allowed_origins" {
  type = list(string)
  default = [
    "https://xn--avana-1ra.online",
    "https://www.xn--avana-1ra.online",
    "https://organizafy.site",
    "https://www.organizafy.site",
    "https://organizafyd.vercel.app"
  ]
}

provider "aws" {
  region = var.aws_region
}

# -----------------------------------------------------------------------------
# 1. AWS Cognito User Pool (Replaces Supabase Auth)
# -----------------------------------------------------------------------------
resource "aws_cognito_user_pool" "avanca" {
  name                     = "${var.project_name}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 6
    require_lowercase                = false
    require_numbers                  = false
    require_symbols                  = false
    require_uppercase                = false
    temporary_password_validity_days = 7
  }

  schema {
    name                = "user_id"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 36
      max_length = 36
    }
  }

  schema {
    name                = "display_name"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 1
      max_length = 120
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web-client"
  user_pool_id = aws_cognito_user_pool.avanca.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# -----------------------------------------------------------------------------
# 2. AWS RDS PostgreSQL 16 (Replaces Supabase Postgres + Vault)
# -----------------------------------------------------------------------------
resource "random_password" "rds_master" {
  length  = 32
  special = false
}

resource "random_password" "service_role_key" {
  length  = 64
  special = false
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.project_name}-postgres"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  max_allocated_storage  = 100
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = "avanca"
  username               = "avanca_admin"
  password               = random_password.rds_master.result
  publicly_accessible    = false
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.project_name}-postgres-final"
  backup_retention_period = 7
  deletion_protection    = true
}

resource "aws_secretsmanager_secret" "app_secrets" {
  name = "${var.project_name}/backend/config"
}

resource "aws_secretsmanager_secret_version" "app_secrets_v1" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    DATABASE_URL             = "postgresql://${aws_db_instance.postgres.username}:${random_password.rds_master.result}@${aws_db_instance.postgres.endpoint}/${aws_db_instance.postgres.db_name}?sslmode=require"
    AWS_SERVICE_ROLE_KEY     = random_password.service_role_key.result
    AWS_COGNITO_USER_POOL_ID = aws_cognito_user_pool.avanca.id
    AWS_COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.web.id
    AWS_S3_BUCKET            = var.s3_bucket_name
    AWS_REGION               = var.aws_region
  })
}

# -----------------------------------------------------------------------------
# 3. AWS S3 Storage Bucket (Private with Presigned POST/GET via s3-storage)
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "storage" {
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_public_access_block" "storage" {
  bucket                  = aws_s3_bucket.storage.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "storage" {
  bucket = aws_s3_bucket.storage.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = var.allowed_origins
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 300
  }

  cors_rule {
    allowed_headers = ["Range", "If-None-Match", "If-Modified-Since"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag"]
    max_age_seconds = 300
  }
}

# -----------------------------------------------------------------------------
# 4. AWS IAM Role & Lambda Functions (Replaces Supabase Edge Functions & PostgREST)
# -----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_exec" {
  name = "${var.project_name}-lambda-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_s3_and_secrets" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListBucketPrefixesOnly"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.storage.arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["media/*", "instagram-publisher/*", "x-media/*", "tiktok-media/*"]
          }
        }
      },
      {
        Sid      = "ReadWriteAllowedPrefixesOnly"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${aws_s3_bucket.storage.arn}/media/*",
          "${aws_s3_bucket.storage.arn}/instagram-publisher/*",
          "${aws_s3_bucket.storage.arn}/x-media/*",
          "${aws_s3_bucket.storage.arn}/tiktok-media/*"
        ]
      },
      {
        Sid      = "ReadBackendSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.app_secrets.arn]
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

locals {
  functions = toset([
    "app-admin",
    "google-calendar",
    "instagram-accounts",
    "instagram-login",
    "instagram-media",
    "instagram-monitor",
    "instagram-publisher",
    "instagram-reel-import",
    "reset-daily-tasks",
    "s3-storage",
    "tiktok-publisher",
    "x-publisher"
  ])
}

# -----------------------------------------------------------------------------
# 5. AWS API Gateway HTTP API v2 (Unified Endpoint for Auth, REST & Functions)
# -----------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "http_api" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "apikey", "content-type", "prefer", "accept", "range", "x-client-info"]
    expose_headers = ["content-range"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

# -----------------------------------------------------------------------------
# Outputs for Frontend (.env) and Migration Script
# -----------------------------------------------------------------------------
output "VITE_AWS_API_URL" {
  value       = aws_apigatewayv2_api.http_api.api_endpoint
  description = "API Gateway URL for frontend VITE_AWS_API_URL"
}

output "VITE_AWS_REGION" {
  value       = var.aws_region
  description = "AWS Region for frontend VITE_AWS_REGION"
}

output "VITE_AWS_COGNITO_USER_POOL_ID" {
  value       = aws_cognito_user_pool.avanca.id
  description = "Cognito User Pool ID for VITE_AWS_COGNITO_USER_POOL_ID"
}

output "VITE_AWS_COGNITO_CLIENT_ID" {
  value       = aws_cognito_user_pool_client.web.id
  description = "Cognito App Client ID for VITE_AWS_COGNITO_CLIENT_ID"
}

output "RDS_ENDPOINT" {
  value       = aws_db_instance.postgres.endpoint
  description = "AWS RDS PostgreSQL endpoint"
}

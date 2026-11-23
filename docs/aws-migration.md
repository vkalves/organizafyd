# Migração Completa do Supabase para a AWS — Avança (`organizafyd`)

Este guia documenta a arquitetura e o processo de migração completa do Supabase (Auth, PostgreSQL, Edge Functions e Storage) para a **AWS**:

| Componente Antigo (Supabase) | Serviço AWS Equivalente | Arquivos no Repositório |
| --- | --- | --- |
| **Supabase Auth** | **AWS Cognito User Pool** + Gateway `/auth/v1/*` | [`infra/aws/lambda/cognito-auth.ts`](../infra/aws/lambda/cognito-auth.ts), [`src/integrations/aws/client.ts`](../src/integrations/aws/client.ts) |
| **Supabase Postgres + RLS + Vault** | **AWS RDS PostgreSQL 16** (com schemas `auth`, `vault`, `storage` e RLS nativo) | [`infra/aws/rds-bootstrap.sql`](../infra/aws/rds-bootstrap.sql), [`supabase/migrations/`](../supabase/migrations/) |
| **PostgREST (`/rest/v1/*`)** | **AWS API Gateway HTTP API (v2) + AWS Lambda** (`handleRestRequest`) | [`infra/aws/lambda/api-gateway.ts`](../infra/aws/lambda/api-gateway.ts) |
| **Supabase Edge Functions (`/functions/v1/*`)** | **AWS Lambda + Amazon EventBridge Scheduler** | [`supabase/functions/_shared/aws-backend.ts`](../supabase/functions/_shared/aws-backend.ts), [`supabase/functions/*`](../supabase/functions/) |
| **Supabase Storage** | **Amazon S3** (`avanca-files-108327566923-us-east-2`) | [`supabase/functions/s3-storage/index.ts`](../supabase/functions/s3-storage/index.ts), [`infra/aws/storage-*.json`](../infra/aws/) |

---

## 1. Provisionamento da Infraestrutura na AWS (Terraform)

A infraestrutura completa está declarada em [`infra/aws/main.tf`](../infra/aws/main.tf) na região `us-east-2`:

```bash
cd infra/aws
terraform init
terraform plan
terraform apply
```

Ao concluir, o Terraform exibirá os outputs necessários para o frontend e para os scripts de migração:
- `VITE_AWS_API_URL` (endpoint do AWS API Gateway)
- `VITE_AWS_REGION` (`us-east-2`)
- `VITE_AWS_COGNITO_USER_POOL_ID`
- `VITE_AWS_COGNITO_CLIENT_ID`
- `RDS_ENDPOINT`

---

## 2. Migração do Banco de Dados, Segredos (Vault) e Usuários (Cognito)

O script [`scripts/migrate-supabase-to-aws.py`](../scripts/migrate-supabase-to-aws.py) executa por padrão em modo **dry-run (somente leitura)** e nunca apaga dados da origem:

### Passo 2.1 — Verificação (Dry Run)
```bash
export SOURCE_SUPABASE_DB_URL="postgresql://postgres.<project>:[PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require"
export TARGET_AWS_RDS_DB_URL="postgresql://avanca_admin:[PASSWORD]@<rds-endpoint>:5432/avanca?sslmode=require"

python3 scripts/migrate-supabase-to-aws.py
```

### Passo 2.2 — Aplicar Schema (`rds-bootstrap.sql` + 43 migrações), Copiar Dados e Sincronizar Cognito
```bash
export AWS_REGION="us-east-2"
export AWS_COGNITO_USER_POOL_ID="us-east-2_XXXXXXXXX"

python3 scripts/migrate-supabase-to-aws.py --execute --apply-schema --sync-cognito
```

O que este comando faz:
1. Aplica [`infra/aws/rds-bootstrap.sql`](../infra/aws/rds-bootstrap.sql) criando as roles (`anon`, `authenticated`, `service_role`), funções de sessão JWT (`auth.uid()`, `auth.role()`, `auth.jwt()`, `auth.sync_cognito_user()`), o cofre `vault.secrets` / `vault.decrypted_secrets`, e metadados de `storage`.
2. Aplica todas as 43 migrações SQL de `supabase/migrations/` em ordem cronológica.
3. Copia todos os registros de `auth.users` preservando os **mesmos UUIDs**, sincronizando-os também no **AWS Cognito User Pool** com o atributo `custom:user_id`.
4. Copia os segredos criptografados do `vault` (tokens de conexões Instagram, Meta Apps, etc.) e todas as tabelas de `public.*` em ordem topológica de chaves estrangeiras.

---

## 3. Armazenamento no Amazon S3 (`s3-storage`)

- O cliente de armazenamento ([`src/lib/storage/index.ts`](../src/lib/storage/index.ts)) e as rotas públicas ([`api/p.js`](../api/p.js) e [`api/tiktok-media.js`](../api/tiktok-media.js)) agora utilizam **AWS S3 como provedor padrão** (`VITE_STORAGE_PROVIDER=aws`).
- No backend ([`supabase/functions/s3-storage/index.ts`](../supabase/functions/s3-storage/index.ts)), quando `AWS_S3_BUCKET` está configurado no ambiente da Lambda, o gateway utiliza diretamente a IAM Execution Role da Lambda e opera em modo **100% nativo no S3** (`nativeOnly: true`), sem consultar nem depender do Supabase Storage legado.

---

## 4. Variáveis de Ambiente do Frontend (`.env` / Vercel / CloudFront)

Configure as variáveis abaixo no ambiente de build/produção (conforme [`.env.example`](../.env.example)):

```dotenv
VITE_AWS_API_URL=https://<api-id>.execute-api.us-east-2.amazonaws.com
VITE_AWS_REGION=us-east-2
VITE_AWS_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX
VITE_AWS_COGNITO_CLIENT_ID=<cognito-app-client-id>
VITE_STORAGE_PROVIDER=aws
```

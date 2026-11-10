# S3 files with the Supabase backend

Status: credential transfer explicitly authorized by the user and completed in Supabase Vault. Gateway deployed and historical file copy in progress. Frontend production activation follows verification.

## Design

The existing Supabase Postgres database, Auth, Edge Functions, social OAuth credentials and job queues stay in place. S3 stores file bodies in `avanca-files-108327566923-us-east-2` (selected Region `us-east-2`). Existing object paths and `storage://` references stay unchanged. S3 keys are `<previous-bucket>/<previous-path>`.

The browser invokes `s3-storage` with its Supabase session. The gateway calls `auth.getUser()` and enforces the user's UUID prefix before signing. Uploads travel directly from the browser to S3 using short-lived POST policies with exact size and MIME restrictions. AWS credentials never reach the browser. Backend publishers use the existing Supabase service identity to read/sign/delete through the same gateway.

Private areas remain private: `instagram-publisher`, `x-media`. The public gateway permits anonymous reads only for `media` and `tiktok-media`, matching the existing bucket visibility. The underlying S3 bucket stays private for all four areas. The gateway preserves the existing authenticated delete policy: only `media` and `instagram-publisher` permit owner deletion; backend cleanup can delete the other two.

Reads fall back to the original Supabase object when the corresponding S3 key is absent. Lists merge both providers and retain the existing SDK result shape, including MIME and size metadata used by publishers. Errors do not silently redirect new uploads back to Supabase. The rollout flag defaults to Supabase.

## Applied infrastructure

- Private S3 bucket, Block Public Access on, ACLs disabled, SSE-S3 encryption.
- Versioning enabled; this protects overwritten/deleted objects and also consumes storage for old versions. No automatic retention/deletion policy was applied.
- Bucket policy denies HTTP transport; CORS accepts only the five known app origins.
- Dedicated machine identity `avanca-supabase-storage`, with List/Get/Put/Delete restricted to the four prefixes of this bucket. No user administration permissions.
- New `aws_storage_config()` RPC is executable only by `service_role`; its guarded SECURITY DEFINER body reads one named Vault entry. The user-authorized, bucket-scoped secret is stored encrypted in Vault.
- New `s3-storage` Edge Function is configured for S3 access. No existing publisher function or frontend deployment was replaced.

The standalone gateway performs its own authentication, so platform `verify_jwt` is disabled. This is necessary for the existing public media links and does not authorize private reads or uploads. Anonymous private reads return 404 and anonymous uploads return 401.

## Required authorization and credentials

Explicit permission was obtained before storing the AWS machine identity's access key and secret key in the encrypted Vault of Supabase project `csaplfphtvufxjhbpstl`. The keys are restricted to this bucket. They are long-lived service credentials and require rotation. The Vault RPC is never executable by browser roles. Do not commit keys, put them in `VITE_*` variables, include them in logs, or ask the user to paste them into chat.

After authorization, store the configuration server-side with `bucket`, `region`, `accessKeyId`, `secretAccessKey`. Migration additionally uses a separate random `migrationToken` and `migrationExpires` timestamp, expiring within two hours. The migration token only signs reads from Supabase; it cannot authorize mutations, read private database rows, or obtain AWS credentials. Remove its fields immediately after the copy, then redeploy/restart or allow the gateway's 60-second cache to expire.

## Ordered rollout

1. Verify and refresh the original project/source inventory. Latest observed inventory: 287 objects, 1,903,999,680 bytes. Do not put object names or user metadata in public reports.
2. Authorize and configure the Vault secret; test a harmless object with a real authenticated session, including upload, signed read, listing, owner isolation, duplicate handling and cleanup. No real posts should be published as a test.
3. Compare every currently deployed publisher file with the repository before replacing it. Preserve newer live source. Backups of the live versions must be retained. Deploy the final gateway and backend storage adapters before enabling frontend uploads. Keep the backend wrappers undeployed until the gateway is verified.
4. Copy existing files with `scripts/copy-storage-to-s3.py`, a private configuration file and a refreshed metadata manifest. Default invocation is a dry run; `--execute` opts in. The script never deletes source data, writes with `If-None-Match: *`, and verifies S3's SHA-256 checksum and size. Reconcile files that changed or were deleted during copying before making copied data authoritative.
5. Deploy a preview with `VITE_STORAGE_PROVIDER=aws`; exercise Instagram media previews, X uploads, TikTok media delivery on the verified app domain, slides and public links. Keep OAuth callback URLs unchanged. The domain change is an origin allowlist addition, preserving the old origins.
6. Only after successful verification, enable the production flag and deploy the reviewed commit. Verify the actual deployment; do not infer success from tests alone.
7. Retain the Supabase originals until separately authorized to remove them. Copied originals continue to count toward Supabase storage usage until removed; S3 does not expand the Postgres database quota.

## Rollback

Until any S3 upload is accepted, roll back the flag/deployment to keep the original Supabase behavior. After accepting S3-only uploads, DO NOT simply switch back: those files do not exist in Supabase. First mirror every new object back and verify it, or keep the gateway and backend adapters active while disabling new uploads. Do not disable the gateway, revoke its key or delete the bucket while S3-only files are referenced by slides, libraries or queues. Never edit publication job states as a migration shortcut.

## Cost and limitations

S3 charges for stored bytes, operations and transfer: https://aws.amazon.com/s3/pricing/. Versioning retains older bytes. Supabase Edge Function calls and fallback reads still use Supabase quotas. No numeric future monthly estimate is claimed without traffic data. The AWS project currently reports an active FREE plan; credits and expiration do not make usage unlimited. This implementation keeps current private-bucket media limits; the `media` upload limit is 100 MiB. Multi-part/resumable uploads and automated credential rotation are follow-up work.

Full build and regression checks are recorded in the delivery report. A production upload/download round trip remains unverified until credential authorization and a legitimate test session are available.

## Existing advisory findings

The security advisor reported existing service-only RLS tables without client policies, existing SECURITY DEFINER functions executable by client roles, and disabled leaked-password protection. The new configuration RPC is absent from those findings and explicit grant checks returned `false` for anon/authenticated and `true` for service_role. No unrelated policies or Auth settings were changed. References: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

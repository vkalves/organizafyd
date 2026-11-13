# Same-account automation integration

The intended identity is one Instagram account across Android 14, Chrome on Windows 10, and AVANÇA. The AVANÇA user/session is separate from that Instagram identity. Never infer the expected handle from whichever account Meta happens to authorize.

## Existing backend contracts

Requests use the configured Supabase project's Edge Function URL and the approved AVANÇA user's session. No service-role key belongs in the browser or desktop companion.

- `POST /functions/v1/instagram-login`: existing `config`/`apps`, connection `invite`, OAuth `start`, `finish` and account selection operations.
- `POST /functions/v1/instagram-publisher` with `action: "status"`: owned connection IDs and availability flags.
- Same function with `action: "verify", account_id`: live Meta-returned `{id,username}`.
- Same function with `action: "add_flow_accounts", id, account_ids`: attach connected internal account UUIDs to an existing active flow. This is the existing synchronization operation, not a campaign-creation or publication request.
- Authenticated owner-scoped Data API reads of `instagram_accounts` and `ig_flows` provide identity resolution and membership readback.

The connection API's `invite` is an AVANÇA authorization link. It does **not** send an Instagram tester invitation. Keep the manual tester invitation pause before accepting it in Instagram.

## Adapter usage

`src/features/instagram-publisher/automation-api.ts` exports an operational coordinator around these existing APIs:

```ts
import { automationApi } from "@/features/instagram-publisher/automation-api";

const account = await automationApi.preflight({
  expectedUsername: expectedHandleObservedOnAndroidAndChrome,
  // accountId: selectedInternalAccountUuid, // require an explicit choice if ambiguous
  // expectedGraphId: previouslyVerifiedMetaAccountId,
});

const result = await automationApi.syncToFlow({
  expectedUsername: account.username,
  expectedGraphId: account.graphId,
  accountId: account.accountId,
  flowId: existingActiveFlowUuid,
});
```

Do not copy the placeholder variable names as configured values. These inputs come from the verified account and explicit existing-flow selection.

`accountId` is the UUID of `instagram_accounts.id`; `graphId` is the numeric ID returned by Meta in the selected app/provider context; `flowId` is the UUID of the selected `ig_flows` row. They are not interchangeable. A Meta numeric ID should not be assumed identical across incompatible providers/app-scoped identity systems.

Preflight validates the active authenticated AVANÇA user, approved access, an owned available connection and live expected username/optional Graph ID. The active operation snapshots its input and checks that the session has not switched users before performing a write. An explicit account UUID may be supplied when cached username data is stale; live verification is still mandatory.

The adapter does not persist access tokens, refresh tokens, passwords, OAuth codes, TOTP seeds, recovery codes, or mailbox codes. Results contain durable account/flow identifiers and verification metadata only. Session management remains with the existing Supabase client.

## End-to-end sequence

1. Complete native Instagram setup and email verification on Android. Observe and record the canonical handle.
2. Enable 2FA, securely retain recovery material outside this app, and confirm native logout. These are device actions; the AVANÇA API does not perform them.
3. Use the same Instagram account in Chrome. Retrieve any Gmail verification code through the configured local email companion, then confirm Instagram accepted it. Retrieval is not proof of verification.
4. Pause before tester-invitation acceptance. Show the expected handle, send the invitation through the correct Meta application, and explicitly continue. Confirm the invitation accepted state in Instagram.
5. Sign in to the approved AVANÇA account as required to create its connection link. Complete the official OAuth flow in one browser/storage context, with the expected Instagram identity bound to the request. Never replay an unknown one-use code exchange blindly.
6. Select the existing active AVANÇA flow and call `preflight` then `syncToFlow` with the same expected identity.
7. Success is established only by owner-scoped membership readback and live identity verification. A successful redirect or increased account count alone is insufficient.

## Flow preservation and uncertain outcomes

The adapter calls only the existing account-association action. It never creates a campaign, replaces existing settings, rewrites jobs, or issues publication requests. The existing database RPC owns the skip-next-publication rule and scheduling behavior. Its deployed version must include the latest flow-entry/schedule-preservation migrations.

Before a write, membership is read. Already-associated accounts return success without issuing a duplicate synchronization request. After a write—even after an error, timeout or malformed write response—the adapter reads membership before deciding its outcome. It does not automatically resend a write.

If a response is lost after the server committed, matching membership plus live identity verification returns success with `recoveredAfterWriteError: true`. If readback fails or membership is absent, the adapter throws a typed `AutomationIntegrationError`; no success is inferred. A later explicit call starts with readback again, so it can observe an earlier commit before deciding whether another request is necessary. `added` and `queued` are null when counts cannot be known from a successful write response.

A flow stopping, a session changing, an unavailable Meta profile, a wrong username/Graph ID, or a membership read failure blocks confirmation. The adapter does not try to undo a server commit after a subsequent verification failure; the caller must inspect the observed external state. Client readbacks are observations, not a cross-platform transaction or a guarantee that future external account state cannot change.

## Configuration and verification limits

Backend CORS must permit the exact deployed browser origin. ASCII `avanca.online` and Unicode `avança.online` are different origins. Connection callback destinations and browser proof storage must agree. Production must have the intended Meta application credentials, account permissions, Supabase functions and migrations deployed.

Windows/Android control, native 2FA/logout execution, Chrome Instagram login and Gmail access remain separate local executor capabilities. This adapter must not advertise those actions as connected. For unattended Gmail OAuth, refresh handling and protected Windows credential storage are required beyond a transient access token.

`automation-api.test.ts` exercises the coordinator with injected API boundaries: ownership and approval, missing/unavailable connection, ambiguous records, username/Graph ID mismatch, inactive or wrong-owner flow, session switching, successful association, duplicate association, lost write responses, missing readback, false-positive counts and post-write identity change. These tests do not establish live Meta/Supabase deployment readiness.

## Connection identity and OAuth recovery changes

Connection creation accepts optional `expected_username` and `expected_graph_id`. They are normalized and stored server-side on the invitation, then copied transactionally into OAuth state. The callback cannot replace them. Both the Edge Function and the final save transaction reject a different account. Existing generic connection callers may omit these fields; the verified-flow integration screen always requires an explicit expected handle.

`recovery_status` accepts `{state,verifier}` or `{selection,verifier}` and returns `{status,result?}`. The states are `pending`, `processing`, `selection_required`, `completed`, and `restart_required`. A completed result contains only the username. A selection result contains a short-lived selection capability and authorized profile choices; it never contains a provider token. The proof is required for every lookup.

Saving the connection and marking completion now occur in the same SQL transaction. A lost successful HTTP response can be recovered from the durable completion record, and replay does not create a second save. An authorization code that might have been exchanged is never replayed automatically. Interrupted exchanges require fresh authorization if no committed completion can be established; this does not guarantee recovery of an already-consumed external Meta code.

Each connection link is independent: creating another link no longer invalidates outstanding links for the same AVANÇA user. Expired ledger records, including encrypted pending grants, are pruned in bounded batches when connection activity resumes. TTL enforcement prevents expired capabilities from being used before physical cleanup occurs.

## UI entry point

After deployment, open `/avanca/integracao`, also linked from the existing Connect Instagram page. Enter the same handle used on Android and Chrome, confirm the prerequisites, choose an existing active flow, verify identity, then synchronize. Changing the expected handle invalidates the prior UI verification. The adapter verifies identity and session again immediately around the write and the final membership readback.

## Rollout and rollback

1. Drain in-flight OAuth/selection attempts (normally a ten-minute validity window), or tell those users to generate fresh connection links. Old account-selection capabilities use a different encrypted representation and cannot be resumed by the new handler.
2. Apply `supabase/migrations/20261113210901_instagram_oauth_recovery.sql` to the intended staging project first. It is additive; existing account, flow and publication rows are not rewritten. Validate the migration and privilege boundaries before production rollout.
3. Deploy the updated `instagram-login`, `instagram-publisher`, `instagram-accounts`, `instagram-monitor` and `app-admin` functions, including their shared origin helper.
4. Keep the existing callback destination by leaving `AVANCA_SITE_ORIGIN` unset, or set it to the intended HTTPS origin that actually serves `/instagram/conectar`. This is server configuration, not a request parameter. The default is `https://www.organizafy.site`.
5. `AVANCA_EXTRA_ORIGINS` optionally accepts a comma-separated list of exact HTTPS origins for these functions. The defaults include Organizafy, both ASCII and internationalized AVANÇA domains, and the existing Zyon site. No wildcard, path, query, credential or non-default port is accepted.
6. Deploy the frontend after the migration/functions, then validate a real authorized account in staging. Check expected-account mismatch, lost response recovery, tester-invitation pause, same-browser callback storage, existing-flow membership and the skip-next schedule before production execution.
7. For rollback, restore the previous frontend/functions. Leave the additive migration in place while reviewing retained operations; do not drop tables or erase existing platform accounts to undo a UI release.

The GitHub change does not apply migrations, set production secrets, merge to main or perform real Instagram/AVANÇA account operations. Windows Android execution, automatic 2FA/logout and live Gmail setup remain separate unverified capabilities.

## Validation recorded for this change

- 83 focused tests passed across OAuth identity/recovery, transactional SQL, browser proof retention, verified flow integration, account/admin handlers, CORS and the integration page. The SQL tests execute the migration in isolated PostgreSQL/PGlite with fixtures for existing platform functions.
- Production Vite build passed. Deno type-check passed for all five changed Edge Function entrypoints. Targeted ESLint and `git diff --check` passed.
- A Chromium browser test intercepted every external request. It exercised mobile and desktop rendering, live-identity API contract fixtures, a lost synchronization response, membership readback and duplicate-write prevention. No production requests or real account operations were made.
- Full suite initially reported 544 passed / 4 failed. Two failures were load-related five-second timeouts and passed in an isolated rerun. The two remaining MetaAppConfig failures were reproduced unchanged on base commit `82cefa0`; its tests expect optional Config ID while the existing form requires it.
- The project-wide TypeScript check has the same pre-existing errors on the base commit: MediaPreview ref type, flows-api deep type instantiation, and useSupabaseCrud table-union errors. No new reported TypeScript errors originate in the added files.
- Supabase security advisors could not connect to the absent local stack on port 54322. Privilege/RLS tests passed in PGlite; live advisors and staging Meta/database/device validation remain rollout checks.

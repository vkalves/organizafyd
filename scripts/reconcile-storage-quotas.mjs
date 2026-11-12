/** Run during quota rollout, with uploads paused, to count files already in S3.
 * Credentials belong in the process environment, never in arguments or source.
 */
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the process environment.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let total = 0;
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw new Error('Unable to list users; reconciliation stopped.');
  for (let offset = 0; offset < data.users.length; offset += 4) {
    await Promise.all(data.users.slice(offset, offset + 4).map(async user => {
      const result = await db.functions.invoke('s3-storage', { body: { action: 'quota', bucket: 'media', path: `${user.id}/quota` } });
      if (result.error || result.data?.error) throw new Error('Unable to reconcile storage; do not resume uploads.');
      total++;
    }));
  }
  if (data.users.length < 100) break;
}
console.log(`Storage inventory reconciled for ${total} users. No files were deleted.`);

// The monitor repository is shared with Deno. Its pinned npm specifier refers
// to the same SDK used by the frontend regression tests.
declare module "npm:@supabase/supabase-js@2.98.0" {
  export type { SupabaseClient } from "@supabase/supabase-js";
}

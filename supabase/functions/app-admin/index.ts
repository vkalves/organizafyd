import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { createAdminHandler } from "./handler.ts";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(createAdminHandler(db));

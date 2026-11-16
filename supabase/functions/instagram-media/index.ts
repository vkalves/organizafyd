import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { hybridStorage } from "../_shared/hybrid-storage.ts";
import { mediaHandler } from "./handler.ts";

const base = Deno.env.get("SUPABASE_URL")!;
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(base, secret, { auth: { persistSession: false } });
const storage = hybridStorage(db, base);
Deno.serve(mediaHandler(secret, async path => {
  const { data, error } = await storage.from("instagram-publisher").createSignedUrl(path, 600);
  if (error || typeof data?.signedUrl !== "string") throw new Error("storage_error");
  return data.signedUrl;
}));

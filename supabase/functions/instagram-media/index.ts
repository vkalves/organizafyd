import { createBackendClient } from "../_shared/aws-backend.ts";
import { hybridStorage } from "../_shared/hybrid-storage.ts";
import { mediaHandler } from "./handler.ts";

const base = (Deno.env.get("AWS_API_URL") || Deno.env.get("SUPABASE_URL"))!;
const secret = (Deno.env.get("AWS_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const db = createBackendClient();
const storage = hybridStorage(db, base);
Deno.serve(mediaHandler(secret, async path => {
  const { data, error } = await storage.from("instagram-publisher").createSignedUrl(path, 600);
  if (error || typeof data?.signedUrl !== "string") throw new Error("storage_error");
  return data.signedUrl;
}));

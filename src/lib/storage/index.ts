import { supabase } from "@/integrations/supabase/client";
import { hybridStorage } from "../../../supabase/functions/_shared/hybrid-storage";
// Keep the existing provider until the gateway and backend readers are deployed.
export const storage = hybridStorage(
  supabase,
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_STORAGE_PROVIDER === "aws",
);

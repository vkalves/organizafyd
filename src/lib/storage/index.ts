import { supabase } from "@/integrations/supabase/client";
import { hybridStorage } from "../../../supabase/functions/_shared/hybrid-storage";
import { storageErrorMessage } from "./errors";
// AWS S3 is the default storage provider; set VITE_STORAGE_PROVIDER=supabase only for legacy fallback.
const apiUrl = import.meta.env.VITE_AWS_API_URL || import.meta.env.VITE_SUPABASE_URL || "";
const provider = hybridStorage(
  supabase,
  apiUrl,
  import.meta.env.VITE_STORAGE_PROVIDER !== "supabase",
);

// Normalize the server-enforced quota error for both storage providers.
export const storage = {
  from(bucket: string) {
    const client = provider.from(bucket);
    return new Proxy(client, {
      get(target, property) {
        if (property === "upload") return async (...args: Parameters<typeof client.upload>) => {
          const result = await client.upload(...args);
          return result.error ? { ...result, error: { ...result.error, message: storageErrorMessage(result.error.message || "Falha ao enviar o arquivo.") } } : result;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  },
};

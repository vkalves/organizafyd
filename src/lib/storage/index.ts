import { supabase } from "@/integrations/supabase/client";
import { hybridStorage } from "../../../supabase/functions/_shared/hybrid-storage";
import { storageErrorMessage } from "./errors";
// Keep the existing provider until the gateway and backend readers are deployed.
const provider = hybridStorage(
  supabase,
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_STORAGE_PROVIDER === "aws",
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

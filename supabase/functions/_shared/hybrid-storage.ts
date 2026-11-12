/** A narrow compatibility layer: database/auth stay on Supabase, files use S3.
 * The gateway falls back to existing Supabase files, preserving stored paths.
 */
type Result<T> = { data: T | null; error: any };
type Client = {
  storage: any;
  functions: { invoke: (name: string, options: any) => Promise<Result<any>> };
};
export function hybridStorage(client: Client, baseUrl: string, enabled = true) {
  if (!enabled) return client.storage;
  const request = async (
    bucket: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Result<any>> => {
    try {
      const result = await client.functions.invoke("s3-storage", {
        body: { action, bucket, ...payload },
      });
      if (result.error) {
        const details = await result.error.context?.json?.().catch(() => null);
        return {
          data: null,
          error: {
            message: details?.error === "storage_quota_exceeded"
              ? "Limite de armazenamento atingido. Exclua mídias ou solicite mais espaço ao administrador."
              : details?.error === "upload_pending"
              ? "Este arquivo tem um envio em andamento. Aguarde alguns minutos e tente novamente."
              : details?.error ||
              "Não foi possível acessar o armazenamento.",
            statusCode: details?.statusCode || result.error.context?.status,
          },
        };
      }
      return result;
    } catch {
      return {
        data: null,
        error: { message: "Não foi possível acessar o armazenamento." },
      };
    }
  };
  return {
    from(bucket: string) {
      return {
        async upload(
          path: string,
          body: Blob,
          options: {
            contentType?: string;
            upsert?: boolean;
            cacheControl?: string;
          } = {},
        ) {
          const result = await request(bucket, "upload", {
            path,
            size: body.size,
            contentType: options.contentType || body.type ||
              "application/octet-stream",
            upsert: options.upsert || false,
          });
          if (result.error) return result;
          const form = new FormData();
          for (const [key, value] of Object.entries(result.data.fields)) {
            form.append(key, String(value));
          }
          form.append("file", body);
          try {
            const response = await fetch(result.data.url, {
              method: "POST",
              body: form,
            });
            if (!response.ok) {
              return {
                data: null,
                error: {
                  message: "Falha ao enviar o arquivo.",
                  statusCode: String(response.status),
                },
              };
            }
            return {
              data: { path, fullPath: `${bucket}/${path}`, id: path },
              error: null,
            };
          } catch {
            return {
              data: null,
              error: {
                message: "Falha ao enviar o arquivo. Verifique sua conexão.",
              },
            };
          }
        },
        createSignedUrl(path: string, expiresIn: number) {
          return request(bucket, "signed", { path, expiresIn });
        },
        getPublicUrl(path: string) {
          const query = new URLSearchParams({ bucket, path });
          return {
            data: {
              publicUrl: `${
                baseUrl.replace(/\/$/, "")
              }/functions/v1/s3-storage?${query}`,
            },
          };
        },
        list(path: string, options: Record<string, unknown> = {}) {
          return request(bucket, "list", { ...options, path });
        },
        remove(paths: string[]) {
          return request(bucket, "remove", { paths });
        },
        async download(path: string) {
          const result = await request(bucket, "signed", {
            path,
            expiresIn: 600,
          });
          if (result.error) return result;
          try {
            const response = await fetch(result.data.signedUrl);
            if (!response.ok) throw new Error("download_failed");
            return { data: await response.blob(), error: null };
          } catch {
            return {
              data: null,
              error: { message: "Não foi possível baixar o arquivo." },
            };
          }
        },
      };
    },
  };
}

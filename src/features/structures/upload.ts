interface UploadOptions {
  path: string;
  file: File;
  accessToken: string;
  upsert?: boolean;
  onProgress?: (progress: number) => void;
}

export function uploadStructureFile({ path, file, accessToken, upsert = false, onProgress }: UploadOptions) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const endpoint = `${supabaseUrl}/storage/v1/object/structure-files/${encodedPath}`;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", publishableKey);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", upsert ? "true" : "false");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onerror = () => reject(new Error("A conexão foi interrompida durante o envio."));
    xhr.onabort = () => reject(new Error("Envio cancelado."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        reject(new Error(body.message || body.error || `Falha no upload (${xhr.status}).`));
      } catch {
        reject(new Error(`Falha no upload (${xhr.status}).`));
      }
    };

    xhr.send(file);
  });
}

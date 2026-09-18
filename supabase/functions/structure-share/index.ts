import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);

  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim() ?? "";
    const action = url.searchParams.get("action") ?? "browse";

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return json({ error: "Link inválido ou incompleto." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Serviço indisponível." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: share, error: shareError } = await admin
      .from("structure_folder_shares")
      .select("id, root_folder_id, owner_id, allow_download, active")
      .eq("token", token)
      .eq("active", true)
      .maybeSingle();

    if (shareError) throw shareError;
    if (!share) return json({ error: "Este link foi desativado, substituído ou não existe." }, 404);

    if (action === "file") {
      const itemId = url.searchParams.get("item");
      const wantsDownload = url.searchParams.get("download") === "1";
      if (!itemId) return json({ error: "Arquivo não informado." }, 400);
      if (wantsDownload && !share.allow_download) {
        return json({ error: "O proprietário desativou os downloads desta pasta." }, 403);
      }

      const { data: item, error: itemError } = await admin
        .from("structure_items")
        .select("id, folder_id, kind, storage_path, original_name")
        .eq("id", itemId)
        .eq("kind", "file")
        .maybeSingle();

      if (itemError) throw itemError;
      if (!item?.storage_path) return json({ error: "Arquivo não encontrado." }, 404);

      const { data: allowed, error: allowedError } = await admin.rpc("structure_folder_is_within", {
        candidate: item.folder_id,
        root: share.root_folder_id,
      });
      if (allowedError) throw allowedError;
      if (!allowed) return json({ error: "Este arquivo não pertence à pasta compartilhada." }, 403);

      const options = wantsDownload && item.original_name ? { download: item.original_name } : undefined;
      const { data: signed, error: signedError } = await admin.storage
        .from("structure-files")
        .createSignedUrl(item.storage_path, 300, options);

      if (signedError || !signed?.signedUrl) throw signedError ?? new Error("Não foi possível abrir o arquivo.");
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: signed.signedUrl, "Cache-Control": "no-store" },
      });
    }

    const requestedFolderId = url.searchParams.get("folder") || share.root_folder_id;
    const { data: allowed, error: allowedError } = await admin.rpc("structure_folder_is_within", {
      candidate: requestedFolderId,
      root: share.root_folder_id,
    });
    if (allowedError) throw allowedError;
    if (!allowed) return json({ error: "Esta pasta não faz parte do conteúdo compartilhado." }, 403);

    const { data: rootFolder, error: rootError } = await admin
      .from("structure_folders")
      .select("id, structure_id, name, icon, color")
      .eq("id", share.root_folder_id)
      .single();
    if (rootError) throw rootError;

    const [{ data: structure, error: structureError }, { data: folders, error: foldersError }, { data: items, error: itemsError }] =
      await Promise.all([
        admin.from("structures").select("id, name, icon, color, updated_at").eq("id", rootFolder.structure_id).single(),
        admin
          .from("structure_folders")
          .select("id, parent_id, name, icon, color, created_at, updated_at")
          .eq("structure_id", rootFolder.structure_id)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        admin
          .from("structure_items")
          .select("id, folder_id, kind, title, body, url, original_name, mime_type, size_bytes, upload_group, created_at, updated_at")
          .eq("folder_id", requestedFolderId)
          .order("created_at", { ascending: true }),
      ]);

    if (structureError) throw structureError;
    if (foldersError) throw foldersError;
    if (itemsError) throw itemsError;

    const folderMap = new Map((folders ?? []).map((folder) => [folder.id, folder]));
    const currentFolder = folderMap.get(requestedFolderId);
    if (!currentFolder) return json({ error: "Pasta não encontrada." }, 404);

    const breadcrumbs = [];
    let cursor: typeof currentFolder | undefined = currentFolder;
    let guard = 0;
    while (cursor && guard < 100) {
      breadcrumbs.unshift({ id: cursor.id, name: cursor.name });
      if (cursor.id === share.root_folder_id) break;
      cursor = cursor.parent_id ? folderMap.get(cursor.parent_id) : undefined;
      guard += 1;
    }

    if (breadcrumbs[0]?.id !== share.root_folder_id) {
      return json({ error: "Caminho da pasta inválido." }, 403);
    }

    const childFolders = (folders ?? []).filter((folder) => folder.parent_id === requestedFolderId);

    return json({
      structure,
      root_folder: rootFolder,
      current_folder: currentFolder,
      breadcrumbs,
      folders: childFolders,
      items: items ?? [],
      allow_download: share.allow_download,
      updated_at: structure.updated_at,
    });
  } catch (error) {
    console.error("structure-share", error);
    return json({ error: "Não foi possível carregar esta pasta agora." }, 500);
  }
});

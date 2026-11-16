import { publisherRequest } from "./api";

// The authenticated server validates sharing, copies inside Storage, checks
// quota and registers the recipient's independent copy. No media bytes pass
// through the browser. Keep userId in the signature for existing callers;
// ownership is always derived from the server-validated session.
export async function importSharedMedia(ownerId: string, mediaId: string, _userId: string) {
  await publisherRequest("library_import", { owner_id: ownerId, media_id: mediaId });
}

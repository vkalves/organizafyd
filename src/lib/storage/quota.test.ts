// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { syncStorageInventory, reserveStorage } from "../../../supabase/functions/s3-storage/quota";
import { storageErrorMessage } from "./errors";
const user="11111111-1111-4111-8111-111111111111";
describe("S3 quota inventory and reservations",()=>{
 it("reads all pages across all four buckets before committing an inventory",async()=>{
  const db={rpc:vi.fn().mockResolvedValue({error:null})};
  const list=vi.fn(async(prefix:string,token?:string)=>prefix.startsWith("media/")? token?{Contents:[{Key:`media/${user}/b`,Size:20}]}:{Contents:[{Key:`media/${user}/a`,Size:10}],IsTruncated:true,NextContinuationToken:"next"}:{Contents:[]});
  await syncStorageInventory(db,user,list);
  expect(list).toHaveBeenCalledTimes(5);
  expect(db.rpc).toHaveBeenCalledWith("avanca_storage_sync",expect.objectContaining({p_user:user,p_objects:[{bucket:"media",path:`${user}/a`,size_bytes:10},{bucket:"media",path:`${user}/b`,size_bytes:20}]}));
 });
 it("never reconciles partial inventory on a listing failure or malformed page",async()=>{
  const db={rpc:vi.fn()};
  await expect(syncStorageInventory(db,user,vi.fn().mockRejectedValue(new Error("AWS unavailable")))).rejects.toThrow();
  await expect(syncStorageInventory(db,user,vi.fn().mockResolvedValue({IsTruncated:true}))).rejects.toThrow("incomplete_inventory");
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it("fails closed on quota or database errors and rejects expired reservations before signing",async()=>{
  const db={rpc:vi.fn().mockResolvedValue({error:{message:"storage_quota_exceeded"}})};
  expect(await reserveStorage(db,user,"media",`${user}/a`,10)).toBe("storage_quota_exceeded");
  db.rpc.mockResolvedValue({error:{message:"private detail"}});
  await expect(reserveStorage(db,user,"media",`${user}/a`,10)).rejects.toThrow("storage_reservation_failed");
  db.rpc.mockResolvedValue({error:null,data:new Date(Date.now()-1).toISOString()});
  await expect(reserveStorage(db,user,"media",`${user}/a`,10)).rejects.toThrow("storage_reservation_expired");
 });
 it("shows an actionable quota message for the legacy API error",()=>{
  expect(storageErrorMessage("new row: storage_quota_exceeded")).toContain("solicite mais espaço ao administrador");
  expect(storageErrorMessage("The resource already exists")).toBe("The resource already exists");
 });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "../../../supabase/functions/app-admin/handler";
const actor="00000000-0000-4000-8000-000000000001", target="00000000-0000-4000-8000-000000000002";
function setup(admin=false) {
  const db={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},rpc:vi.fn(async (name:string) => ({data:name==="avanca_user_access"?{is_admin:admin,connected_accounts:2,max_accounts:3,connection_allowed:true}:{ok:true},error:null}))};
  return {db,handler:createAdminHandler(db)};
}
function request(body:unknown,token="Bearer valid-token") {return new Request("https://example.test",{method:"POST",headers:{authorization:token,"content-type":"application/json"},body:JSON.stringify(body)});}
describe("administration API authentication and authorization",()=>{
  it("rejects absent or invalid authentication before reading permissions",async()=>{
    const {db,handler}=setup();expect((await handler(request({action:"users"},""))).status).toBe(401);
    db.auth.getUser.mockResolvedValue({data:{user:null},error:new Error("expired")});
    expect((await handler(request({action:"users"}))).status).toBe(401);expect(db.rpc).not.toHaveBeenCalled();
  });
  it("allows an ordinary user to see only their own access, ignoring a supplied actor",async()=>{
    const {db,handler}=setup();const response=await handler(request({action:"access",user_id:target,p_actor:target}));
    expect(response.status).toBe(200);expect(db.rpc).toHaveBeenCalledExactlyOnceWith("avanca_user_access",{p_user:actor});
  });
  it("rejects directory reads and edits by non-admins even with spoofed admin fields",async()=>{
    const {db,handler}=setup();
    for(const action of ["users","update_access"]) expect((await handler(request({action,is_admin:true,p_actor:target,user_id:target,connection_allowed:true,max_accounts:999}))).status).toBe(403);
    expect(db.rpc.mock.calls.every(([name])=>name==="avanca_user_access")).toBe(true);
  });
  it("uses the verified administrator as the audit actor when saving a target",async()=>{
    const {db,handler}=setup(true);
    const response=await handler(request({action:"update_access",p_actor:target,user_id:target,connection_allowed:false,max_accounts:2}));
    expect(response.status).toBe(200);expect(db.rpc).toHaveBeenLastCalledWith("avanca_admin_update_access",{p_actor:actor,p_target:target,p_allowed:false,p_max:2});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects invalid limits before modifying the database",async()=>{
    const {db,handler}=setup(true);
    for(const max_accounts of [-1,1.5,"3",10001]) expect((await handler(request({action:"update_access",user_id:target,connection_allowed:true,max_accounts}))).status).toBe(400);
    expect(db.rpc.mock.calls.every(([name])=>name==="avanca_user_access")).toBe(true);
  });
  it("handles malformed bodies and server failures without leaking internals",async()=>{
    const {db,handler}=setup(true);
    expect((await handler(request(null))).status).toBe(400);
    db.rpc.mockRejectedValue(new Error("private database detail"));const response=await handler(request({action:"users"}));
    expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"request_failed"});
  });
});

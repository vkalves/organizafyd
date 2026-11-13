// TypeScript / automation-api.test.ts / Vitest / account and flow integration boundaries
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/administration/api", () => ({ adminRequest: vi.fn() }));
vi.mock("./api", () => ({ publisherRequest: vi.fn() }));
import { createAutomationAdapter, type AutomationDependencies, type AutomationFlow } from "./automation-api";
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";
const FLOW = "55555555-5555-4555-8555-555555555555";
const GRAPH = "178400000000001";
const request = { expectedUsername: "@same.account", flowId: FLOW };
function fixture() {
  let associated = false;
  const flow = (): AutomationFlow => ({ id: FLOW, user_id: USER, name: "Existing campaign", state: "active", settings: { accountIds: associated ? [SECOND, ACCOUNT] : [SECOND] } });
  const dependencies = {
    authenticatedUser: vi.fn(async () => ({ id: USER })),
    access: vi.fn(async () => ({ account_status: "approved" })),
    connections: vi.fn(async () => [{ account_id: ACCOUNT, paused: false, reconnect_required: false }]),
    accounts: vi.fn(async () => [{ id: ACCOUNT, user_id: USER, username: "same.account" }]),
    verify: vi.fn(async () => ({ id: GRAPH, username: "Same.Account" })),
    flow: vi.fn(async () => flow()),
    addFlowAccount: vi.fn(async () => { associated = true; return { added: 1, queued: 4 }; }),
  } satisfies AutomationDependencies;
  return { dependencies, api: createAutomationAdapter(dependencies), associate: () => { associated = true; }, flow };
}

describe("same-account AVANÇA integration adapter", () => {
  it("preflights authenticated owned connection and verifies the live canonical identity", async () => {
    const { api, dependencies } = fixture();
    const result = await api.preflight({ expectedUsername: " @Same.Account " });
    expect(result).toEqual({ userId: USER, accountId: ACCOUNT, graphId: GRAPH, username: "same.account" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(dependencies.accounts).toHaveBeenCalledWith(USER, [ACCOUNT]);
    expect(dependencies.verify).toHaveBeenCalledWith(ACCOUNT);
    expect(dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("rejects invalid handles, graph IDs and flow UUIDs before a network operation", async () => {
    const { api, dependencies } = fixture();
    await expect(api.preflight({ expectedUsername: "bad handle" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(api.preflight({ expectedUsername: "same.account", expectedGraphId: "internal-id" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(api.syncToFlow({ ...request, flowId: "@campaign" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(dependencies.authenticatedUser).not.toHaveBeenCalled();
  });
  it("rejects absent or unapproved AVANÇA sessions before synchronization", async () => {
    const a = fixture();a.dependencies.authenticatedUser.mockResolvedValue(null);
    await expect(a.api.syncToFlow(request)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const b = fixture();b.dependencies.access.mockResolvedValue({ account_status: "pending" });
    await expect(b.api.syncToFlow(request)).rejects.toMatchObject({ code: "ACCOUNT_NOT_APPROVED" });
    expect(b.dependencies.connections).not.toHaveBeenCalled();
    expect(a.dependencies.addFlowAccount).not.toHaveBeenCalled();expect(b.dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("rejects another user's account even if a malformed boundary returns it", async () => {
    const { api, dependencies } = fixture();
    dependencies.accounts.mockResolvedValue([{ id: ACCOUNT, user_id: OTHER, username: "same.account" }]);
    await expect(api.syncToFlow(request)).rejects.toMatchObject({ code: "ACCOUNT_NOT_CONNECTED" });
    expect(dependencies.verify).not.toHaveBeenCalled();expect(dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it.each(["paused", "reconnect_required"])("rejects a connection marked %s", async key => {
    const { api, dependencies } = fixture();
    dependencies.connections.mockResolvedValue([{ account_id: ACCOUNT, paused: key === "paused", reconnect_required: key === "reconnect_required" }]);
    await expect(api.preflight(request)).rejects.toMatchObject({ code: "ACCOUNT_NOT_CONNECTED" });
  });
  it("requires explicit choice when multiple owned records match a handle", async () => {
    const { api, dependencies } = fixture();
    dependencies.connections.mockResolvedValue([{ account_id: ACCOUNT, paused: false, reconnect_required: false }, { account_id: SECOND, paused: false, reconnect_required: false }]);
    dependencies.accounts.mockResolvedValue([{ id: ACCOUNT, user_id: USER, username: "same.account" }, { id: SECOND, user_id: USER, username: "same.account" }]);
    await expect(api.preflight(request)).rejects.toMatchObject({ code: "AMBIGUOUS_ACCOUNT" });
    expect(dependencies.verify).not.toHaveBeenCalled();
  });
  it("allows an explicit owned record with a stale cached handle only after live identity matches", async () => {
    const { api, dependencies } = fixture();
    dependencies.accounts.mockResolvedValue([{ id: ACCOUNT, user_id: USER, username: "old.handle" }]);
    expect((await api.preflight({ ...request, accountId: ACCOUNT })).username).toBe("same.account");
  });
  it.each([{ id: GRAPH, username: "wrong.account" }, { id: "178400000000002", username: "same.account" }])("does not sync a mismatched live identity: %o", async profile => {
    const { api, dependencies } = fixture();dependencies.verify.mockResolvedValue(profile);
    await expect(api.syncToFlow({ ...request, expectedGraphId: GRAPH })).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("adds only the expected internal account UUID and verifies membership and identity afterward", async () => {
    const { api, dependencies } = fixture();const result = await api.syncToFlow(request);
    expect(result).toMatchObject({ accountId: ACCOUNT, graphId: GRAPH, username: "same.account", flowId: FLOW, flowName: "Existing campaign", added: 1, queued: 4, alreadyAssociated: false, recoveredAfterWriteError: false });
    expect(dependencies.addFlowAccount).toHaveBeenCalledExactlyOnceWith(FLOW, ACCOUNT);
    expect(dependencies.flow).toHaveBeenCalledTimes(2);expect(dependencies.verify).toHaveBeenCalledTimes(3);
  });
  it("does not write when the account is already associated", async () => {
    const f = fixture();f.associate();const result=await f.api.syncToFlow(request);
    expect(result).toMatchObject({ alreadyAssociated: true, added: null, queued: null });expect(f.dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("rejects flows outside the user and inactive flows without mutating", async () => {
    const a=fixture();a.dependencies.flow.mockResolvedValue({ ...a.flow(), user_id: OTHER });
    await expect(a.api.syncToFlow(request)).rejects.toMatchObject({ code: "FLOW_NOT_FOUND" });
    const b=fixture();b.dependencies.flow.mockResolvedValue({ ...b.flow(), state: "paused" });
    await expect(b.api.syncToFlow(request)).rejects.toMatchObject({ code: "FLOW_NOT_ACTIVE" });
    expect(a.dependencies.addFlowAccount).not.toHaveBeenCalled();expect(b.dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("recovers an ambiguous write timeout by observing committed membership instead of sending again", async () => {
    const f=fixture();f.dependencies.addFlowAccount.mockImplementation(async () => { f.associate();throw new Error("network timeout"); });
    const result=await f.api.syncToFlow(request);
    expect(result).toMatchObject({ recoveredAfterWriteError: true, added: null, queued: null });expect(f.dependencies.addFlowAccount).toHaveBeenCalledTimes(1);
    const replay=await f.api.syncToFlow(request);expect(replay.alreadyAssociated).toBe(true);expect(f.dependencies.addFlowAccount).toHaveBeenCalledTimes(1);
  });
  it("reports unconfirmed failure rather than retrying a write that did not commit", async () => {
    const f=fixture();f.dependencies.addFlowAccount.mockRejectedValue(new Error("secret-access-token network error"));
    await expect(f.api.syncToFlow(request)).rejects.toMatchObject({ code: "FLOW_WRITE_UNCONFIRMED" });expect(f.dependencies.addFlowAccount).toHaveBeenCalledTimes(1);
    try { await f.api.syncToFlow(request); } catch(error) { expect((error as Error).message).not.toContain("secret-access-token"); }
  });
  it("does not infer success from positive write counts without membership readback", async () => {
    const f=fixture();f.dependencies.addFlowAccount.mockResolvedValue({ added: 1, queued: 100 });
    await expect(f.api.syncToFlow(request)).rejects.toMatchObject({ code: "FLOW_WRITE_UNCONFIRMED" });
  });
  it("reports readback failure after a possible commit without repeating the write", async () => {
    const f=fixture();f.dependencies.flow.mockResolvedValueOnce(f.flow()).mockRejectedValueOnce(new Error("offline"));
    await expect(f.api.syncToFlow(request)).rejects.toMatchObject({ code: "FLOW_READBACK_UNAVAILABLE" });expect(f.dependencies.addFlowAccount).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed platform session before sending a write", async () => {
    const f=fixture();f.dependencies.authenticatedUser.mockResolvedValueOnce({ id: USER }).mockResolvedValue({ id: OTHER });
    await expect(f.api.syncToFlow(request)).rejects.toMatchObject({ code: "SESSION_CHANGED" });expect(f.dependencies.addFlowAccount).not.toHaveBeenCalled();
  });
  it("rechecks live identity after synchronization and rejects a changed graph account", async () => {
    const f=fixture();f.dependencies.verify.mockResolvedValueOnce({ id: GRAPH, username: "same.account" }).mockResolvedValueOnce({ id: GRAPH, username: "same.account" }).mockResolvedValueOnce({ id: "178400000000002", username: "same.account" });
    await expect(f.api.syncToFlow(request)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });expect(f.dependencies.addFlowAccount).toHaveBeenCalledTimes(1);
  });
  it("snapshots user-entered expectation before asynchronous preflight", async () => {
    const f=fixture();let release: (value: {id:string})=>void;
    f.dependencies.authenticatedUser.mockImplementationOnce(() => new Promise(resolve=>{release=resolve;}));
    const input={ expectedUsername: "same.account" };const pending=f.api.preflight(input);input.expectedUsername="wrong.account";release!({id:USER});
    expect((await pending).username).toBe("same.account");
  });
});

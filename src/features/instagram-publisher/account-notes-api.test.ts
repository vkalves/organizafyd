import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
vi.mock("@/features/x/clean-media", () => ({ cleanMedia: vi.fn() }));
import { saveAccountNotes } from "./api";
beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    update: mocks.update,
    eq: mocks.eq,
    select: mocks.select,
    single: mocks.single,
  };
  mocks.from.mockReturnValue(query);
  mocks.update.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.single.mockResolvedValue({
    data: { notes: "@reserva\nPróxima conta" },
    error: null,
  });
});
describe("Private account notes API", () => {
  it("updates only notes and scopes the write to both user and account", async () => {
    await expect(
      saveAccountNotes("owner", "account", "@reserva\nPróxima conta"),
    ).resolves.toBe("@reserva\nPróxima conta");
    expect(mocks.from).toHaveBeenCalledWith("instagram_accounts");
    expect(mocks.update).toHaveBeenCalledWith({
      notes: "@reserva\nPróxima conta",
    });
    expect(mocks.eq.mock.calls).toEqual([
      ["id", "account"],
      ["user_id", "owner"],
    ]);
    expect(mocks.select).toHaveBeenCalledWith("notes");
  });
  it("does not report a successful save for a denied or missing account", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "denied" },
    });
    await expect(
      saveAccountNotes("owner", "other-account", "test"),
    ).rejects.toThrow("Não foi possível salvar");
  });
  it("rejects an unauthenticated or oversized write before making a request", async () => {
    await expect(saveAccountNotes("", "account", "test")).rejects.toThrow();
    await expect(
      saveAccountNotes("owner", "account", "x".repeat(20001)),
    ).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

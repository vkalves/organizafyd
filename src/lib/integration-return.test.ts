import { expect, it } from "vitest";
import { integrationReturnPath } from "./integration-return";
it("preserves only the integration destination and canonical handle", () => {
  expect(integrationReturnPath("/avanca/integracao?expected_username=%40Same.Account&token=discard"))
    .toBe("/avanca/integracao?expected_username=same.account");
});
it("rejects external, malformed and unrelated destinations", () => {
  for (const path of [undefined, {}, "https://evil.test/avanca/integracao", "//evil.test/avanca/integracao", "/\\evil.test/avanca/integracao", "/avanca/config", "/avanca/integracao#token", "javascript:alert(1)"]) {
    expect(integrationReturnPath(path)).toBe("/avanca");
  }
});
it("discards malformed handles without treating them as identity", () => {
  expect(integrationReturnPath("/avanca/integracao?expected_username=bad%26account")).toBe("/avanca/integracao");
});

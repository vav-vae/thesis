import test from "node:test";
import assert from "node:assert/strict";
import { canAccessRole, roleHome, type AccountRole } from "../src/lib/role-access.ts";

test("each account can only open its own protected role area", () => {
  const roles: AccountRole[] = ["buyer", "broker", "admin"];
  for (const role of roles) for (const required of roles) {
    assert.equal(canAccessRole(required, { role }), role === required);
    assert.equal(canAccessRole(required, { role, accountStatus: "inactive" }), false);
  }
  assert.equal(canAccessRole("broker", {}), false);
  assert.equal(canAccessRole("admin", { role: "administrator" }), false);
});

test("wrong-role redirects lead to the stored role home; unknown accounts fail closed", () => {
  assert.equal(roleHome("buyer"), "/buyer");
  assert.equal(roleHome("broker"), "/broker");
  assert.equal(roleHome("admin"), "/admin");
  assert.equal(roleHome(undefined), "/login?reason=account-unavailable");
  assert.equal(roleHome("//example.com"), "/login?reason=account-unavailable");
});

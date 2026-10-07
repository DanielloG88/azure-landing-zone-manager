import test from "node:test";
import assert from "node:assert/strict";
import { subscriptionUpdateSchema, toCsvPatch } from "../src/validation.js";

const defaults = {
  location: "westeurope",
  department: "Platform Engineering",
  team: "Cloud Operations",
  owner: "",
  costCenter: "CC-001",
  billingScope: "/providers/Microsoft.Billing/example"
};

function parsePatch(body) {
  const request = subscriptionUpdateSchema.parse(body);
  return toCsvPatch(request, defaults);
}

test("partial update changes only the explicitly supplied field", () => {
  const patch = parsePatch({
    projectName: "sample-workload",
    environment: "sandbox",
    owner: "changed.owner@example.com"
  });

  assert.deepEqual(patch, {
    owner: "changed.owner@example.com"
  });
});

test("explicit empty and false values are retained as update operations", () => {
  const patch = parsePatch({
    projectName: "sample-workload",
    environment: "sandbox",
    owner: "",
    subOwnerGroupEnabled: false
  });

  assert.deepEqual(patch, {
    owner: "",
    sub_owner_group_enabled: "false",
    sub_owner_group_name: "",
    sub_owner_members: ""
  });
});

test("group name and members can change without disabling the group", () => {
  const patch = parsePatch({
    projectName: "sample-workload",
    environment: "sandbox",
    subOwnerGroupName: "Azure-SUB-sample-workload-sandbox-Custom",
    subOwnerMembers: "FIRST.USER@example.com, second.user@example.com"
  });

  assert.deepEqual(patch, {
    sub_owner_group_name: "Azure-SUB-sample-workload-sandbox-Custom",
    sub_owner_members: "first.user@example.com;second.user@example.com"
  });
  assert.equal(Object.hasOwn(patch, "sub_owner_group_enabled"), false);
});

test("identity-only update produces an empty patch", () => {
  const patch = parsePatch({
    projectName: "sample-workload",
    environment: "sandbox",
    dryRun: true
  });

  assert.deepEqual(patch, {});
});

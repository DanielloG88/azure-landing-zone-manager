import test from "node:test";
import assert from "node:assert/strict";
import { subscriptionRequestSchema, subscriptionUpdateSchema, toCsvRow, toCsvPatch } from "../src/validation.js";
import { assertConfiguredHub, assertNetworkInventory } from "../src/networking.js";

const identity = { projectName: "sample", environment: "dev", managementGroupId: "LandingZones" };
const spoke = {
  networkMode: "spoke",
  networkHubKey: "platform",
  networkAddressSpace: "10.20.0.0/16",
  networkWorkloadSubnetPrefix: "10.20.1.0/24",
  networkPrivateEndpointSubnetPrefix: "10.20.2.0/24"
};

test("legacy requests default to no managed network", () => {
  const row = toCsvRow(subscriptionRequestSchema.parse(identity), {});
  assert.equal(row.network_mode, "none");
  assert.equal(row.network_hub_key, "");
});

test("spoke choice persists in the subscription CSV with a configured hub", () => {
  const request = subscriptionRequestSchema.parse({ ...identity, ...spoke });
  assertConfiguredHub(request, ["platform"]);
  const row = toCsvRow(request, {});
  assert.equal(row.network_address_space, spoke.networkAddressSpace);
  assert.equal(row.network_mode, "spoke");
  assert.throws(() => assertConfiguredHub(request, []), /not configured/);
});

test("existing subscriptions can enable a spoke through an update", () => {
  const request = subscriptionUpdateSchema.parse({ ...identity, ...spoke });
  assert.deepEqual(toCsvPatch(request), {
    management_group_id: "LandingZones",
    network_mode: "spoke",
    network_hub_key: "platform",
    network_address_space: "10.20.0.0/16",
    network_workload_subnet_prefix: "10.20.1.0/24",
    network_private_endpoint_subnet_prefix: "10.20.2.0/24"
  });
});

test("disabling a managed network clears its configuration while unrelated updates preserve it", () => {
  const disabled = toCsvPatch(subscriptionUpdateSchema.parse({ projectName: "sample", environment: "dev", networkMode: "none" }));
  assert.deepEqual(disabled, {
    network_mode: "none", network_hub_key: "", network_address_space: "",
    network_workload_subnet_prefix: "", network_private_endpoint_subnet_prefix: ""
  });
  assert.deepEqual(toCsvPatch(subscriptionUpdateSchema.parse({ projectName: "sample", environment: "dev", owner: "owner@example.com" })), { owner: "owner@example.com" });
});

test("reject incomplete, overlapping, undersized, outside and noncanonical subnet requests", () => {
  for (const change of [
    { networkHubKey: "" },
    { networkWorkloadSubnetPrefix: undefined },
    { networkPrivateEndpointSubnetPrefix: "10.20.1.128/25" },
    { networkWorkloadSubnetPrefix: "10.20.1.0/30" },
    { networkPrivateEndpointSubnetPrefix: "10.21.2.0/24" },
    { networkAddressSpace: "10.20.0.1/16" },
    { networkAddressSpace: "fd00::/48" },
    { networkMode: undefined }
  ]) assert.equal(subscriptionRequestSchema.safeParse({ ...identity, ...spoke, ...change }).success, false);
});

test("batch requests reject ranges reused across projects or environments", () => {
  const first = toCsvRow({ ...identity, ...spoke }, {});
  const second = toCsvRow({ ...identity, environment: "prod", ...spoke }, {});
  assert.throws(() => assertNetworkInventory([first, second]), /overlap/);
  second.network_address_space = "10.21.0.0/16";
  assert.doesNotThrow(() => assertNetworkInventory([first, second]));
  second.network_address_space = "10.20.128.0/17";
  assert.throws(() => assertNetworkInventory([first, second]), /overlap/);
});

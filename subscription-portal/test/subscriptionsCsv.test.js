import test from "node:test";
import assert from "node:assert/strict";
import {
  addSubscriptionToCsv,
  addSubscriptionsToCsv,
  markSubscriptionsDestroyedInCsv,
  parseSubscriptionsCsv,
  updateSubscriptionInCsv
} from "../src/subscriptionsCsv.js";

const csvText = [
  "project_name,environment,management_group_id,location,destroy,destroyed_at,owner,subscription_id,sub_owner_group_enabled,sub_owner_group_name,sub_owner_members",
  "alpha,dev,IT,westeurope,false,,alpha.owner@example.com,11111111-1111-1111-1111-111111111111,true,Azure-SUB-alpha-dev-Owner,alpha.owner@example.com",
  "beta,prod,LandingZones,northeurope,false,,beta.owner@example.com,22222222-2222-2222-2222-222222222222,false,,",
  ""
].join("\n");

test("parser normalizes missing trailing optional fields", () => {
  const parsed = parseSubscriptionsCsv("project_name,environment,owner\nexample,dev\n");

  assert.deepEqual(parsed.rows, [{ project_name: "example", environment: "dev", owner: "" }]);
});

test("parser still rejects rows with extra fields", () => {
  assert.throws(
    () => parseSubscriptionsCsv("project_name,environment\nexample,dev,unexpected\n"),
    /Failed to parse subscriptions\.csv/
  );
});

test("create and batch append atomically without changing existing rows", () => {
  const createdCsv = addSubscriptionToCsv({
    csvText,
    newRow: {
      project_name: "gamma",
      environment: "test",
      management_group_id: "IT",
      location: "westeurope",
      destroy: "false"
    }
  });
  const beforeRows = parseSubscriptionsCsv(csvText).rows;
  const createdRows = parseSubscriptionsCsv(createdCsv).rows;

  assert.equal(createdRows.length, 3);
  assert.deepEqual(createdRows.slice(0, 2), beforeRows);

  const batchCsv = addSubscriptionsToCsv({
    csvText: createdCsv,
    newRows: [
      { project_name: "delta", environment: "dev", management_group_id: "IT", location: "westeurope" },
      { project_name: "epsilon", environment: "prod", management_group_id: "IT", location: "westeurope" }
    ]
  });
  assert.equal(parseSubscriptionsCsv(batchCsv).rows.length, 5);

  assert.throws(
    () =>
      addSubscriptionsToCsv({
        csvText,
        newRows: [
          { project_name: "duplicate", environment: "dev" },
          { project_name: "duplicate", environment: "dev" }
        ]
      }),
    /Duplicate project_name and environment/
  );
});

test("partial CSV update preserves every field not present in the patch", () => {
  const original = parseSubscriptionsCsv(csvText).rows[0];
  const { updatedCsv, updatedRow } = updateSubscriptionInCsv({
    csvText,
    target: { projectName: "alpha", environment: "dev" },
    patch: { owner: "new.owner@example.com" }
  });

  assert.equal(updatedRow.owner, "new.owner@example.com");
  for (const [key, value] of Object.entries(original)) {
    if (key === "owner") continue;
    assert.equal(updatedRow[key], value, `expected ${key} to be preserved`);
  }
  assert.deepEqual(parseSubscriptionsCsv(updatedCsv).rows[1], parseSubscriptionsCsv(csvText).rows[1]);
});

test("destruction marks only requested rows and preserves an existing timestamp", () => {
  const first = markSubscriptionsDestroyedInCsv({
    csvText,
    targets: [{ projectName: "alpha", environment: "dev" }],
    destroyedAt: "2026-07-23"
  });
  assert.equal(first.markedRows[0].destroy, "true");
  assert.equal(first.markedRows[0].destroyed_at, "2026-07-23");
  assert.equal(first.markedRows[0].subscription_id, "11111111-1111-1111-1111-111111111111");

  const second = markSubscriptionsDestroyedInCsv({
    csvText: first.updatedCsv,
    targets: [{ projectName: "alpha", environment: "dev" }],
    destroyedAt: "2026-08-01"
  });
  assert.equal(second.markedRows[0].destroyed_at, "2026-07-23");
  assert.throws(
    () =>
      markSubscriptionsDestroyedInCsv({
        csvText,
        targets: [
          { projectName: "alpha", environment: "dev" },
          { projectName: "missing", environment: "dev" }
        ]
      }),
    /Subscriptions not found/
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function startPortal(t, settings = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "alz-http-"));
  const csvPath = path.join(directory, "subscriptions.csv");
  await fs.copyFile(new URL("../../infrastructure/subscriptions.example.csv", import.meta.url), csvPath);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(PORTAL_|AZDO_|HOST$|PORT$)/.test(key)) delete environment[key];
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url))], {
    env: {
      ...environment,
      PORT: "0",
      HOST: "127.0.0.1",
      SUBSCRIPTIONS_CSV_PATH: csvPath,
      PORTAL_WRITE_LOCAL: "false",
      PORTAL_AZDO_ENABLED: "false",
      ...settings
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  let errors = "";
  child.stderr.on("data", (data) => { errors += data; });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Portal startup timed out: ${errors}`)), 15000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Portal exited ${code}: ${errors}`)); });
    child.stdout.on("data", (data) => {
      const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  return { address, csvPath };
}

test("local preview generates CSV without modifying its inventory", async (t) => {
  const { address, csvPath } = await startPortal(t);
  const original = await fs.readFile(csvPath, "utf8");
  const config = await (await fetch(`${address}/api/config`)).json();
  assert.equal(config.mode, "local");
  assert.equal(config.auth.easyAuth, false);
  assert.deepEqual(config.options.managementGroups, ["LandingZones", "Platform", "Sandbox"]);
  assert.equal(config.defaults.billingScope, "");
  const response = await fetch(`${address}/api/subscription-requests/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ projectName: "new-workload", environment: "dev", managementGroupId: "LandingZones" }], dryRun: true })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.match(JSON.stringify(result), /new-workload/);
  assert.equal(await fs.readFile(csvPath, "utf8"), original);
  assert.equal((await fetch(`${address}/api/subscriptions`)).status, 403);
});

test("configured Azure DevOps writes reject an unauthenticated requester", async (t) => {
  const { address } = await startPortal(t, {
    PORTAL_AZDO_ENABLED: "true",
    AZDO_ORG_URL: "https://dev.azure.com/example-organization/",
    AZDO_PROJECT: "example-project",
    AZDO_REPO_ID: "example-repository"
  });
  const response = await fetch(`${address}/api/subscription-requests/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ projectName: "new-workload", environment: "dev", managementGroupId: "LandingZones" }] })
  });
  assert.equal(response.status, 403);
});

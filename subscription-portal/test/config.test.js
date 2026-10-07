import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

test("local env file configures authentication before config is exported", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alz-config-"));
  try {
    fs.mkdirSync(path.join(directory, "src"));
    fs.copyFileSync(new URL("../src/config.js", import.meta.url), path.join(directory, "src/config.js"));
    fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(directory, ".env"), [
      "PORTAL_AUTH_BEARER_ENABLED=true",
      "PORTAL_AUTH_AAD_CLIENT_ID=sample-client",
      "PORTAL_AUTH_AAD_TENANT_ID=sample-tenant",
      "PORTAL_AUTH_AAD_SCOPES=api://sample-client/access",
      "PORTAL_DEFAULT_DEPARTMENT=Example Department",
      "PORTAL_DEFAULT_BILLING_SCOPE=/example-billing-scope"
    ].join("\n"));
    const moduleUrl = pathToFileURL(path.join(directory, "src/config.js")).href;
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (/^(PORTAL_|AZDO_|HOST$|PORT$)/.test(key)) delete environment[key];
    }
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const { portalConfig } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(portalConfig));`
    ], { encoding: "utf8", env: environment });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const config = JSON.parse(child.stdout);
    assert.equal(config.auth.bearer.enabled, true);
    assert.equal(config.auth.bearer.clientId, "sample-client");
    assert.equal(config.auth.bearer.tenantId, "sample-tenant");
    assert.deepEqual(config.auth.bearer.scopes, ["api://sample-client/access"]);
    assert.equal(config.defaults.department, "Example Department");
    assert.equal(config.defaults.billingScope, "/example-billing-scope");
    assert.equal(config.host, "127.0.0.1");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

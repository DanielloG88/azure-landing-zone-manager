import assert from "node:assert/strict";
import test from "node:test";

import { renderReviewTableFromPreview } from "../public/app.js";
import { getDisplayProjectName } from "../public/projectName.js";

test("falls back to project_name when display_project_name is empty", () => {
  assert.equal(
    getDisplayProjectName({
      display_project_name: "",
      project_name: "sample-project"
    }),
    "sample-project"
  );
});

test("uses a non-empty display_project_name when available", () => {
  assert.equal(
    getDisplayProjectName({
      display_project_name: "Sample Subscription",
      project_name: "sample-project"
    }),
    "Sample Subscription"
  );
});

test("review table renders project_name when display_project_name is empty", () => {
  const tbody = {
    innerHTML: "previous content",
    rows: [],
    appendChild(row) {
      this.rows.push(row);
    }
  };
  const previousDocument = globalThis.document;

  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, "#reviewTable tbody");
      return tbody;
    },
    createElement(tagName) {
      if (tagName === "tr") {
        return {
          cells: [],
          appendChild(cell) {
            this.cells.push(cell);
          }
        };
      }
      assert.equal(tagName, "td");
      return { textContent: "" };
    }
  };

  try {
    renderReviewTableFromPreview({
      headers: [
        "project_name",
        "display_project_name",
        "environment",
        "management_group_id",
        "location",
        "owner",
        "cost-center"
      ],
      previewRows: [["sample-project", "", "dev", "IT", "westeurope", "owner@example.com", "CC-001"]]
    });

    assert.equal(tbody.innerHTML, "");
    assert.equal(tbody.rows.length, 1);
    assert.equal(tbody.rows[0].cells[0].textContent, "sample-project");
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  }
});

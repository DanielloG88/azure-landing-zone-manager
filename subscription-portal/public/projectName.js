export function getDisplayProjectName(row) {
  const displayName = String(row?.display_project_name ?? "").trim();
  return displayName || String(row?.project_name ?? "").trim();
}

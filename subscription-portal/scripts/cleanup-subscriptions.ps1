$ErrorActionPreference = "Stop"

function Detect-Newline {
  param([string]$Text)

  if ($Text -and $Text.Contains("`r`n")) { return "`r`n" }
  return "`n"
}

function Split-CsvRecords {
  param([string]$Text)

  $records = New-Object System.Collections.Generic.List[string]
  if ([string]::IsNullOrEmpty($Text)) {
    return $records
  }

  $builder = New-Object System.Text.StringBuilder
  $inQuotes = $false

  for ($i = 0; $i -lt $Text.Length; $i++) {
    $ch = $Text[$i]

    if ($ch -eq '"') {
      if ($inQuotes -and $i + 1 -lt $Text.Length -and $Text[$i + 1] -eq '"') {
        [void]$builder.Append($ch)
        $i++
        [void]$builder.Append($Text[$i])
        continue
      }
      $inQuotes = -not $inQuotes
      [void]$builder.Append($ch)
      continue
    }

    if (-not $inQuotes -and ($ch -eq "`n" -or $ch -eq "`r")) {
      $record = $builder.ToString()
      $builder.Clear() | Out-Null
      if ($record.Length -gt 0) {
        $records.Add($record)
      }
      if ($ch -eq "`r" -and $i + 1 -lt $Text.Length -and $Text[$i + 1] -eq "`n") {
        $i++
      }
      continue
    }

    [void]$builder.Append($ch)
  }

  $last = $builder.ToString()
  if ($last.Length -gt 0) {
    $records.Add($last)
  }

  return $records
}

function Parse-DestroyedAt {
  param([object]$Value)

  $trimmed = ([string]$Value).Trim()
  if (-not $trimmed) { return $null }

  foreach ($format in @("yyyy-MM-dd", "dd.MM.yyyy")) {
    $dateValue = [DateTime]::MinValue
    if ([DateTime]::TryParseExact($trimmed, $format, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$dateValue)) {
      return [DateTime]::SpecifyKind($dateValue, [DateTimeKind]::Utc)
    }
  }

  $dateOffset = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse($trimmed, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$dateOffset)) {
    return $dateOffset.UtcDateTime
  }

  return $null
}

function Parse-CsvText {
  param([string]$CsvText)

  if ([string]::IsNullOrWhiteSpace($CsvText)) {
    throw "Failed to parse subscriptions.csv: missing header row."
  }

  $parts = $CsvText -split "\r?\n", 2
  $headerLine = $parts[0]
  if ([string]::IsNullOrWhiteSpace($headerLine)) {
    throw "Failed to parse subscriptions.csv: missing header row."
  }

  $headers = $headerLine -split ","
  $rows = @()
  if ($parts.Count -gt 1 -and -not [string]::IsNullOrWhiteSpace($parts[1])) {
    $rows = $CsvText | ConvertFrom-Csv -Delimiter ","
  }

  return @{ Headers = $headers; Rows = $rows }
}

function Format-CsvValue {
  param(
    [object]$Value,
    [bool]$ForceQuote
  )

  $text = if ($null -eq $Value) { "" } else { [string]$Value }
  $needsQuote = $ForceQuote -or $text.Contains(",") -or $text.Contains("`r") -or $text.Contains("`n") -or $text.Contains('"')
  if ($needsQuote) {
    $escaped = $text.Replace('"', '""')
    return '"' + $escaped + '"'
  }

  return $text
}

function Convert-RowsToCsv {
  param(
    [string[]]$Headers,
    [array]$Rows,
    [string]$Newline,
    [System.Collections.Generic.HashSet[string]]$AlwaysQuotedColumns
  )

  $builder = New-Object System.Text.StringBuilder
  $headerLine = ($Headers | ForEach-Object { Format-CsvValue -Value $_ -ForceQuote:$false }) -join ","
  [void]$builder.Append($headerLine)
  [void]$builder.Append($Newline)

  foreach ($row in $Rows) {
    $fields = foreach ($header in $Headers) {
      $value = if ($row.ContainsKey($header)) { $row[$header] } else { "" }
      $forceQuote = $AlwaysQuotedColumns.Contains($header)
      Format-CsvValue -Value $value -ForceQuote:$forceQuote
    }
    [void]$builder.Append(($fields -join ","))
    [void]$builder.Append($Newline)
  }

  return $builder.ToString()
}

function Get-RepoRoot {
  param([string]$PortalRoot)

  try {
    $root = git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $root) {
      return $root.Trim()
    }
  } catch {
    # Fall back to parent of portal root.
  }

  return (Split-Path -Parent $PortalRoot)
}

function Resolve-RepoFilePath {
  param(
    [string]$RepoRoot,
    [string]$RepoPath
  )

  $value = if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    "infrastructure/subscriptions.csv"
  } else {
    $RepoPath.Trim()
  }
  $normalized = $value.Replace("\", "/").TrimStart("/")
  $segments = @($normalized -split "/" | Where-Object { $_ -ne "" })
  if ($segments.Count -eq 0 -or ($segments | Where-Object { $_ -in @(".", "..") -or $_.Contains(":") })) {
    throw "Invalid AZDO_SUBSCRIPTIONS_PATH '$RepoPath'. Use a repository-relative path."
  }

  $relativePath = [string]::Join([System.IO.Path]::DirectorySeparatorChar, $segments)
  $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RepoRoot, $relativePath))
  $root = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  $comparison = if ([OperatingSystem]::IsWindows()) {
    [System.StringComparison]::OrdinalIgnoreCase
  } else {
    [System.StringComparison]::Ordinal
  }
  if (-not $candidate.StartsWith($root, $comparison)) {
    throw "CSV path must stay inside the repository."
  }
  return $candidate
}

function Normalize-BranchName {
  param([string]$BranchName)

  if ([string]::IsNullOrWhiteSpace($BranchName)) { return "main" }
  if ($BranchName.StartsWith("refs/heads/")) {
    return $BranchName.Substring("refs/heads/".Length)
  }
  return $BranchName
}

function Get-AzdoValue {
  param(
    [string]$Primary,
    [string]$Fallback,
    [string]$Name
  )

  if (-not [string]::IsNullOrWhiteSpace($Primary)) { return $Primary }
  if (-not [string]::IsNullOrWhiteSpace($Fallback)) { return $Fallback }
  throw "Missing Azure DevOps value: $Name"
}

function Parse-BoolValue {
  param([string]$Value)

  $normalized = ([string]$Value).Trim().ToLowerInvariant()
  if (@("1", "true", "yes", "y", "on") -contains $normalized) { return $true }
  if (@("0", "false", "no", "n", "off") -contains $normalized) { return $false }
  throw "Invalid boolean value: $Value"
}

function Parse-Args {
  param([string[]]$RawArgs)

  $result = @{ Force = $false }

  foreach ($arg in $RawArgs) {
    if (-not $arg.StartsWith("-")) {
      throw "Unknown argument: $arg"
    }

    $trimmed = $arg.TrimStart("-")
    $name = $trimmed
    $value = $null
    if ($trimmed -like "*=*") {
      $parts = $trimmed -split "=", 2
      $name = $parts[0]
      $value = $parts[1]
    }

    $normalized = $name.ToLowerInvariant().Replace("-", "")
    switch ($normalized) {
      "force" {
        if ([string]::IsNullOrWhiteSpace($value)) {
          $result.Force = $true
        } else {
          $result.Force = Parse-BoolValue -Value $value
        }
      }
      default {
        throw "Unknown argument: $arg"
      }
    }
  }

  return $result
}

$parsedArgs = Parse-Args $args
$force = $parsedArgs.Force
$retentionDays = 60
$referenceTime = [DateTime]::UtcNow.Date

$portalRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Get-RepoRoot -PortalRoot $portalRoot

$csvPath = Resolve-RepoFilePath -RepoRoot $repoRoot -RepoPath $env:AZDO_SUBSCRIPTIONS_PATH
if (-not (Test-Path -LiteralPath $csvPath)) {
  throw "CSV path not found: $csvPath"
}

$targetBranchInput = $env:AZDO_TARGET_BRANCH
if ([string]::IsNullOrWhiteSpace($targetBranchInput)) {
  $targetBranchInput = if ($env:BUILD_SOURCEBRANCHNAME) { $env:BUILD_SOURCEBRANCHNAME } else { $env:BUILD_SOURCEBRANCH }
}
$targetBranch = Normalize-BranchName -BranchName $targetBranchInput

$branchPrefix = "cleanup/destroyed"
$commitMessage = "Cleanup destroyed subscriptions"
$prTitle = "Cleanup destroyed subscriptions"
$prDescription = if ($force) {
  "Forced cleanup of destroyed subscriptions (ignore retention)."
} else {
  "Cleanup destroyed subscriptions older than $retentionDays days."
}

$csvText = [System.IO.File]::ReadAllText($csvPath)
$newline = Detect-Newline -Text $csvText
$hasBom = $csvText.Length -gt 0 -and $csvText[0] -eq [char]0xFEFF
$normalizedCsvText = if ($hasBom) {
  $csvText.TrimStart([char]0xFEFF)
} else {
  $csvText
}

$records = Split-CsvRecords -Text $normalizedCsvText
if ($records.Count -eq 0) {
  throw "Failed to parse subscriptions.csv: missing header row."
}

$headerLine = $records[0]
if ([string]::IsNullOrWhiteSpace($headerLine)) {
  throw "Failed to parse subscriptions.csv: missing header row."
}

$headers = $headerLine -split ","
$rowRecords = if ($records.Count -gt 1) { $records[1..($records.Count - 1)] } else { @() }
$endsWithNewline = $normalizedCsvText.EndsWith("`n")

Write-Output "CSV path: $csvPath"
Write-Output "Force cleanup: $($force.ToString().ToLowerInvariant())"

if (-not ($headers -ccontains "destroy")) {
  Write-Output "No destroy column found. Nothing to clean."
  Write-Output "Removed rows: 0"
  Write-Output "Changed: false"
  return
}

$missingDestroyedAtColumn = -not ($headers -ccontains "destroyed_at")
if ($missingDestroyedAtColumn) {
  $hasDestroyedRows = $false
  foreach ($record in $rowRecords) {
    if ([string]::IsNullOrWhiteSpace($record)) { continue }
    $rawRow = $record | ConvertFrom-Csv -Delimiter "," -Header $headers
    $destroyValue = ([string]$rawRow.PSObject.Properties["destroy"]?.Value).Trim().ToLowerInvariant()
    if ($destroyValue -eq "true") {
      $hasDestroyedRows = $true
      break
    }
  }

  if ($hasDestroyedRows) {
    throw "destroyed_at column missing but destroy=true rows exist. Merge the destruction PR first."
  }

  Write-Output "No destroyed subscriptions to clean (destroyed_at column missing)."
  Write-Output "Removed rows: 0"
  Write-Output "Changed: false"
  return
}

$alwaysQuotedColumns = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
[void]$alwaysQuotedColumns.Add("department")
[void]$alwaysQuotedColumns.Add("team")
[void]$alwaysQuotedColumns.Add("owner")
[void]$alwaysQuotedColumns.Add("cost-center")
[void]$alwaysQuotedColumns.Add("billing_scope")

$removedRows = @()
$rowsMissingDestroyedAt = New-Object System.Collections.Generic.List[string]
$rowIndex = 0
$keptRecords = New-Object System.Collections.Generic.List[string]
$keptRecords.Add($headerLine)

foreach ($record in $rowRecords) {
  $rowIndex++
  if ([string]::IsNullOrWhiteSpace($record)) {
    $keptRecords.Add($record)
    continue
  }

  $rawRow = $record | ConvertFrom-Csv -Delimiter "," -Header $headers
  $row = @{}
  foreach ($header in $headers) {
    $prop = $rawRow.PSObject.Properties[$header]
    if ($null -eq $prop -or $null -eq $prop.Value) {
      $row[$header] = ""
      continue
    }
    $row[$header] = $prop.Value
  }

  $destroyValue = ([string]$row["destroy"]).Trim().ToLowerInvariant()
  if ($destroyValue -ne "true") {
    $keptRecords.Add($record)
    continue
  }

  $destroyedAt = Parse-DestroyedAt -Value $row["destroyed_at"]
  if ($null -eq $destroyedAt) {
    $keptRecords.Add($record)
    $projectName = if ($row.ContainsKey("project_name") -and -not [string]::IsNullOrWhiteSpace($row["project_name"])) {
      [string]$row["project_name"]
    } else {
      "row $rowIndex"
    }
    $environment = if ($row.ContainsKey("environment") -and -not [string]::IsNullOrWhiteSpace($row["environment"])) {
      [string]$row["environment"]
    } else {
      ""
    }
    $label = if ($environment) { "$projectName ($environment)" } else { $projectName }
    $rowsMissingDestroyedAt.Add($label)
    continue
  }

  $ageDays = [Math]::Floor(($referenceTime - $destroyedAt).TotalDays)
  $shouldRemove = $force -or ($ageDays -ge $retentionDays)
  if ($shouldRemove) {
    $removedRows += $row
    continue
  }

  $keptRecords.Add($record)
}

$updatedCsv = ($keptRecords -join $newline)
if ($endsWithNewline) {
  $updatedCsv += $newline
}
$changed = $updatedCsv -ne $normalizedCsvText

if ($rowsMissingDestroyedAt.Count -gt 0) {
  $limit = 20
  $sample = $rowsMissingDestroyedAt | Select-Object -First $limit
  $suffix = if ($rowsMissingDestroyedAt.Count -gt $limit) { " (showing first $limit)" } else { "" }
  $list = $sample -join ", "
  throw ("destroy=true but destroyed_at missing for {0} row(s){1}: {2}" -f $rowsMissingDestroyedAt.Count, $suffix, $list)
}

Write-Output "Removed rows: $($removedRows.Count)"
Write-Output "Changed: $($changed.ToString().ToLowerInvariant())"

if (-not $changed) {
  Write-Output "No destroyed rows eligible for cleanup. Skipping PR."
  return
}

$utf8Encoding = New-Object System.Text.UTF8Encoding($hasBom)
[System.IO.File]::WriteAllText($csvPath, $updatedCsv, $utf8Encoding)

$relativeCsvPath = [System.IO.Path]::GetRelativePath($repoRoot, $csvPath)
if ($relativeCsvPath.StartsWith("..") -or [System.IO.Path]::IsPathRooted($relativeCsvPath)) {
  throw "CSV path must be inside the repo to create a PR."
}

Push-Location $repoRoot
try {
  if (-not (git config user.email)) {
    git config user.email "cleanup-bot@local"
  }
  if (-not (git config user.name)) {
    git config user.name "cleanup-bot"
  }

  $branchStamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
  $branchName = "$branchPrefix/$branchStamp"

  git checkout -b $branchName
  git add -- $relativeCsvPath
  git commit -m $commitMessage
  git push origin $branchName

  $orgUrl = Get-AzdoValue -Primary $env:AZDO_ORG_URL -Fallback $env:SYSTEM_COLLECTIONURI -Name "AZDO_ORG_URL/SYSTEM_COLLECTIONURI"
  $project = Get-AzdoValue -Primary $env:AZDO_PROJECT -Fallback $env:SYSTEM_TEAMPROJECT -Name "AZDO_PROJECT/SYSTEM_TEAMPROJECT"
  $repoId = Get-AzdoValue -Primary $env:AZDO_REPO_ID -Fallback $env:BUILD_REPOSITORY_ID -Name "AZDO_REPO_ID/BUILD_REPOSITORY_ID"
  $token = Get-AzdoValue -Primary $env:SYSTEM_ACCESSTOKEN -Fallback $null -Name "SYSTEM_ACCESSTOKEN"

  $orgUrl = $orgUrl.TrimEnd("/") + "/"

  $prBody = @{
    sourceRefName = "refs/heads/$branchName"
    targetRefName = "refs/heads/$targetBranch"
    title         = $prTitle
    description   = $prDescription
  } | ConvertTo-Json -Depth 5

  $basicToken = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$token"))
  $headers = @{ Authorization = "Basic $basicToken" }
  $prUrl = "${orgUrl}${project}/_apis/git/repositories/${repoId}/pullrequests?api-version=7.1-preview.1"

  $pr = Invoke-RestMethod -Method Post -Uri $prUrl -Headers $headers -ContentType "application/json" -Body $prBody
  $prLink = $pr?._links?.web?.href
  if (-not $prLink) { $prLink = $pr?.url }
  Write-Output "Pull request created: $prLink"
} finally {
  Pop-Location
}

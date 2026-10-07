param(
  [string]$SubscriptionId = "",
  [Parameter(Mandatory = $true)][string]$ResourceGroupName,
  [Parameter(Mandatory = $true)][string]$ContainerAppName,
  [Parameter(Mandatory = $true)][string]$IdentityName,
  [Parameter(Mandatory = $true)][string]$ImageRepository,
  [Parameter(Mandatory = $true)][string]$ImageTag,
  [string]$AzdoTargetBranch = "poc",
  [int]$RevisionReadyTimeoutSeconds = 600,
  [bool]$SkipHealthChecks = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
  az account set --subscription $SubscriptionId | Out-Null
}

function Invoke-AzJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $payload = az @Arguments -o json
  if ([string]::IsNullOrWhiteSpace($payload)) {
    throw "Azure CLI command returned empty JSON payload: az $($Arguments -join ' ')"
  }

  return $payload | ConvertFrom-Json
}

function Invoke-AzCli {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$Attempts = 1,
    [int]$DelaySeconds = 10,
    [string]$RetryPattern = ""
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $output = (& az @Arguments 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) {
      return $output
    }

    if (-not [string]::IsNullOrWhiteSpace($RetryPattern) -and $output -match $RetryPattern -and $attempt -lt $Attempts) {
      Start-Sleep -Seconds $DelaySeconds
      continue
    }

    throw "Azure CLI command failed: az $($Arguments -join ' '). Output: $output"
  }
}

function Wait-ForContainerAppRevision {
  param(
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [Parameter(Mandatory = $true)][string]$ContainerApp,
    [Parameter(Mandatory = $true)][datetime]$Deadline
  )

  while ((Get-Date) -lt $Deadline) {
    $app = Invoke-AzJson -Arguments @("containerapp", "show", "--resource-group", $ResourceGroup, "--name", $ContainerApp)
    $latestRevision = $app.properties.latestRevisionName
    $latestReadyRevision = $app.properties.latestReadyRevisionName
    $runningStatus = $app.properties.runningStatus

    if ($runningStatus -eq "Running" -and $latestRevision -eq $latestReadyRevision -and -not [string]::IsNullOrWhiteSpace($latestRevision)) {
      return $app
    }

    Start-Sleep -Seconds 10
  }

  throw "Timed out waiting for container app '$ContainerApp' in '$ResourceGroup' to reach a ready revision."
}

function Invoke-ContainerAppExec {
  param(
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [Parameter(Mandatory = $true)][string]$ContainerApp,
    [Parameter(Mandatory = $true)][string]$Command
  )

  return (az containerapp exec `
    --resource-group $ResourceGroup `
    --name $ContainerApp `
    --command $Command 2>&1 | Out-String)
}

function Wait-ForExecPattern {
  param(
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [Parameter(Mandatory = $true)][string]$ContainerApp,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Description,
    [int]$Attempts = 12,
    [int]$DelaySeconds = 10
  )

  $lastOutput = ""

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    $output = Invoke-ContainerAppExec -ResourceGroup $ResourceGroup -ContainerApp $ContainerApp -Command $Command
    $lastOutput = $output
    if ($output -match $Pattern) {
      return $output
    }

    if ($attempt -lt $Attempts) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  throw "$Description check failed after $Attempts attempts. Last output: $lastOutput"
}

$identity = Invoke-AzJson -Arguments @("identity", "show", "--resource-group", $ResourceGroupName, "--name", $IdentityName)
if (-not $identity.clientId) {
  throw "Managed identity '$IdentityName' in '$ResourceGroupName' does not expose a clientId."
}

$fullImage = "${ImageRepository}:$ImageTag"

Write-Host "Assigning managed identity '$IdentityName' to container app '$ContainerAppName'."
Invoke-AzCli -Arguments @(
  "containerapp",
  "identity",
  "assign",
  "--resource-group",
  $ResourceGroupName,
  "--name",
  $ContainerAppName,
  "--system-assigned",
  "--user-assigned",
  $identity.id
) | Out-Null

Write-Host "Updating container app image and Azure DevOps managed identity settings."
Invoke-AzCli -Arguments @(
  "containerapp",
  "update",
  "--resource-group",
  $ResourceGroupName,
  "--name",
  $ContainerAppName,
  "--image",
  $fullImage,
  "--set-env-vars",
  "AZDO_AUTH_MODE=managed_identity",
  "AZDO_MANAGED_IDENTITY_CLIENT_ID=$($identity.clientId)",
  "AZDO_TARGET_BRANCH=$AzdoTargetBranch"
) -Attempts 6 -DelaySeconds 15 -RetryPattern "ContainerAppOperationInProgress" | Out-Null

Write-Host "Removing legacy Azure DevOps PAT env var from container app."
Invoke-AzCli -Arguments @(
  "containerapp",
  "update",
  "--resource-group",
  $ResourceGroupName,
  "--name",
  $ContainerAppName,
  "--remove-env-vars",
  "AZDO_PAT"
) -Attempts 6 -DelaySeconds 15 -RetryPattern "ContainerAppOperationInProgress" | Out-Null

Write-Host "Removing legacy Azure DevOps PAT secret from container app."
Invoke-AzCli -Arguments @(
  "containerapp",
  "secret",
  "remove",
  "--resource-group",
  $ResourceGroupName,
  "--name",
  $ContainerAppName,
  "--secret-names",
  "azdo-pat"
) -Attempts 6 -DelaySeconds 15 -RetryPattern "ContainerAppOperationInProgress" | Out-Null

$deadline = (Get-Date).AddSeconds($RevisionReadyTimeoutSeconds)
$app = Wait-ForContainerAppRevision -ResourceGroup $ResourceGroupName -ContainerApp $ContainerAppName -Deadline $deadline

$configOutput = $null
$healthOutput = $null

if (-not $SkipHealthChecks) {
  Write-Host "Running in-container config check."
  $configOutput = Wait-ForExecPattern `
    -ResourceGroup $ResourceGroupName `
    -ContainerApp $ContainerAppName `
    -Command "wget -qO- http://127.0.0.1:3000/api/config" `
    -Pattern 'managed_identity' `
    -Description "Config"

  Write-Host "Running in-container Azure DevOps health check."
  $healthOutput = Wait-ForExecPattern `
    -ResourceGroup $ResourceGroupName `
    -ContainerApp $ContainerAppName `
    -Command "wget -qO- http://127.0.0.1:3000/api/azdo/health" `
    -Pattern '"ok"\s*:\s*true' `
    -Description "Azure DevOps health"
}

$summary = [ordered]@{
  resourceGroup           = $ResourceGroupName
  containerAppName        = $ContainerAppName
  latestRevisionName      = $app.properties.latestRevisionName
  latestReadyRevisionName = $app.properties.latestReadyRevisionName
  runningStatus           = $app.properties.runningStatus
  image                   = $fullImage
  azdoTargetBranch        = $AzdoTargetBranch
  managedIdentityName     = $identity.name
  managedIdentityClientId = $identity.clientId
  fqdn                    = $app.properties.configuration.ingress.fqdn
}

if ($configOutput) {
  $summary["configCheck"] = "passed"
}

if ($healthOutput) {
  $summary["azdoHealthCheck"] = "passed"
}

$summary | ConvertTo-Json -Depth 10

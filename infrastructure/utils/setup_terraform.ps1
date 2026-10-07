param(
    [ValidateSet("prod")]
    [string]$EnvironmentName = "prod",
    [string]$SecretVaultName = "landingzone",
    [switch]$Reset,
    [switch]$AzCli,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$TenantId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$SubscriptionId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ClientId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Check and install required modules if not available
if (!(Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretManagement) -or !(Get-Module -ListAvailable -Name Microsoft.PowerShell.SecretStore)) {
    Write-Information "Installing Secret Store modules."
    Install-Module Microsoft.PowerShell.SecretManagement, Microsoft.PowerShell.SecretStore -Scope CurrentUser
}

if ($Reset) {
    Write-Warning "Resetting will remove the vault along with all stored secrets."
    $Confirmation = Read-Host "Are you sure you want to proceed? (y/N)"
    if ($Confirmation.ToLower() -ne "y" -and $Confirmation.ToLower() -ne "yes") {
        return
    }
    Get-SecretInfo -Vault $SecretVaultName | ForEach-Object { Remove-Secret -Name $_.Name -Vault $SecretVaultName }
    Unregister-SecretVault -Name $SecretVaultName
}

$SecretVault = Get-SecretVault -Name $SecretVaultName -ErrorAction SilentlyContinue
if ($null -eq $SecretVault) {
    Write-Host "Registering Secret Vault: $SecretVaultName"
    Register-SecretVault -Name $SecretVaultName -ModuleName Microsoft.PowerShell.SecretStore -DefaultVault
}

function Get-EnvironmentSecret {
    param(
        [string]$SecretName,
        [switch]$AsPlainText,
        [string]$UserName
    )
    $Secret = Get-Secret -Name $SecretName -ErrorAction SilentlyContinue -Vault $SecretVaultName
    if ($null -eq $Secret) {
        if ([string]::IsNullOrEmpty($UserName)) {
            $UserName = $SecretName
        }
        $Credential = Get-Credential -UserName $UserName -Message "Enter token for $SecretName"
        Set-Secret -Name $SecretName -Vault $SecretVaultName -Secret $Credential.GetNetworkCredential().Password
        $Secret = Get-Secret -Name $SecretName -ErrorAction SilentlyContinue -Vault $SecretVaultName
    }
    if ($AsPlainText) {
        return (ConvertFrom-SecureString -SecureString $Secret -AsPlainText)
    }
    return $Secret
}

# Azure targets must be supplied explicitly.
$env:ARM_TENANT_ID = $TenantId
$env:ARM_SUBSCRIPTION_ID = $SubscriptionId
$env:ARM_CLIENT_ID = $ClientId
$env:ARM_CLIENT_SECRET = Get-EnvironmentSecret -SecretName "AzureClientSecret$EnvironmentName" -AsPlainText -UserName $ClientId

if ($AzCli) {
    az login --service-principal -u $env:ARM_CLIENT_ID -p $env:ARM_CLIENT_SECRET --tenant $env:ARM_TENANT_ID --output none
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI authentication failed." }
}

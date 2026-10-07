# Local Terraform authentication helper

`setup_terraform.ps1` loads a service-principal secret from PowerShell SecretManagement
and exports `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID`, `ARM_CLIENT_ID`, and `ARM_CLIENT_SECRET`.
Use it for local administration. Azure Pipelines should authenticate through a service connection.

```powershell
./setup_terraform.ps1 -EnvironmentName prod -TenantId '<tenant-id>' -SubscriptionId '<subscription-id>' -ClientId '<client-id>'
```

The three IDs are mandatory. The script prompts for a missing secret and stores it in the
`landingzone` SecretStore vault, using the key `AzureClientSecretprod`.
`-SecretVaultName` selects another vault. `-AzCli` also signs in to Azure CLI.
`-Reset` asks for confirmation before deleting all secrets in that vault.

Run Terraform from the same PowerShell session so it inherits the exported environment variables.
The helper installs the SecretManagement and SecretStore modules for the current user when needed.

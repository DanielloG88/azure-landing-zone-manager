Initial setup of the Terraform remote state
This folder contains a separate terraform configuration that is just used to create a tfstate backend for the main identity platform project.

This only has to be done once: If the corresponding stage has already been initialized, skip this step and start with the deployment of the main project. The stage is initialized, when the resource group (e.g. "rg-tfstate-dev") and the storage account (e.g. "sttfstatekerlddev") including container (e.g. "stct-tfstate-dev") exists in the corresponding stage.
Terraform must store state about your managed infrastructure and configuration. This state is used by Terraform to map real world resources to your configuration, keep track of metadata, and to improve performance for large infrastructures.

This state is stored by default in a local file named "terraform.tfstate". In this setup, we prepare a remote state, stored in an Azure Blob Storage, which can be used by the landing zone project.

Each Terraform configuration can specify a backend, which defines where state snapshots are stored. Initially, the storage account for setting up the remote state does not exist. This could be done manually (see Store Terraform state in Azure Storage). But with the terraform configuration in this folder, the Azure Storage Account and Azure Blob Storage can be created automatically.

Login on the Azure CLI as Service Principal (see Sign in with a service principal or use the helper script setup_terraform.ps1) and execute the following in the "tfstate" folder:

```powershell terraform init terraform apply -var="environment=dev" -state-out="dev.tfstate"

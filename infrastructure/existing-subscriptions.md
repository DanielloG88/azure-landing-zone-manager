# Existing Subscription Onboarding

This landing-zone stack can now manage an already existing Azure subscription without creating a new subscription alias.

## Recommended flow

Use this path when the subscription already hosts workloads and must stay intact.

1. Add the subscription row to `infrastructure/subscriptions.csv`.
2. Set `subscription_id` to the real Azure subscription ID.
3. Leave `bootstrap_subscription_resources=false` for the first onboarding pass.
4. Run Terraform from `infrastructure/` and review the plan before apply.

With this mode Terraform manages only the safest subscription-level landing-zone metadata already represented in this repo:

- subscription tags

Management group attachment is skipped by default for rows with `subscription_id`, because many existing subscriptions are already attached and that attachment would otherwise need an explicit state import.

For legacy subscriptions whose current tags cannot yet be adopted safely, add a `false` entry to `local.subscription_tag_management_overrides` in `main.tf`. This keeps the subscription visible in the portal without changing its tags. Remove the override only after reviewing the existing tags and the Terraform plan.

It does not create a new subscription alias, service principal, tfstate backend resources, or access-group bootstrap unless you explicitly enable that later.

## CSV fields

- `subscription_id`: existing Azure subscription ID. When empty, Terraform creates a new subscription alias as before.
- `bootstrap_subscription_resources`: optional boolean. Defaults to `true` for new subscriptions and `false` for rows with `subscription_id`.
- `manage_management_group_attachment`: optional boolean. Defaults to `true` for new subscriptions and `false` for rows with `subscription_id`.

## First imported subscription

The first imported row is:

- `project_name=vdi`
- `environment=dev`
- `subscription_id=<existing-subscription-id>`

This row is intentionally onboarded with `bootstrap_subscription_resources=false` because the `vdi` repo already has its own backend resources in that subscription:

- resource group `rg-tfstate-vdi-dev`
- storage account `sttfstatevdiuhpapdev`
- container `stct-tfstate-vdi-dev`

## When `terraform import` is still useful

The safe onboarding path above does not require `terraform import`.

Use `terraform import` only if we later decide to let this landing-zone stack adopt resources that already exist inside the subscription, for example:

- an existing service principal created outside this repo
- existing tfstate bootstrap resources that should move under this state
- existing role assignments or access groups that should be fully managed here
- an existing management-group attachment that we want Terraform to own

That second step should be done resource by resource, after checking IDs and naming against the current `vdi` implementation.

import importlib.util
import pathlib
import unittest
import subprocess
import sys
import json

spec = importlib.util.spec_from_file_location("guard", pathlib.Path(__file__).with_name("check-network-plan.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class NetworkPlanTests(unittest.TestCase):
    def test_spoke_replacement_is_destructive(self):
        address = 'module.subscription_networking["sample-dev"].azapi_resource.vnet'
        plan = {"resource_changes": [{"address": address, "change": {"actions": ["delete", "create"]}}]}
        self.assertEqual(guard.destructive_changes(plan, "spoke"), [address])

    def test_updates_and_other_modules_are_not_network_removal(self):
        plan = {"resource_changes": [
            {"address": 'module.subscription_networking["sample-dev"].azapi_resource.vnet', "change": {"actions": ["update"]}},
            {"address": 'module.subscription["sample-dev"].azapi_resource.resource_group', "change": {"actions": ["delete"]}}
        ]}
        self.assertEqual(guard.destructive_changes(plan, "spoke"), [])

    def test_hub_zone_removal_is_destructive(self):
        address = 'module.private_dns.azurerm_private_dns_zone.this["privatelink.blob.core.windows.net"]'
        plan = {"resource_changes": [{"address": address, "change": {"actions": ["delete"]}}]}
        self.assertEqual(guard.destructive_changes(plan, "hub"), [address])

    def test_inline_subnet_address_change_requires_review(self):
        address = 'module.subscription_networking["sample-dev"].azapi_resource.vnet'
        plan = {"resource_changes": [{
            "address": address, "change": {"actions": ["update"],
                "before": {"body": {"properties": {"subnets": [{"properties": {"addressPrefix": "10.20.1.0/24"}}]}}},
                "after": {"body": {"properties": {"subnets": [{"properties": {"addressPrefix": "10.20.2.0/24"}}]}}}
            }
        }]}
        self.assertEqual(guard.destructive_changes(plan, "spoke"), [address])

    def test_cli_blocks_removal_unless_the_manual_flag_is_set(self):
        address = 'module.subscription_networking["sample-dev"].azapi_resource.vnet'
        plan = {"resource_changes": [{"address": address, "change": {"actions": ["delete"]}}]}
        script = str(pathlib.Path(__file__).with_name("check-network-plan.py"))
        blocked = subprocess.run([sys.executable, script], input=json.dumps(plan), capture_output=True, text=True)
        allowed = subprocess.run([sys.executable, script, "--allow-network-deletion", "true"], input=json.dumps(plan), capture_output=True, text=True)
        self.assertEqual(blocked.returncode, 1)
        self.assertEqual(allowed.returncode, 0)


if __name__ == "__main__":
    unittest.main()

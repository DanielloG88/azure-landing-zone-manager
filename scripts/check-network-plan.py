#!/usr/bin/env python3
"""Reject destructive networking changes before publishing a saved Terraform plan."""
import argparse
import json
import sys


def network_prefixes(resource):
    properties = (resource.get("body") or {}).get("properties", {})
    prefixes = list(resource.get("address_space", [])) + list(resource.get("address_prefixes", []))
    prefixes += properties.get("addressSpace", {}).get("addressPrefixes", [])
    for subnet in properties.get("subnets", []):
        settings = subnet.get("properties", {})
        prefixes += settings.get("addressPrefixes", [])
        if settings.get("addressPrefix"):
            prefixes.append(settings["addressPrefix"])
    return sorted(prefixes)


def destructive_changes(plan, scope):
    prefixes = ("module.subscription_networking[",) if scope == "spoke" else ("module.hub.", "module.private_dns.")
    return [
        change["address"]
        for change in plan.get("resource_changes", [])
        if change.get("address", "").startswith(prefixes)
        and (
            "delete" in change.get("change", {}).get("actions", [])
            or (
                "update" in change.get("change", {}).get("actions", [])
                and network_prefixes(change["change"].get("before") or {})
                != network_prefixes(change["change"].get("after") or {})
            )
        )
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-network-deletion", default="false", choices=("true", "false"))
    parser.add_argument("--scope", default="spoke", choices=("spoke", "hub"))
    args = parser.parse_args()
    changes = destructive_changes(json.load(sys.stdin), args.scope)
    if changes and args.allow_network_deletion != "true":
        print("Refusing networking deletion, replacement or address changes. Review these resources:")
        for address in changes:
            print(address)
        print("Queue a manual run with allowNetworkDeletion=true only after reviewing the intended removal.")
        return 1
    print("Networking plan check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

import { z } from "zod";

export const networkFieldMap = {
  networkMode: "network_mode",
  networkHubKey: "network_hub_key",
  networkAddressSpace: "network_address_space",
  networkWorkloadSubnetPrefix: "network_workload_subnet_prefix",
  networkPrivateEndpointSubnetPrefix: "network_private_endpoint_subnet_prefix"
};

export const networkFields = {
  networkMode: z.enum(["none", "spoke"]).optional(),
  networkHubKey: z.string().trim().max(48).optional(),
  networkAddressSpace: z.string().trim().max(32).optional(),
  networkWorkloadSubnetPrefix: z.string().trim().max(32).optional(),
  networkPrivateEndpointSubnetPrefix: z.string().trim().max(32).optional()
};

export function ipv4Interval(value) {
  const match = /^([0-9]{1,3})[.]([0-9]{1,3})[.]([0-9]{1,3})[.]([0-9]{1,3})[/]([0-9]{1,2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (bits > 32 || octets.some((octet) => octet > 255)) return null;
  const first = octets.reduce((total, octet) => total * 256 + octet, 0);
  const size = 2 ** (32 - bits);
  if (first % size !== 0 || value !== octets.join(".") + "/" + bits) return null;
  return { first, last: first + size - 1, bits };
}

export function validateNetworkRequest(request, context) {
  const issue = (field, message) => context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
  const detailsProvided = Object.keys(networkFieldMap).slice(1).some((field) => request[field] !== undefined);
  if (!request.networkMode && detailsProvided) {
    issue("networkMode", "Supply networkMode together with the complete network configuration.");
    return;
  }
  if (request.networkMode !== "spoke") return;
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(request.networkHubKey ?? "")) issue("networkHubKey", "Select a configured shared hub.");
  const fields = ["networkAddressSpace", "networkWorkloadSubnetPrefix", "networkPrivateEndpointSubnetPrefix"];
  const intervals = fields.map((field) => ipv4Interval(request[field]));
  for (let index = 0; index < fields.length; index++) {
    if (!intervals[index]) issue(fields[index], "Use a canonical IPv4 CIDR (network address, without host bits).");
  }
  if (intervals.some((value) => !value)) return;
  const [network, workload, endpoints] = intervals;
  for (const [index, subnet] of [[1, workload], [2, endpoints]]) {
    if (subnet.first < network.first || subnet.last > network.last) issue(fields[index], "Subnet must be inside the spoke address space.");
    if (subnet.bits > 29) issue(fields[index], "Azure subnets require at least a /29 prefix.");
  }
  if (workload.first <= endpoints.last && endpoints.first <= workload.last) issue(fields[2], "Workload and private endpoint subnets must not overlap.");
}

export function assertConfiguredHub(request, hubAliases) {
  if (request.networkMode === "spoke" && !hubAliases.includes(request.networkHubKey)) {
    throw new Error("Selected hub is not configured. Create the hub and configure PORTAL_NETWORK_HUBS first.");
  }
}

export function assertNetworkInventory(rows) {
  const networks = [];
  for (const row of rows) {
    if (String(row.destroy).toLowerCase() === "true" || row.network_mode !== "spoke") continue;
    const interval = ipv4Interval(row.network_address_space);
    if (!interval) throw new Error("Spoke inventory contains an invalid IPv4 address space.");
    const name = row.project_name + "-" + row.environment;
    for (const previous of networks) {
      if (interval.first <= previous.last && previous.first <= interval.last) {
        throw new Error("Spoke ranges overlap: " + previous.name + " and " + name + ". Use one request card with distinct CIDRs per environment.");
      }
    }
    networks.push({ ...interval, name });
  }
}

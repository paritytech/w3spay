// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Minimal read-only ABI subset for the W3SPay merchant registry (the web
 * client only reads). MUST stay structurally identical to
 * `apps/w3spay-admin/src/contract/registry-abi.ts` for the
 * `getMerchantByKey` / `getMerchant` views — drift between writer (admin)
 * and reader (w3spay) silently produces zero rows or garbage decodes.
 *
 * Source of truth: `apps/w3spay-admin/contracts/src/W3SPayRegistry.sol`.
 */
export const W3SPayRegistryABI = [
  {
    inputs: [],
    name: "getVersion",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMerchantCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllTerminalKeys",
    outputs: [{ internalType: "bytes32[]", name: "", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "key", type: "bytes32" }],
    name: "getMerchantByKey",
    outputs: [
      {
        components: [
          { internalType: "string", name: "merchantId", type: "string" },
          { internalType: "string", name: "terminalId", type: "string" },
          { internalType: "bytes32", name: "destinationAccountId", type: "bytes32" },
          { internalType: "string", name: "displayName", type: "string" },
          { internalType: "enum IW3SPayRegistry.MerchantStatus", name: "status", type: "uint8" },
          { internalType: "uint64", name: "addedAt", type: "uint64" },
          { internalType: "uint64", name: "updatedAt", type: "uint64" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct IW3SPayRegistry.MerchantEntry",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

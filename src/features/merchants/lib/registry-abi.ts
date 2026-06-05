/**
 * Minimal ABI subset for the W3SPay merchant registry read path.
 *
 * The web client only ever reads; admins write through the Hardhat scripts
 * in `apps/w3spay-admin/contracts/scripts/`. Vendoring just the views keeps
 * the JS bundle small and the contract surface obvious.
 *
 * MUST stay structurally identical to
 * `apps/w3spay-admin/src/contract/registry-abi.ts` for the
 * `getMerchantByKey` / `getMerchant` views — they decode the same
 * on-chain `MerchantEntry` tuple, and any drift between admin (writer)
 * and w3spay (reader) silently produces zero rows or garbage decodes.
 *
 * Source of truth: `apps/w3spay-admin/contracts/src/W3SPayMerchantRegistry.sol`.
 * Regenerate from `apps/w3spay-admin/contracts/artifacts/...` if you add views.
 */
export const W3SPayMerchantRegistryABI = [
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
          { internalType: "enum IW3SPayMerchantRegistry.MerchantStatus", name: "status", type: "uint8" },
          { internalType: "uint64", name: "addedAt", type: "uint64" },
          { internalType: "uint64", name: "updatedAt", type: "uint64" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct IW3SPayMerchantRegistry.MerchantEntry",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

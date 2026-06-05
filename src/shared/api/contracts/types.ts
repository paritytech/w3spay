/**
 * Shared low-level types for the pallet-revive contract helpers.
 *
 * PAPI v2's `getUnsafeApi()` returns runtime-API call results as `unknown`,
 * so each helper casts at the boundary into the shapes declared here.
 * Adopting `getTypedApi()` + `.papi/` descriptors at the call site would
 * obviate the casts but couples every helper to a single chain's metadata
 * — these shims keep the module chain-agnostic.
 */

/** Shape of `ReviveApi.call(...)` dry-run response. */
export interface ReviveCallDryRun {
  readonly weight_required: {
    readonly ref_time: bigint;
    readonly proof_size: bigint;
  };
  readonly storage_deposit: {
    readonly type: "Charge" | "Refund";
    readonly value: bigint;
  };
  readonly result:
    | {
        readonly success: true;
        readonly value: {
          readonly flags: number;
          readonly data: Uint8Array;
        };
      }
    | {
        readonly success: false;
        readonly value: unknown;
      };
}

/**
 * Substrate `sp_weights::Weight` (v2) shape pallet-revive accepts for the
 * `gasLimit` argument of `ReviveApi.call`. Required when dry-running nested
 * CALL frames (e.g. Multicall3.aggregate3) where the default gas limit is
 * too tight; for top-level reads, pass `undefined`.
 */
export interface WeightV2 {
  readonly ref_time: bigint;
  readonly proof_size: bigint;
}

/**
 * Narrowed view of `client.getUnsafeApi().apis.ReviveApi`. The two methods
 * we touch from this side of the bridge.
 */
export interface ReviveApiShim {
  call(
    origin: string,
    dest: string,
    value: bigint,
    gasLimit: WeightV2 | undefined,
    storageDepositLimit: bigint | undefined,
    data: Uint8Array,
    opts?: { at?: "best" | "finalized" },
  ): Promise<ReviveCallDryRun>;
  address(ss58: string): Promise<`0x${string}` | null | undefined>;
}

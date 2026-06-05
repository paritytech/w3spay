/**
 * PolkadotSigner that signs via `host_sign_payload`, letting custom
 * signed-extensions (e.g. previewnet's `AsPgas`) ride through unencoded.
 * The host knows the runtime; PAPI's PJS adapter doesn't, hence this.
 *
 * Mirrors the flow in @polkadot-api/pjs-signer's `from-pjs-account.js`
 * minus the throw on unknown extensions.
 */
import {
  AccountId,
  Bytes,
  Option,
  Struct,
  compact,
  compactBn,
  u32,
  unifyMetadata,
  decAnyMetadata,
} from '@polkadot-api/substrate-bindings'
import { fromHex, toHex } from '@polkadot-api/utils'
import { createV4Tx } from '@polkadot-api/signers-common'
import { hostApi } from '@novasamatech/host-api-wrapper'
import { enumValue, assertEnumVariant } from '@novasamatech/host-api'
import type { PolkadotSigner } from 'polkadot-api'

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version'

function toPjsHex(value: bigint | number, minByteLen: number): `0x${string}` {
  let inner = value.toString(16)
  inner = (inner.length % 2 ? '0' : '') + inner
  const nPaddedBytes = Math.max(0, minByteLen - inner.length / 2)
  return ('0x' + '00'.repeat(nPaddedBytes) + inner) as `0x${string}`
}

const assetTxPaymentDec = Struct({
  tip: compact,
  asset: Option(Bytes(Infinity)),
}).dec

type Ext = { identifier: string; value: Uint8Array; additionalSigned: Uint8Array }
type Mapper = (ext: Ext, atBlock: number) => Record<string, unknown>

const standardMappers: Record<string, Mapper> = {
  CheckGenesis: ({ additionalSigned }) => ({ genesisHash: toHex(additionalSigned) }),
  CheckNonce: ({ value }) => ({ nonce: toPjsHex(BigInt(compact.dec(value)), 4) }),
  CheckTxVersion: ({ additionalSigned }) => ({
    transactionVersion: toPjsHex(u32.dec(additionalSigned), 4),
  }),
  CheckSpecVersion: ({ additionalSigned }) => ({
    specVersion: toPjsHex(u32.dec(additionalSigned), 4),
  }),
  CheckMortality: ({ value, additionalSigned }, blockNumber) => ({
    era: toHex(value),
    blockHash: toHex(additionalSigned),
    blockNumber: toPjsHex(blockNumber, 4),
  }),
  ChargeTransactionPayment: ({ value }) => ({
    tip: toPjsHex(compactBn.dec(value), 16),
  }),
  ChargeAssetTxPayment: ({ value }) => {
    const { tip, asset } = assetTxPaymentDec(value)
    return {
      ...(asset ? { assetId: toHex(asset as Uint8Array) } : {}),
      tip: toPjsHex(tip, 16),
    }
  },
}

export interface CreateHostTxSignerOpts {
  productAccount: {
    dotNsIdentifier: string
    derivationIndex: number
    publicKey: Uint8Array
  }
}

export function createHostTxSigner(opts: CreateHostTxSignerOpts): PolkadotSigner {
  const productAccountId: [string, number] = [
    opts.productAccount.dotNsIdentifier,
    opts.productAccount.derivationIndex,
  ]
  const ss58Address = AccountId(42).dec(opts.productAccount.publicKey)

  const signBytes = async (data: Uint8Array): Promise<Uint8Array> => {
    const response = await hostApi.signRaw(
      enumValue('v1', {
        account: productAccountId,
        payload: { tag: 'Bytes' as const, value: data },
      }) as any,
    )
    return response.match(
      (resp: any) => {
        assertEnumVariant(resp, 'v1', UNSUPPORTED_VERSION_ERROR)
        const sig = resp.value?.signature
        return typeof sig === 'string' ? fromHex(sig) : (sig as Uint8Array)
      },
      (err: any) => {
        assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR)
        throw err.value
      },
    )
  }

  const signTx = async (
    callData: Uint8Array,
    signedExtensions: Record<string, Ext>,
    metadata: Uint8Array,
    atBlockNumber: number,
  ): Promise<Uint8Array> => {
    const decMeta = unifyMetadata(decAnyMetadata(metadata))
    if (!decMeta.extrinsic.version.includes(4)) {
      throw new Error('Only extrinsic v4 is supported')
    }

    const pjs: any = { signedExtensions: [] as string[] }
    const extra: Uint8Array[] = []

    const extDefs = decMeta.extrinsic.signedExtensions[0]
    if (!extDefs) throw new Error('Runtime metadata has no v4 signed-extension definitions')
    for (const { identifier } of extDefs) {
      const ext = signedExtensions[identifier]
      if (!ext) throw new Error(`Missing ${identifier} signed-extension`)
      extra.push(ext.value)
      pjs.signedExtensions.push(identifier)
      const mapper = standardMappers[identifier]
      if (mapper) Object.assign(pjs, mapper(ext, atBlockNumber))
      // Unknown extensions: name lands in `signedExtensions`, bytes accumulate
      // in `extra` for `createV4Tx`. Host signs the assembled payload natively.
    }

    pjs.address = ss58Address
    pjs.method = toHex(callData)
    pjs.version = 4
    pjs.withSignedTransaction = true

    const response = await hostApi.signPayload(
      enumValue('v1', { account: productAccountId, payload: pjs }) as any,
    )

    return response.match(
      (resp: any) => {
        assertEnumVariant(resp, 'v1', UNSUPPORTED_VERSION_ERROR)
        const value = resp.value
        const signedTx = value?.signedTransaction
        if (signedTx) {
          return typeof signedTx === 'string' ? fromHex(signedTx) : (signedTx as Uint8Array)
        }
        const sig = typeof value?.signature === 'string'
          ? fromHex(value.signature)
          : (value?.signature as Uint8Array)
        return createV4Tx(decMeta, opts.productAccount.publicKey, sig, extra, callData)
      },
      (err: any) => {
        assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR)
        throw err.value
      },
    )
  }

  return {
    publicKey: opts.productAccount.publicKey,
    signTx,
    signBytes,
  }
}
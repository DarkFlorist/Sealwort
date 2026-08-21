import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { isContractMetadataUnavailableError, readIsErc721, readTokenDecimals, readVaultAsset } from './contractMetadata.js'
import { getSafeReadProvider } from './readProvider.js'
import { decodeTransactionData, rawTransactionData, type TransactionDataDecodeResult } from './transactionDecoder.js'
import { amountTokenReferences, resolveTransactionInterpretation, tokenMetadataKey, transactionNeedsErc721Resolution } from './transactionSemantics.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { withWalletRequestTimeout } from './walletProvider.js'

export type TokenMetadataState = { readonly status: 'available', readonly decimals: number } | { readonly status: 'nft' } | { readonly status: 'error', readonly message: string }
export type TransactionAmountMetadataState =
	| { readonly status: 'idle' | 'loading' }
	| { readonly status: 'failed', readonly message: string }
	| { readonly status: 'ready', readonly vaultAsset: bigint | undefined, readonly vaultAssetError: string | undefined, readonly tokens: Readonly<Record<string, TokenMetadataState>> }

type MetadataResult = { readonly decoded: TransactionDataDecodeResult, readonly metadata: TransactionAmountMetadataState }
type SettledResult<T> = { readonly status: 'fulfilled', readonly value: T } | { readonly status: 'rejected', readonly reason: unknown }

async function settle<T>(promise: Promise<T>): Promise<SettledResult<T>> {
	const [result] = await Promise.allSettled([promise])
	if (result === undefined) throw new Error('Promise settlement did not return a result.')
	return result
}

async function loadMetadata(
	initialDecoded: TransactionDataDecodeResult,
	destination: bigint,
	chainId: bigint,
	walletRequestTimeoutMs?: number,
): Promise<MetadataResult> {
	if (initialDecoded.status !== 'decoded') return { decoded: initialDecoded, metadata: { status: 'idle' } }
	let decoded = initialDecoded
	let references = amountTokenReferences(decoded.call)
	const needsProvider = transactionNeedsErc721Resolution(decoded)
		|| references.some((reference) => reference !== 'native' && reference !== 'liquidity')
	if (!needsProvider) return { decoded, metadata: { status: 'idle' } }

	const injectedProvider = window.ethereum === undefined ? undefined : withWalletRequestTimeout(window.ethereum, walletRequestTimeoutMs)
	const readProvider = await getSafeReadProvider(chainId, injectedProvider)
	const provider = withWalletRequestTimeout(readProvider.provider, walletRequestTimeoutMs)

	if (transactionNeedsErc721Resolution(decoded)) {
		const interfaceResult = await settle(readIsErc721(provider, destination))
		if (interfaceResult.status === 'rejected' && !isContractMetadataUnavailableError(interfaceResult.reason)) throw interfaceResult.reason
		const resolved = resolveTransactionInterpretation(decoded, interfaceResult.status === 'fulfilled' && interfaceResult.value)
		if (resolved.status !== 'decoded') throw new Error('Resolved transaction data unexpectedly became unavailable.')
		decoded = resolved
		references = amountTokenReferences(decoded.call)
	}

	let vaultAsset: bigint | undefined
	let vaultAssetError: string | undefined
	if (references.includes('vaultAsset')) {
		const assetResult = await settle(readVaultAsset(provider, destination))
		if (assetResult.status === 'fulfilled') vaultAsset = assetResult.value
		else vaultAssetError = isContractMetadataUnavailableError(assetResult.reason)
			? 'Could not read this vault’s asset.'
			: getUserFacingErrorMessage(assetResult.reason)
	}
	const addresses = references.flatMap((reference) => {
		if (reference === 'native' || reference === 'liquidity') return []
		if (reference === 'destination') return [destination]
		if (reference === 'vaultAsset') return vaultAsset === undefined ? [] : [vaultAsset]
		return [reference]
	}).filter((address, index, all) => all.indexOf(address) === index)
	const entries = await Promise.all(addresses.map(async (address) => {
		const decimalsResult = await settle(readTokenDecimals(provider, address))
		if (decimalsResult.status === 'fulfilled') return [tokenMetadataKey(address), { status: 'available', decimals: decimalsResult.value } satisfies TokenMetadataState] as const
		if (!isContractMetadataUnavailableError(decimalsResult.reason)) {
			return [tokenMetadataKey(address), { status: 'error', message: getUserFacingErrorMessage(decimalsResult.reason) } satisfies TokenMetadataState] as const
		}
		const nftResult = await settle(readIsErc721(provider, address))
		if (nftResult.status === 'fulfilled' && nftResult.value) return [tokenMetadataKey(address), { status: 'nft' } satisfies TokenMetadataState] as const
		if (nftResult.status === 'rejected' && !isContractMetadataUnavailableError(nftResult.reason)) {
			return [tokenMetadataKey(address), { status: 'error', message: getUserFacingErrorMessage(nftResult.reason) } satisfies TokenMetadataState] as const
		}
		return [tokenMetadataKey(address), { status: 'error', message: 'Could not read this token’s decimals.' } satisfies TokenMetadataState] as const
	}))
	return { decoded, metadata: { status: 'ready', vaultAsset, vaultAssetError, tokens: Object.fromEntries(entries) } }
}

export function useTransactionDataMetadata(
	destination: bigint,
	data: Uint8Array,
	chainId: bigint,
	walletRequestTimeoutMs?: number,
) {
	const key = `${ chainId.toString() }:${ destination.toString() }:${ rawTransactionData(data) }`
	const initialDecoded = decodeTransactionData(chainId, destination, data)
	const state = useSignal<{ readonly key: string, readonly result: MetadataResult }>({ key, result: { decoded: initialDecoded, metadata: { status: 'loading' } } })

	useEffect(() => {
		let current = true
		state.value = { key, result: { decoded: initialDecoded, metadata: { status: 'loading' } } }
		void loadMetadata(initialDecoded, destination, chainId, walletRequestTimeoutMs).then((result) => {
			if (current) state.value = { key, result }
		}, (metadataError: unknown) => {
			if (current) state.value = { key, result: { decoded: initialDecoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(metadataError) } } }
		})
		return () => { current = false }
	}, [key, walletRequestTimeoutMs])

	return state.value.key === key ? state.value.result : { decoded: initialDecoded, metadata: { status: 'loading' } as const }
}

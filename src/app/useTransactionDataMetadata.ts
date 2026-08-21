import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { isContractMetadataUnavailableError, readIsErc721, readTokenDecimals, readVaultAsset } from './contractMetadata.js'
import { getSafeReadProvider } from './readProvider.js'
import type { SafeStackExport } from './safeStackProtocol.js'
import type { InjectedProvider } from './safeStackValidation.js'
import { decodeTransactionData, rawTransactionData, type TransactionDataDecodeResult } from './transactionDecoder.js'
import { amountTokenReferences, resolveTransactionInterpretation, tokenMetadataKey, transactionNeedsErc721Resolution } from './transactionSemantics.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { withWalletRequestTimeout } from './walletProvider.js'

export type TokenMetadataState = { readonly status: 'available', readonly decimals: number } | { readonly status: 'nft' } | { readonly status: 'error', readonly message: string }
export type TransactionAmountMetadataState =
	| { readonly status: 'idle' | 'loading' }
	| { readonly status: 'failed', readonly message: string }
	| { readonly status: 'ready', readonly vaultAsset: bigint | undefined, readonly vaultAssetError: string | undefined, readonly tokens: Readonly<Record<string, TokenMetadataState>> }

export type TransactionDataMetadataResult = { readonly decoded: TransactionDataDecodeResult, readonly metadata: TransactionAmountMetadataState }
export type TransactionDataMetadata = readonly (readonly TransactionDataMetadataResult[])[]
type SettledResult<T> = { readonly status: 'fulfilled', readonly value: T } | { readonly status: 'rejected', readonly reason: unknown }

async function settle<T>(promise: Promise<T>): Promise<SettledResult<T>> {
	const [result] = await Promise.allSettled([promise])
	if (result === undefined) throw new Error('Promise settlement did not return a result.')
	return result
}

function needsProvider(decoded: TransactionDataDecodeResult) {
	return decoded.status === 'decoded' && (transactionNeedsErc721Resolution(decoded)
		|| amountTokenReferences(decoded.call).some((reference) => reference !== 'native' && reference !== 'liquidity'))
}

async function loadMetadata(initialDecoded: TransactionDataDecodeResult, destination: bigint, provider: InjectedProvider): Promise<TransactionDataMetadataResult> {
	if (initialDecoded.status !== 'decoded') return { decoded: initialDecoded, metadata: { status: 'idle' } }
	let decoded = initialDecoded
	let references = amountTokenReferences(decoded.call)

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

function stackMetadataRevision(stackExport: SafeStackExport | undefined) {
	if (stackExport === undefined) return ''
	return stackExport.stacks.flatMap((stack) => stack.transactions.map((transaction) =>
		`${ stack.chainId.toString() }:${ transaction.safeTxHash.toString(16) }:${ transaction.safeTx.message.to.toString(16) }:${ rawTransactionData(transaction.safeTx.message.data) }`,
	)).join('|')
}

function initialMetadata(stackExport: SafeStackExport | undefined): TransactionDataMetadata {
	if (stackExport === undefined) return []
	return stackExport.stacks.map((stack) => stack.transactions.map((transaction) => {
		const decoded = decodeTransactionData(stack.chainId, transaction.safeTx.message.to, transaction.safeTx.message.data)
		return { decoded, metadata: { status: needsProvider(decoded) ? 'loading' : 'idle' } }
	}))
}

async function loadStackMetadata(stackExport: SafeStackExport, walletRequestTimeoutMs: number | undefined): Promise<TransactionDataMetadata> {
	const injectedProvider = window.ethereum === undefined ? undefined : withWalletRequestTimeout(window.ethereum, walletRequestTimeoutMs)
	const providers = new Map<string, Promise<InjectedProvider>>()
	const providerForChain = (chainId: bigint) => {
		const key = chainId.toString()
		const existing = providers.get(key)
		if (existing !== undefined) return existing
		const provider = getSafeReadProvider(chainId, injectedProvider).then(({ provider: readProvider }) => withWalletRequestTimeout(readProvider, walletRequestTimeoutMs))
		providers.set(key, provider)
		return provider
	}
	return await Promise.all(stackExport.stacks.map(async (stack) => await Promise.all(stack.transactions.map(async (transaction) => {
		const decoded = decodeTransactionData(stack.chainId, transaction.safeTx.message.to, transaction.safeTx.message.data)
		if (!needsProvider(decoded)) return { decoded, metadata: { status: 'idle' } } as const
		return await providerForChain(stack.chainId).then((provider) => loadMetadata(decoded, transaction.safeTx.message.to, provider)).then(
			(result) => result,
			(metadataError: unknown) => ({ decoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(metadataError) } }) as const,
		)
	}))))
}

export function useTransactionDataMetadata(stackExport: SafeStackExport | undefined, walletRequestTimeoutMs?: number) {
	const revision = stackMetadataRevision(stackExport)
	const initial = initialMetadata(stackExport)
	const state = useSignal<{ readonly revision: string, readonly metadata: TransactionDataMetadata }>({ revision, metadata: initial })

	useEffect(() => {
		let current = true
		state.value = { revision, metadata: initial }
		if (stackExport !== undefined) void loadStackMetadata(stackExport, walletRequestTimeoutMs).then((metadata) => {
			if (current) state.value = { revision, metadata }
		}, (metadataError: unknown) => {
			if (!current) return
			const message = getUserFacingErrorMessage(metadataError)
			state.value = { revision, metadata: initial.map((stack) => stack.map((result) => ({ decoded: result.decoded, metadata: { status: 'failed', message } }))) }
		})
		return () => { current = false }
	}, [revision, walletRequestTimeoutMs])

	return state.value.revision === revision ? state.value.metadata : initial
}

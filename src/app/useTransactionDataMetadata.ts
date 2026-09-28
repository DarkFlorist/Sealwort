import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { isContractMetadataUnavailableError, readIsErc721, readTokenDecimals, readVaultAsset } from './contractMetadata.js'
import { DEFAULT_ETHEREUM_RPC_URL } from './rpcSettings.js'
import { getSafeReadProvider } from './readProvider.js'
import type { SafeStackExport } from './safeStackProtocol.js'
import type { InjectedProvider } from './provider.js'
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

async function loadMetadata(initialDecoded: TransactionDataDecodeResult, destination: bigint, getProvider: () => Promise<InjectedProvider>, previous?: TransactionDataMetadataResult): Promise<TransactionDataMetadataResult> {
	if (initialDecoded.status !== 'decoded') return { decoded: initialDecoded, metadata: { status: 'idle' } }
	const cached = previous?.metadata.status === 'ready' ? previous : undefined
	let decoded = cached?.decoded.status === 'decoded' ? cached.decoded : initialDecoded
	let references = amountTokenReferences(decoded.call)

	if (transactionNeedsErc721Resolution(decoded)) {
		const interfaceResult = await settle(readIsErc721(await getProvider(), destination))
		const resolved = resolveTransactionInterpretation(decoded, interfaceResult.status === 'fulfilled' && interfaceResult.value)
		if (resolved.status !== 'decoded') throw new Error('Resolved transaction data unexpectedly became unavailable.')
		decoded = resolved
		if (interfaceResult.status === 'rejected' && !isContractMetadataUnavailableError(interfaceResult.reason)) {
			return { decoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(interfaceResult.reason) } }
		}
		references = amountTokenReferences(decoded.call)
	}

	let vaultAsset = cached?.metadata.status === 'ready' ? cached.metadata.vaultAsset : undefined
	let vaultAssetError: string | undefined
	if (references.includes('vaultAsset') && vaultAsset === undefined) {
		const assetResult = await settle(readVaultAsset(await getProvider(), destination))
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
		const token = cached?.metadata.status === 'ready' ? cached.metadata.tokens[tokenMetadataKey(address)] : undefined
		if (token !== undefined && token.status !== 'error') return [tokenMetadataKey(address), token] as const
		const decimalsResult = await settle(readTokenDecimals(await getProvider(), address))
		if (decimalsResult.status === 'fulfilled') return [tokenMetadataKey(address), { status: 'available', decimals: decimalsResult.value } satisfies TokenMetadataState] as const
		if (!isContractMetadataUnavailableError(decimalsResult.reason)) {
			return [tokenMetadataKey(address), { status: 'error', message: getUserFacingErrorMessage(decimalsResult.reason) } satisfies TokenMetadataState] as const
		}
		const nftResult = await settle(readIsErc721(await getProvider(), address))
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

async function loadStackMetadata(stackExport: SafeStackExport, walletRequestTimeoutMs: number | undefined, ethereumRpcUrl: string, previous: TransactionDataMetadata): Promise<TransactionDataMetadata> {
	const injectedProvider = window.ethereum === undefined ? undefined : withWalletRequestTimeout(window.ethereum, walletRequestTimeoutMs)
	const providers = new Map<string, Promise<InjectedProvider>>()
	const providerForChain = (chainId: bigint) => {
		const key = chainId.toString()
		const existing = providers.get(key)
		if (existing !== undefined) return existing
		const provider = getSafeReadProvider(chainId, injectedProvider, globalThis.fetch, ethereumRpcUrl).then(({ provider: readProvider }) => withWalletRequestTimeout(readProvider, walletRequestTimeoutMs))
		providers.set(key, provider)
		return provider
	}
	return await Promise.all(stackExport.stacks.map(async (stack, stackIndex) => await Promise.all(stack.transactions.map(async (transaction, transactionIndex) => {
		const cached = previous[stackIndex]?.[transactionIndex]
		const decoded = decodeTransactionData(stack.chainId, transaction.safeTx.message.to, transaction.safeTx.message.data)
		if (!needsProvider(decoded)) return { decoded, metadata: { status: 'idle' } } as const
		return await loadMetadata(decoded, transaction.safeTx.message.to, () => providerForChain(stack.chainId), cached).then(
			(result) => result,
			(metadataError: unknown) => ({ decoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(metadataError) } }) as const,
		)
	}))))
}

type TransactionDataMetadataOptions = {
	readonly walletRequestTimeoutMs?: number | undefined
	/** Retry failed reads without invalidating successful metadata for unchanged calldata. */
	readonly retryRevision?: number
	readonly ethereumRpcUrl?: string
}

export function useTransactionDataMetadata(stackExport: SafeStackExport | undefined, { walletRequestTimeoutMs, retryRevision = 0, ethereumRpcUrl = DEFAULT_ETHEREUM_RPC_URL }: TransactionDataMetadataOptions = {}) {
	const revision = JSON.stringify([stackMetadataRevision(stackExport), ethereumRpcUrl])
	const initial = initialMetadata(stackExport)
	const state = useSignal<{ readonly revision: string, readonly metadata: TransactionDataMetadata }>({ revision, metadata: initial })

	useEffect(() => {
		let current = true
		const previous = state.peek()
		const retained = previous.revision === revision ? previous.metadata : initial
		state.value = { revision, metadata: retained }
		if (stackExport !== undefined) void loadStackMetadata(stackExport, walletRequestTimeoutMs, ethereumRpcUrl, retained).then((metadata) => {
			if (current) state.value = { revision, metadata }
		}, (metadataError: unknown) => {
			if (!current) return
			const message = getUserFacingErrorMessage(metadataError)
			state.value = { revision, metadata: initial.map((stack) => stack.map((result) => ({ decoded: result.decoded, metadata: { status: 'failed', message } }))) }
		})
		return () => { current = false }
	}, [revision, retryRevision, ethereumRpcUrl, walletRequestTimeoutMs])

	return state.value.revision === revision ? state.value.metadata : initial
}

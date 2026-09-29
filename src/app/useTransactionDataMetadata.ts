import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
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

// Share pending reads and retain successes. Failed reads are removed for the next refresh.
function createReadCache<T>(isSuccessful: (value: T) => boolean = () => true) {
	const reads = new Map<string, Promise<T>>()
	return (key: string, read: () => Promise<T>): Promise<T> => {
		const existing = reads.get(key)
		if (existing !== undefined) return existing
		const pending = read().then((value) => {
			if (!isSuccessful(value)) reads.delete(key)
			return value
		}, (error: unknown) => {
			reads.delete(key)
			throw error
		})
		reads.set(key, pending)
		return pending
	}
}

function createMetadataCache() {
	return {
		interface: createReadCache<boolean>(),
		asset: createReadCache<bigint>(),
		token: createReadCache<TokenMetadataState>((token) => token.status !== 'error'),
	}
}
type MetadataCache = ReturnType<typeof createMetadataCache>
type MetadataReader = {
	readonly isErc721: (address: bigint) => Promise<boolean>
	readonly vaultAsset: (address: bigint) => Promise<bigint>
	readonly token: (address: bigint) => Promise<TokenMetadataState>
}

async function readTokenMetadata(provider: InjectedProvider, address: bigint): Promise<TokenMetadataState> {
	const decimalsResult = await settle(readTokenDecimals(provider, address))
	if (decimalsResult.status === 'fulfilled') return { status: 'available', decimals: decimalsResult.value }
	if (!isContractMetadataUnavailableError(decimalsResult.reason)) return { status: 'error', message: getUserFacingErrorMessage(decimalsResult.reason) }
	const nftResult = await settle(readIsErc721(provider, address))
	if (nftResult.status === 'fulfilled' && nftResult.value) return { status: 'nft' }
	if (nftResult.status === 'rejected' && !isContractMetadataUnavailableError(nftResult.reason)) return { status: 'error', message: getUserFacingErrorMessage(nftResult.reason) }
	return { status: 'error', message: 'Could not read this token’s decimals.' }
}

async function loadMetadata(initialDecoded: TransactionDataDecodeResult, destination: bigint, reader: MetadataReader): Promise<TransactionDataMetadataResult> {
	if (initialDecoded.status !== 'decoded') return { decoded: initialDecoded, metadata: { status: 'idle' } }
	let decoded = initialDecoded
	let references = amountTokenReferences(decoded.call)

	if (transactionNeedsErc721Resolution(decoded)) {
		const interfaceResult = await settle(reader.isErc721(destination))
		const resolved = resolveTransactionInterpretation(decoded, interfaceResult.status === 'fulfilled' && interfaceResult.value)
		if (resolved.status !== 'decoded') throw new Error('Resolved transaction data unexpectedly became unavailable.')
		decoded = resolved
		if (interfaceResult.status === 'rejected' && !isContractMetadataUnavailableError(interfaceResult.reason)) {
			return { decoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(interfaceResult.reason) } }
		}
		references = amountTokenReferences(decoded.call)
	}

	let vaultAsset: bigint | undefined
	let vaultAssetError: string | undefined
	if (references.includes('vaultAsset')) {
		const assetResult = await settle(reader.vaultAsset(destination))
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
	const entries = await Promise.all(addresses.map(async (address) => [tokenMetadataKey(address), await reader.token(address)] as const))
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

async function loadStackMetadata(stackExport: SafeStackExport, walletRequestTimeoutMs: number | undefined, ethereumRpcUrl: string, cache: MetadataCache): Promise<TransactionDataMetadata> {
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
	return await Promise.all(stackExport.stacks.map(async (stack) => await Promise.all(stack.transactions.map(async (transaction) => {
		const decoded = decodeTransactionData(stack.chainId, transaction.safeTx.message.to, transaction.safeTx.message.data)
		if (!needsProvider(decoded)) return { decoded, metadata: { status: 'idle' } } as const
		return await loadMetadata(decoded, transaction.safeTx.message.to, {
			isErc721: (address) => cache.interface(`${ stack.chainId }:${ address }`, async () => readIsErc721(await providerForChain(stack.chainId), address)),
			vaultAsset: (address) => cache.asset(`${ stack.chainId }:${ address }`, async () => readVaultAsset(await providerForChain(stack.chainId), address)),
			token: (address) => cache.token(`${ stack.chainId }:${ address }`, async () => readTokenMetadata(await providerForChain(stack.chainId), address)),
		}).then(
			(result) => result,
			(metadataError: unknown) => ({ decoded, metadata: { status: 'failed', message: getUserFacingErrorMessage(metadataError) } }) as const,
		)
	}))))
}

type TransactionDataMetadataOptions = {
	readonly walletRequestTimeoutMs?: number | undefined
	readonly ethereumRpcUrl?: string
}

export function useTransactionDataMetadata(stackExport: SafeStackExport | undefined, { walletRequestTimeoutMs, ethereumRpcUrl = DEFAULT_ETHEREUM_RPC_URL }: TransactionDataMetadataOptions = {}) {
	const retryRevision = useSignal(0)
	const cache = useRef<{ revision: string, reads: MetadataCache }>()
	const revision = JSON.stringify([stackMetadataRevision(stackExport), ethereumRpcUrl])
	const initial = initialMetadata(stackExport)
	const state = useSignal<{ readonly revision: string, readonly metadata: TransactionDataMetadata }>({ revision, metadata: initial })

	useEffect(() => {
		let current = true
		if (cache.current?.revision !== revision) cache.current = { revision, reads: createMetadataCache() }
		const previous = state.peek()
		const retained = previous.revision === revision ? previous.metadata : initial
		state.value = { revision, metadata: retained }
		if (stackExport !== undefined) void loadStackMetadata(stackExport, walletRequestTimeoutMs, ethereumRpcUrl, cache.current.reads).then((metadata) => {
			if (current) state.value = { revision, metadata }
		}, (metadataError: unknown) => {
			if (!current) return
			const message = getUserFacingErrorMessage(metadataError)
			state.value = { revision, metadata: initial.map((stack) => stack.map((result) => ({ decoded: result.decoded, metadata: { status: 'failed', message } }))) }
		})
		return () => { current = false }
	}, [revision, retryRevision.value, walletRequestTimeoutMs])

	return {
		metadata: state.value.revision === revision ? state.value.metadata : initial,
		/** Retry failed reads; successful reads remain cached until calldata or RPC changes. */
		refresh: () => { retryRevision.value = retryRevision.peek() + 1 },
	}
}

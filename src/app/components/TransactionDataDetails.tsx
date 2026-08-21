import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { getNativeAssetSymbol } from '../accountBalances.js'
import { getAddressLabel, identifiedAddress } from '../addressLabels.js'
import { getSafeReadProvider } from '../readProvider.js'
import { amountTokenForArgument, amountTokenReferences, decodedArguments, decodeTransactionData, formatDecodedValue, formatTokenAmount, hasErc721AmountAmbiguity, isContractMetadataUnavailableError, rawTransactionData, readIsErc721, readTokenDecimals, readVaultAsset, type AmountTokenReference } from '../transactionData.js'
import { getUserFacingErrorMessage } from '../userFacingErrors.js'

type TokenState = { readonly status: 'available', readonly decimals: number } | { readonly status: 'nft' } | { readonly status: 'error', readonly message: string }
type AmountMetadataState =
	| { readonly status: 'idle' | 'loading' }
	| { readonly status: 'failed', readonly message: string }
	| { readonly status: 'ready', readonly vaultAsset: bigint | undefined, readonly vaultAssetError: string | undefined, readonly tokens: Readonly<Record<string, TokenState>> }

type SettledResult<T> = { readonly status: 'fulfilled', readonly value: T } | { readonly status: 'rejected', readonly reason: unknown }

async function settle<T>(promise: Promise<T>): Promise<SettledResult<T>> {
	const [result] = await Promise.allSettled([promise])
	if (result === undefined) throw new Error('Promise settlement did not return a result.')
	return result
}

function argumentAddress(value: unknown) {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value) ? BigInt(value) : undefined
}

const ARGUMENT_LABELS: Readonly<Record<string, string>> = {
	amount: 'Amount',
	amountADesired: 'Token A desired',
	amountAMin: 'Token A minimum',
	amountBDesired: 'Token B desired',
	amountBMin: 'Token B minimum',
	amountIn: 'Amount in',
	amountInMax: 'Maximum amount in',
	amountInMaximum: 'Maximum amount in',
	amountOut: 'Amount out',
	amountOutMin: 'Minimum amount out',
	amountOutMinimum: 'Minimum amount out',
	amountMinimum: 'Minimum amount',
	assets: 'Assets',
	approved: 'Approved address',
	aggregatorId: 'Aggregator',
	controller: 'Controller',
	data: 'Data',
	deadline: 'Deadline',
	dest: 'Destination token',
	destAddress: 'Recipient',
	fee: 'Pool fee',
	feeAddress: 'Fee recipient',
	feeAmount: 'Fee amount',
	feeBips: 'Fee (bps)',
	feeRecipient: 'Fee recipient',
	from: 'Sender',
	maxDestAmount: 'Maximum destination amount',
	minConversionRate: 'Minimum conversion rate',
	id: 'Token ID',
	operator: 'Operator',
	owner: 'Owner',
	path: 'Swap path',
	paymentReference: 'Payment reference',
	platformWallet: 'Platform wallet',
	recipient: 'Recipient',
	receiver: 'Recipient',
	shares: 'Shares',
	src: 'Source token',
	srcAmount: 'Source amount',
	spender: 'Spender',
	sqrtPriceLimitX96: 'Price limit',
	to: 'Recipient',
	token: 'Token',
	tokenA: 'Token A',
	tokenB: 'Token B',
	tokenAddress: 'Token',
	tokenFrom: 'Source token',
	tokenIn: 'Input token',
	tokenOut: 'Output token',
	tokenId: 'Token ID',
	value: 'Amount',
	wad: 'Amount',
}

function argumentLabel(signature: string, name: string, nft: boolean) {
	if (nft && (name === 'value' || name === 'amount')) return 'Token ID'
	if (nft && signature === 'safeTransferFrom(address,address,uint256)' && name === 'tokenAddress') return 'Sender'
	return ARGUMENT_LABELS[name] ?? name
}

function displayDecodedValue(value: unknown, chainId: bigint, connectedAccount: bigint | undefined): string {
	const address = argumentAddress(value)
	if (address !== undefined) return identifiedAddress(address, chainId, connectedAccount)
	if (Array.isArray(value)) return value.map((entry) => displayDecodedValue(entry, chainId, connectedAccount)).join(', ')
	if (value === undefined) return 'No arguments'
	return formatDecodedValue(value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function tokenKey(address: bigint) {
	return address.toString(16)
}

function resolvedTokenAddress(reference: AmountTokenReference, destination: bigint, metadata: AmountMetadataState) {
	if (reference === 'liquidity' || reference === 'native') return reference
	if (reference === 'destination') return destination
	if (reference === 'vaultAsset') return metadata.status === 'ready' ? metadata.vaultAsset : undefined
	return reference
}

export function TransactionDataDetails({ data, destination, transactionValue, chainId, connectedAccount }: {
	readonly data: Uint8Array
	readonly destination: bigint
	readonly transactionValue: bigint
	readonly chainId: bigint
	readonly connectedAccount: bigint | undefined
}) {
	const [showParsed, setShowParsed] = useState(true)
	const decoded = decodeTransactionData(destination, data)
	const references = decoded.status === 'decoded' ? amountTokenReferences(decoded.call) : []
	const [metadata, setMetadata] = useState<AmountMetadataState>({ status: 'idle' })
	const raw = rawTransactionData(data)

	useEffect(() => {
		if (decoded.status !== 'decoded' || references.length === 0 || references.every((reference) => reference === 'native' || reference === 'liquidity')) {
			setMetadata({ status: 'idle' })
			return
		}
		let current = true
		setMetadata({ status: 'loading' })
		void getSafeReadProvider(chainId, window.ethereum).then(async ({ provider }) => {
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
				if (decimalsResult.status === 'fulfilled') return [tokenKey(address), { status: 'available', decimals: decimalsResult.value } satisfies TokenState] as const
				if (!isContractMetadataUnavailableError(decimalsResult.reason)) {
					return [tokenKey(address), { status: 'error', message: getUserFacingErrorMessage(decimalsResult.reason) } satisfies TokenState] as const
				}
				if (hasErc721AmountAmbiguity(decoded.call)) {
					const nftResult = await settle(readIsErc721(provider, address))
					if (nftResult.status === 'fulfilled' && nftResult.value) return [tokenKey(address), { status: 'nft' } satisfies TokenState] as const
					if (nftResult.status === 'rejected' && !isContractMetadataUnavailableError(nftResult.reason)) {
						return [tokenKey(address), { status: 'error', message: getUserFacingErrorMessage(nftResult.reason) } satisfies TokenState] as const
					}
				}
				return [tokenKey(address), { status: 'error', message: 'Could not read this token’s decimals.' } satisfies TokenState] as const
			}))
			return { status: 'ready', vaultAsset, vaultAssetError, tokens: Object.fromEntries(entries) } as const
		}).then((nextState) => {
			if (current) setMetadata(nextState)
		}, (metadataError: unknown) => {
			if (current) setMetadata({ status: 'failed', message: getUserFacingErrorMessage(metadataError) })
		})
		return () => { current = false }
	}, [chainId, destination, raw])

	const renderAmount = (value: bigint, reference: AmountTokenReference) => {
		const address = resolvedTokenAddress(reference, destination, metadata)
		if (address === 'native') return formatTokenAmount(value, 18, getNativeAssetSymbol(chainId))
		if (address === 'liquidity') return formatTokenAmount(value, 18, 'LP tokens')
		if (metadata.status === 'failed') return <span class = 'data-parse-error'>{ metadata.message }</span>
		if (metadata.status !== 'ready') return 'Reading token decimals…'
		if (reference === 'vaultAsset' && metadata.vaultAssetError !== undefined) return <span class = 'data-parse-error'>{ metadata.vaultAssetError }</span>
		if (address === undefined) return <span class = 'data-parse-error'>Token decimals unavailable.</span>
		const token = metadata.tokens[tokenKey(address)]
		if (token?.status === 'available') return formatTokenAmount(value, token.decimals, getAddressLabel(address, chainId))
		if (token?.status === 'nft') return value.toString()
		return <span class = 'data-parse-error'>{ token?.message ?? 'Token decimals unavailable.' }</span>
	}
	function renderValue(name: string, value: unknown, scope: Readonly<Record<string, unknown>>, key: string): ComponentChildren {
		const address = argumentAddress(value)
		if (address !== undefined) return identifiedAddress(address, chainId, connectedAccount)
		const reference = typeof value === 'bigint' && decoded.status === 'decoded' ? amountTokenForArgument(decoded.call, name, scope) : undefined
		if (typeof value === 'bigint' && reference !== undefined) return renderAmount(value, reference)
		if (isRecord(value)) return <dl class = 'decoded-nested'>{ renderFields(value, key) }</dl>
		if (Array.isArray(value) && value.some((entry) => isRecord(entry) || Array.isArray(entry))) return <div class = 'decoded-nested'>{ value.map((entry, index) => isRecord(entry)
			? <dl key = { `${ key }:${ index }` }>{ renderFields(entry, `${ key }:${ index }`) }</dl>
			: <div key = { `${ key }:${ index }` }>{ displayDecodedValue(entry, chainId, connectedAccount) }</div>) }</div>
		return displayDecodedValue(value, chainId, connectedAccount)
	}
	function renderFields(scope: Readonly<Record<string, unknown>>, prefix: string): ComponentChildren {
		return Object.entries(scope).map(([name, value]) => {
			const reference = typeof value === 'bigint' && decoded.status === 'decoded' ? amountTokenForArgument(decoded.call, name, scope) : undefined
			const address = reference === undefined ? undefined : resolvedTokenAddress(reference, destination, metadata)
			const nft = typeof address === 'bigint' && metadata.status === 'ready' && metadata.tokens[tokenKey(address)]?.status === 'nft'
			return <><dt key = { `${ prefix }:${ name }:label` }>{ argumentLabel(decoded.status === 'decoded' ? decoded.call.signature : '', name.replace(/^_/u, ''), nft) }</dt><dd key = { `${ prefix }:${ name }` } class = { argumentAddress(value) === undefined ? undefined : 'address' }>{ renderValue(name, value, scope, `${ prefix }:${ name }`) }</dd></>
		})
	}

	return <div class = 'transaction-data'>
		<div class = 'data-view-toggle' role = 'group' aria-label = 'Data view'>
			<button type = 'button' class = { showParsed ? 'selected' : '' } aria-pressed = { showParsed } onClick = { () => { setShowParsed(true) } }>Parsed</button>
			<button type = 'button' class = { showParsed ? '' : 'selected' } aria-pressed = { !showParsed } onClick = { () => { setShowParsed(false) } }>Raw</button>
		</div>
		{ showParsed
			? decoded.status === 'empty'
				? <span class = 'muted'>No calldata</span>
				: decoded.status === 'unknown'
					? <span class = 'data-parse-error'>Unknown function · switch to Raw</span>
					: decoded.status === 'error'
						? <span class = 'data-parse-error'>Invalid calldata: { decoded.error }</span>
						: <div class = 'decoded-call'>
							<strong>{ decoded.call.name }</strong>
							{ decoded.call.signature === 'deposit()' ? <dl><dt>Amount</dt><dd>{ formatTokenAmount(transactionValue, 18, getAddressLabel(destination, chainId) ?? 'WETH') }</dd></dl> : <></> }
							{ decodedArguments(decoded.call).length === 0 ? <></> : Array.isArray(decoded.call.arguments)
								? <div class = 'decoded-nested'>{ decoded.call.arguments.map((value, index) => isRecord(value) ? <dl key = { index }>{ renderFields(value, `argument:${ index }`) }</dl> : <div key = { index }>{ displayDecodedValue(value, chainId, connectedAccount) }</div>) }</div>
								: <dl>{ renderFields(decoded.call.arguments as Readonly<Record<string, unknown>>, 'argument') }</dl> }
						</div>
			: <code class = 'raw-data'>{ raw }</code> }
	</div>
}

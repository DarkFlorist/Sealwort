import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { getNativeAssetSymbol } from '../assetFormatting.js'
import { getAddressLabel, identifiedAddress } from '../addressLabels.js'
import { amountTokenForArgument, decodedArguments, formatDecodedValue, formatTokenAmount, rawTransactionData, type AmountTokenReference } from '../transactionData.js'
import { useTransactionDataMetadata, type TransactionAmountMetadataState } from '../useTransactionDataMetadata.js'

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

function resolvedTokenAddress(reference: AmountTokenReference, destination: bigint, metadata: TransactionAmountMetadataState) {
	if (reference === 'liquidity' || reference === 'native') return reference
	if (reference === 'destination') return destination
	if (reference === 'vaultAsset') return metadata.status === 'ready' ? metadata.vaultAsset : undefined
	return reference
}

export function TransactionDataDetails({ data, destination, transactionValue, chainId, connectedAccount, walletRequestTimeoutMs }: {
	readonly data: Uint8Array
	readonly destination: bigint
	readonly transactionValue: bigint
	readonly chainId: bigint
	readonly connectedAccount: bigint | undefined
	readonly walletRequestTimeoutMs: number | undefined
}) {
	const [showParsed, setShowParsed] = useState(true)
	const { decoded, metadata } = useTransactionDataMetadata(destination, data, chainId, walletRequestTimeoutMs)
	const raw = rawTransactionData(data)

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
							{ metadata.status === 'failed' ? <div class = 'data-parse-error'>{ metadata.message }</div> : <></> }
							{ decoded.call.signature === 'deposit()' ? <dl><dt>Amount</dt><dd>{ formatTokenAmount(transactionValue, 18, getAddressLabel(destination, chainId) ?? 'WETH') }</dd></dl> : <></> }
							{ decoded.call.ambiguity !== undefined ? <span class = 'muted'>Identifying transfer…</span> : decodedArguments(decoded.call).length === 0 ? <></> : Array.isArray(decoded.call.arguments)
								? <div class = 'decoded-nested'>{ decoded.call.arguments.map((value, index) => isRecord(value) ? <dl key = { index }>{ renderFields(value, `argument:${ index }`) }</dl> : <div key = { index }>{ displayDecodedValue(value, chainId, connectedAccount) }</div>) }</div>
								: <dl>{ renderFields(decoded.call.arguments as Readonly<Record<string, unknown>>, 'argument') }</dl> }
						</div>
			: <code class = 'raw-data'>{ raw }</code> }
	</div>
}

import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { getNativeAssetSymbol } from '../assetFormatting.js'
import { getAddressLabel, identifiedAddress } from '../addressLabels.js'
import { decodedArguments, rawTransactionData } from '../transactionDecoder.js'
import { formatDecodedValue, formatTokenAmount } from '../transactionFormatting.js'
import { amountTokenForArgument, argumentLabel, decodedAddress, isDecodedRecord, resolveTokenAddress, tokenMetadataKey, transactionNeedsErc721Resolution, transactionValuePresentation, type AmountTokenReference } from '../transactionSemantics.js'
import type { TransactionDataMetadataResult } from '../useTransactionDataMetadata.js'

function displayDecodedValue(value: unknown, chainId: bigint, connectedAccount: bigint | undefined): string {
	const address = decodedAddress(value)
	if (address !== undefined) return identifiedAddress(address, chainId, connectedAccount)
	if (Array.isArray(value)) return value.map((entry) => displayDecodedValue(entry, chainId, connectedAccount)).join(', ')
	if (value === undefined) return 'No arguments'
	return formatDecodedValue(value)
}

export function TransactionDataDetails({ data, destination, transactionValue, chainId, connectedAccount, result }: {
	readonly data: Uint8Array
	readonly destination: bigint
	readonly transactionValue: bigint
	readonly chainId: bigint
	readonly connectedAccount: bigint | undefined
	readonly result: TransactionDataMetadataResult
}) {
	const [showParsed, setShowParsed] = useState(true)
	const { decoded, metadata } = result
	const raw = rawTransactionData(data)
	const callValuePresentation = decoded.status === 'decoded' ? transactionValuePresentation(decoded.call) : undefined

	const renderAmount = (value: bigint, reference: AmountTokenReference) => {
		const address = resolveTokenAddress(reference, destination, metadata.status === 'ready' ? metadata.vaultAsset : undefined)
		if (address === 'native') return formatTokenAmount(value, 18, getNativeAssetSymbol(chainId))
		if (address === 'liquidity') return formatTokenAmount(value, 18, 'LP tokens')
		if (metadata.status === 'failed') return <span class = 'data-parse-error'>{ metadata.message }</span>
		if (metadata.status !== 'ready') return 'Reading token decimals…'
		if (reference === 'vaultAsset' && metadata.vaultAssetError !== undefined) return <span class = 'data-parse-error'>{ metadata.vaultAssetError }</span>
		if (address === undefined) return <span class = 'data-parse-error'>Token decimals unavailable.</span>
		const token = metadata.tokens[tokenMetadataKey(address)]
		if (token?.status === 'available') return formatTokenAmount(value, token.decimals, getAddressLabel(address, chainId))
		if (token?.status === 'nft') return value.toString()
		return <span class = 'data-parse-error'>{ token?.message ?? 'Token decimals unavailable.' }</span>
	}
	function renderValue(name: string, value: unknown, scope: Readonly<Record<string, unknown>>, key: string): ComponentChildren {
		const address = decodedAddress(value)
		if (address !== undefined) return identifiedAddress(address, chainId, connectedAccount)
		const reference = typeof value === 'bigint' && decoded.status === 'decoded' ? amountTokenForArgument(decoded.call, name, scope) : undefined
		if (typeof value === 'bigint' && reference !== undefined) return renderAmount(value, reference)
		if (isDecodedRecord(value)) return <dl class = 'decoded-nested'>{ renderFields(value, key) }</dl>
		if (Array.isArray(value) && value.some((entry) => isDecodedRecord(entry) || Array.isArray(entry))) return <div class = 'decoded-nested'>{ value.map((entry, index) => isDecodedRecord(entry)
			? <dl key = { `${ key }:${ index }` }>{ renderFields(entry, `${ key }:${ index }`) }</dl>
			: <div key = { `${ key }:${ index }` }>{ displayDecodedValue(entry, chainId, connectedAccount) }</div>) }</div>
		return displayDecodedValue(value, chainId, connectedAccount)
	}
	function renderFields(scope: Readonly<Record<string, unknown>>, prefix: string): ComponentChildren {
		return Object.entries(scope).map(([name, value]) => {
			const reference = typeof value === 'bigint' && decoded.status === 'decoded' ? amountTokenForArgument(decoded.call, name, scope) : undefined
			const address = reference === undefined ? undefined : resolveTokenAddress(reference, destination, metadata.status === 'ready' ? metadata.vaultAsset : undefined)
			const nft = typeof address === 'bigint' && metadata.status === 'ready' && metadata.tokens[tokenMetadataKey(address)]?.status === 'nft'
			return <><dt key = { `${ prefix }:${ name }:label` }>{ argumentLabel(name.replace(/^_/u, ''), nft) }</dt><dd key = { `${ prefix }:${ name }` } class = { decodedAddress(value) === undefined ? undefined : 'address' }>{ renderValue(name, value, scope, `${ prefix }:${ name }`) }</dd></>
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
							{ callValuePresentation === undefined ? <></> : <dl><dt>{ callValuePresentation.label }</dt><dd>{ formatTokenAmount(transactionValue, callValuePresentation.decimals, getAddressLabel(destination, chainId) ?? callValuePresentation.fallbackSymbol) }</dd></dl> }
							{ transactionNeedsErc721Resolution(decoded) ? <span class = 'muted'>Identifying transfer…</span> : decodedArguments(decoded.call).length === 0 ? <></> : Array.isArray(decoded.call.arguments)
				? <div class = 'decoded-nested'>{ decoded.call.arguments.map((value, index) => isDecodedRecord(value) ? <dl key = { index }>{ renderFields(value, `argument:${ index }`) }</dl> : <div key = { index }>{ displayDecodedValue(value, chainId, connectedAccount) }</div>) }</div>
								: <dl>{ renderFields(decoded.call.arguments as Readonly<Record<string, unknown>>, 'argument') }</dl> }
						</div>
			: <code class = 'raw-data'>{ raw }</code> }
	</div>
}

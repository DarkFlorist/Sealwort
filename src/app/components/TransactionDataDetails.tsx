import { useEffect, useState } from 'preact/hooks'
import { getAddressLabel, identifiedAddress } from '../addressLabels.js'
import { getSafeReadProvider } from '../readProvider.js'
import { decodedArguments, decodeTransactionData, formatDecodedValue, formatTokenAmount, hasErc721AmountAmbiguity, isFungibleAmountArgument, rawTransactionData, readIsErc721, readTokenDecimals, tokenAddressForAmount } from '../transactionData.js'

type DecimalsState =
	| { readonly status: 'idle' | 'loading' }
	| { readonly status: 'available', readonly decimals: number }
	| { readonly status: 'nft' }
	| { readonly status: 'error', readonly message: string }

function argumentAddress(value: unknown) {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value) ? BigInt(value) : undefined
}

const ARGUMENT_LABELS: Readonly<Record<string, string>> = {
	amount: 'Amount',
	approved: 'Approved address',
	data: 'Data',
	feeAddress: 'Fee recipient',
	feeAmount: 'Fee amount',
	from: 'Sender',
	id: 'Token ID',
	operator: 'Operator',
	paymentReference: 'Payment reference',
	spender: 'Spender',
	to: 'Recipient',
	tokenAddress: 'Token',
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
	return formatDecodedValue(value)
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
	const tokenSource = decoded.status === 'decoded' ? tokenAddressForAmount(decoded.call) : undefined
	const tokenAddress = tokenSource === 'destination' ? destination : tokenSource
	const [decimals, setDecimals] = useState<DecimalsState>({ status: 'idle' })

	useEffect(() => {
		if (tokenAddress === undefined || decoded.status !== 'decoded') {
			setDecimals({ status: 'idle' })
			return
		}
		let current = true
		setDecimals({ status: 'loading' })
		void getSafeReadProvider(chainId, window.ethereum).then(async ({ provider }) => {
			try {
				return { status: 'available', decimals: await readTokenDecimals(provider, tokenAddress) } as const
			} catch {
				if (hasErc721AmountAmbiguity(decoded.call) && await readIsErc721(provider, destination)) return { status: 'nft' } as const
				return { status: 'error', message: 'Could not read this token’s decimals.' } as const
			}
		}).then((nextState) => {
			if (current) setDecimals(nextState)
		}).catch(() => {
			if (current) setDecimals({ status: 'error', message: 'Could not read this token’s decimals.' })
		})
		return () => { current = false }
	}, [chainId, destination, tokenAddress, decoded.status === 'decoded' ? decoded.call.signature : decoded.status])

	const raw = rawTransactionData(data)
	const tokenSymbol = tokenAddress === undefined ? undefined : getAddressLabel(tokenAddress, chainId)
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
							{ decoded.call.signature === 'deposit()' ? <dl><dt>Amount</dt><dd>{ formatTokenAmount(transactionValue, 18, tokenSymbol ?? 'WETH') }</dd></dl> : <></> }
							{ decodedArguments(decoded.call).length === 0 ? <></> : <dl>{ decodedArguments(decoded.call).map((argument) => {
								const address = argumentAddress(argument.value)
								const amount = isFungibleAmountArgument(decoded.call, argument.name) && typeof argument.value === 'bigint'
								return <><dt key = { `${ argument.name }:label` }>{ argumentLabel(decoded.call.signature, argument.name, decimals.status === 'nft') }</dt><dd key = { argument.name } class = { address === undefined ? undefined : 'address' }>{ address !== undefined
									? identifiedAddress(address, chainId, connectedAccount)
									: amount
										? decimals.status === 'available'
											? formatTokenAmount(argument.value as bigint, decimals.decimals, tokenSymbol)
											: decimals.status === 'nft'
												? displayDecodedValue(argument.value, chainId, connectedAccount)
											: decimals.status === 'loading'
												? 'Reading token decimals…'
												: <span class = 'data-parse-error'>{ decimals.status === 'error' ? decimals.message : 'Token decimals unavailable.' }</span>
										: displayDecodedValue(argument.value, chainId, connectedAccount) }</dd></>
							}) }</dl> }
						</div>
			: <code class = 'raw-data'>{ raw }</code> }
	</div>
}

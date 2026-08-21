import { NATIVE_TOKEN_SENTINEL } from './chainConfiguration.js'
import { bytesToHex } from './ethereum.js'
import type { DecodedTransactionData, TransactionDataDecodeResult } from './transactionDecoder.js'

export type AmountTokenReference = 'destination' | 'liquidity' | 'native' | 'vaultAsset' | bigint
type TokenSource = AmountTokenReference | { readonly field: string } | { readonly path: 'first' | 'last' }
type AmountRules = Readonly<Record<string, TokenSource>>
type FunctionRule = {
	readonly amounts?: AmountRules
	readonly ambiguity?: {
		readonly erc721Arguments: readonly string[]
		readonly fallbackArguments: readonly string[]
	}
	readonly transactionValue?: { readonly label: string, readonly decimals: number, readonly token: 'destination', readonly fallbackSymbol: string }
}

const field = (name: string): TokenSource => ({ field: name })
const path = (end: 'first' | 'last'): TokenSource => ({ path: end })

const FUNCTION_RULES: Record<string, FunctionRule> = {}

function register(signatures: readonly string[], rules: AmountRules) {
	for (const signature of signatures) FUNCTION_RULES[signature] = { ...FUNCTION_RULES[signature], amounts: rules }
}

function registerFunction(signature: string, rule: FunctionRule) {
	FUNCTION_RULES[signature] = { ...FUNCTION_RULES[signature], ...rule }
}

register(['transfer(address,uint256)', 'approve(address,uint256)', 'transferFrom(address,address,uint256)', 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'], { value: 'destination' })
register(['withdraw(uint256)'], { wad: 'destination' })
register(['transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)'], { amount: field('tokenAddress'), feeAmount: field('tokenAddress') })
registerFunction('safeTransferFrom(address,address,uint256)', {
	amounts: { amount: field('tokenAddress') },
	ambiguity: {
		erc721Arguments: ['from', 'to', 'tokenId'],
		fallbackArguments: ['_tokenAddress', '_to', '_amount'],
	},
})
registerFunction('deposit()', { transactionValue: { label: 'Amount', decimals: 18, token: 'destination', fallbackSymbol: 'WETH' } })
register(['deposit(uint256,address)', 'deposit(uint256,address,address)', 'withdraw(uint256,address,address)', 'requestDeposit(uint256,address,address)'], { assets: 'vaultAsset' })
register(['mint(uint256,address)', 'mint(uint256,address,address)', 'redeem(uint256,address,address)', 'requestRedeem(uint256,address,address)'], { shares: 'destination' })
register(['swap(string,address,uint256,bytes)'], { amount: field('tokenFrom') })
register([
	'trade(address,uint256,address,address,uint256,uint256,address)',
	'tradeWithHint(address,uint256,address,address,uint256,uint256,address,bytes)',
	'tradeWithHintAndFee(address,uint256,address,address,uint256,uint256,address,uint256,bytes)',
], { srcAmount: field('src'), srcQty: field('src'), maxDestAmount: field('dest') })
register(['addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)'], {
	amountADesired: field('tokenA'), amountAMin: field('tokenA'), amountBDesired: field('tokenB'), amountBMin: field('tokenB'),
})
register(['addLiquidityETH(address,uint256,uint256,uint256,address,uint256)'], { amountTokenDesired: field('token'), amountTokenMin: field('token'), amountETHMin: 'native' })
register(['removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)', 'removeLiquidityWithPermit(address,address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)'], {
	liquidity: 'liquidity', amountAMin: field('tokenA'), amountBMin: field('tokenB'),
})
register([
	'removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)',
	'removeLiquidityETHSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256)',
	'removeLiquidityETHWithPermit(address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)',
	'removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address,uint256,uint256,uint256,address,uint256,bool,uint8,bytes32,bytes32)',
], { liquidity: 'liquidity', amountTokenMin: field('token'), amountETHMin: 'native' })
register(['swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'], { amountIn: path('first'), amountOutMin: path('last') })
register(['swapTokensForExactTokens(uint256,uint256,address[],address,uint256)'], { amountOut: path('last'), amountInMax: path('first') })
register(['swapExactTokensForETH(uint256,uint256,address[],address,uint256)', 'swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'], { amountIn: path('first'), amountOutMin: 'native' })
register(['swapTokensForExactETH(uint256,uint256,address[],address,uint256)'], { amountOut: 'native', amountInMax: path('first') })
register(['swapExactETHForTokens(uint256,address[],address,uint256)', 'swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)'], { amountOutMin: path('last') })
register(['swapETHForExactTokens(uint256,address[],address,uint256)'], { amountOut: path('last') })
register(['selfPermit(address,uint256,uint256,uint8,bytes32,bytes32)', 'selfPermitIfNecessary(address,uint256,uint256,uint8,bytes32,bytes32)'], { value: field('token') })
register(['sweepToken(address,uint256,address)', 'sweepTokenWithFee(address,uint256,address,uint256,address)'], { amountMinimum: field('token') })
register(['unwrapWETH9(uint256,address)', 'unwrapWETH9WithFee(uint256,address,uint256,address)'], { amountMinimum: 'native' })
register(['exactInput((bytes,address,uint256,uint256,uint256))'], { amountIn: path('first'), amountOutMinimum: path('last') })
register(['exactOutput((bytes,address,uint256,uint256,uint256))'], { amountOut: path('first'), amountInMaximum: path('last') })
register(['exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))'], { amountIn: field('tokenIn'), amountOutMinimum: field('tokenOut') })
register(['exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))'], { amountOut: field('tokenOut'), amountInMaximum: field('tokenIn') })

const NESTED_SCOPE_AMOUNT_RULES: readonly { readonly fields: readonly string[], readonly rules: AmountRules }[] = [
	{ fields: ['tokenIn', 'tokenOut', 'amountIn', 'amountOutMinimum'], rules: { amountIn: field('tokenIn'), amountOutMinimum: field('tokenOut') } },
	{ fields: ['tokenIn', 'tokenOut', 'amountOut', 'amountInMaximum'], rules: { amountOut: field('tokenOut'), amountInMaximum: field('tokenIn') } },
	{ fields: ['path', 'amountIn', 'amountOutMinimum'], rules: { amountIn: path('first'), amountOutMinimum: path('last') } },
	{ fields: ['path', 'amountOut', 'amountInMaximum'], rules: { amountOut: path('first'), amountInMaximum: path('last') } },
]

export const ARGUMENT_LABELS: Readonly<Record<string, string>> = {
	amount: 'Amount', amountADesired: 'Token A desired', amountAMin: 'Token A minimum', amountBDesired: 'Token B desired', amountBMin: 'Token B minimum',
	amountIn: 'Amount in', amountInMax: 'Maximum amount in', amountInMaximum: 'Maximum amount in', amountOut: 'Amount out', amountOutMin: 'Minimum amount out', amountOutMinimum: 'Minimum amount out', amountMinimum: 'Minimum amount',
	assets: 'Assets', approved: 'Approved address', aggregatorId: 'Aggregator', controller: 'Controller', data: 'Data', deadline: 'Deadline', dest: 'Destination token', destAddress: 'Recipient', fee: 'Pool fee', feeAddress: 'Fee recipient', feeAmount: 'Fee amount', feeBips: 'Fee (bps)', feeRecipient: 'Fee recipient',
	from: 'Sender', id: 'Token ID', liquidity: 'Liquidity', maxDestAmount: 'Maximum destination amount', minConversionRate: 'Minimum conversion rate', operator: 'Operator', owner: 'Owner', path: 'Swap path', paymentReference: 'Payment reference', platformWallet: 'Platform wallet', recipient: 'Recipient', receiver: 'Recipient', shares: 'Shares', spender: 'Spender', sqrtPriceLimitX96: 'Price limit', src: 'Source token', srcAmount: 'Source amount', srcQty: 'Source amount',
	to: 'Recipient', token: 'Token', tokenA: 'Token A', tokenB: 'Token B', tokenAddress: 'Token', tokenFrom: 'Source token', tokenIn: 'Input token', tokenOut: 'Output token', tokenId: 'Token ID', value: 'Amount', wad: 'Amount',
}

export function isDecodedRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

export function decodedAddress(value: unknown) {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value) ? BigInt(value) : undefined
}

function fieldToken(scope: Readonly<Record<string, unknown>>, name: string) {
	const address = decodedAddress(scope[name] ?? scope[`_${ name }`])
	if (address === undefined) return undefined
	return address === NATIVE_TOKEN_SENTINEL ? 'native' as const : address
}

function pathToken(scope: Readonly<Record<string, unknown>>, end: 'first' | 'last') {
	const value = scope.path
	if (Array.isArray(value)) return decodedAddress(value[end === 'first' ? 0 : value.length - 1])
	if (!(value instanceof Uint8Array) || value.length < 43 || (value.length - 20) % 23 !== 0) return undefined
	const offset = end === 'first' ? 0 : value.length - 20
	return BigInt(bytesToHex(value.slice(offset, offset + 20)))
}

function rulesForScope(call: DecodedTransactionData, scope: Readonly<Record<string, unknown>>) {
	const direct = FUNCTION_RULES[call.signature]?.amounts
	if (direct !== undefined) return direct
	return NESTED_SCOPE_AMOUNT_RULES.find(({ fields }) => fields.every((name) => Object.hasOwn(scope, name)))?.rules
}

function resolveSource(source: TokenSource, scope: Readonly<Record<string, unknown>>): AmountTokenReference | undefined {
	if (typeof source === 'bigint' || typeof source === 'string') return source
	return 'field' in source ? fieldToken(scope, source.field) : pathToken(scope, source.path)
}

export function amountTokenForArgument(call: DecodedTransactionData, argumentName: string, scope: Readonly<Record<string, unknown>>): AmountTokenReference | undefined {
	const rule = rulesForScope(call, scope)?.[argumentName.replace(/^_/u, '')]
	return rule === undefined ? undefined : resolveSource(rule, scope)
}

export function amountTokenReferences(call: DecodedTransactionData) {
	const references: AmountTokenReference[] = []
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry)
			return
		}
		if (!isDecodedRecord(value)) return
		for (const [name, entry] of Object.entries(value)) {
			if (typeof entry === 'bigint') {
				const reference = amountTokenForArgument(call, name, value)
				if (reference !== undefined) references.push(reference)
			}
			visit(entry)
		}
	}
	visit(call.arguments)
	return references.filter((reference, index) => references.findIndex((candidate) => candidate === reference) === index)
}

export function argumentLabel(name: string, nft: boolean) {
	if (nft && (name === 'value' || name === 'amount')) return 'Token ID'
	return ARGUMENT_LABELS[name] ?? name
}

function hasArgumentNames(call: DecodedTransactionData, names: readonly string[]) {
	const argumentsRecord = call.arguments
	if (!isDecodedRecord(argumentsRecord)) return false
	return names.every((name) => Object.hasOwn(argumentsRecord, name))
}

export function transactionNeedsErc721Resolution(decoded: TransactionDataDecodeResult) {
	if (decoded.status !== 'decoded') return false
	const ambiguity = FUNCTION_RULES[decoded.call.signature]?.ambiguity
	return ambiguity !== undefined
		&& decoded.candidates.some((call) => hasArgumentNames(call, ambiguity.erc721Arguments))
		&& decoded.candidates.some((call) => hasArgumentNames(call, ambiguity.fallbackArguments))
}

export function resolveTransactionInterpretation(decoded: TransactionDataDecodeResult, erc721: boolean): TransactionDataDecodeResult {
	if (decoded.status !== 'decoded') return decoded
	const ambiguity = FUNCTION_RULES[decoded.call.signature]?.ambiguity
	if (ambiguity === undefined) return decoded
	const argumentNames = erc721 ? ambiguity.erc721Arguments : ambiguity.fallbackArguments
	const candidate = decoded.candidates.find((call) => hasArgumentNames(call, argumentNames))
	if (candidate !== undefined) return { ...decoded, call: candidate, candidates: [candidate] }
	const values = Array.isArray(decoded.call.arguments) ? decoded.call.arguments : Object.values(decoded.call.arguments ?? {})
	const call = {
		...decoded.call,
		arguments: Object.fromEntries(argumentNames.map((name, index) => [name, values[index]])),
	}
	return {
		...decoded,
		call,
		candidates: [call],
	}
}

export function transactionValuePresentation(call: DecodedTransactionData) {
	return FUNCTION_RULES[call.signature]?.transactionValue
}

export function tokenMetadataKey(address: bigint) {
	return address.toString(16)
}

export function resolveTokenAddress(reference: AmountTokenReference, destination: bigint, vaultAsset: bigint | undefined) {
	if (reference === 'liquidity' || reference === 'native') return reference
	if (reference === 'destination') return destination
	if (reference === 'vaultAsset') return vaultAsset
	return reference
}

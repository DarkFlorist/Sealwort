import { ERC20, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { abiFunctionSignatures } from './abiSignatures.js'
import { CUSTOM_PAYMENT_ABI } from './abis/customPayment.js'
import { ERC2612_ABI } from './abis/erc2612.js'
import { ERC4626_ABI } from './abis/erc4626.js'
import { ERC7540_ABI } from './abis/erc7540.js'
import { METAMASK_SWAP_ROUTER_ABI } from './abis/metaMaskSwapRouter.js'
import { KYBER_NETWORK_PROXY_ABI, UNISWAP_V2_ROUTER_ABI, UNISWAP_V3_ROUTER_ABI } from './abis/microDecoder.js'
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

function register(abi: ContractABI | undefined, names: readonly string[], rules: AmountRules) {
	if (abi === undefined) return
	for (const signature of abiFunctionSignatures(abi, names)) FUNCTION_RULES[signature] = { ...FUNCTION_RULES[signature], amounts: rules }
}

function registerFunction(abi: ContractABI, name: string, rule: FunctionRule) {
	for (const signature of abiFunctionSignatures(abi, [name])) FUNCTION_RULES[signature] = { ...FUNCTION_RULES[signature], ...rule }
}

register(ERC20, ['transfer', 'approve', 'transferFrom'], { value: 'destination' })
register(ERC2612_ABI, ['permit'], { value: 'destination' })
register(WETH, ['withdraw'], { wad: 'destination' })
register(CUSTOM_PAYMENT_ABI, ['transferFromWithReferenceAndFee'], { amount: field('tokenAddress'), feeAmount: field('tokenAddress') })
registerFunction(CUSTOM_PAYMENT_ABI, 'safeTransferFrom', {
	amounts: { amount: field('tokenAddress') },
	ambiguity: {
		erc721Arguments: ['from', 'to', 'tokenId'],
		fallbackArguments: ['_tokenAddress', '_to', '_amount'],
	},
})
registerFunction(WETH, 'deposit', { transactionValue: { label: 'Amount', decimals: 18, token: 'destination', fallbackSymbol: 'WETH' } })
register(ERC4626_ABI, ['deposit', 'withdraw'], { assets: 'vaultAsset' })
register(ERC7540_ABI, ['deposit', 'withdraw', 'requestDeposit'], { assets: 'vaultAsset' })
register(ERC4626_ABI, ['mint', 'redeem'], { shares: 'destination' })
register(ERC7540_ABI, ['mint', 'redeem', 'requestRedeem'], { shares: 'destination' })
register(METAMASK_SWAP_ROUTER_ABI, ['swap'], { amount: field('tokenFrom') })
register(KYBER_NETWORK_PROXY_ABI, ['trade', 'tradeWithHint', 'tradeWithHintAndFee'], { srcAmount: field('src'), srcQty: field('src'), maxDestAmount: field('dest') })
register(UNISWAP_V2_ROUTER_ABI, ['addLiquidity'], {
	amountADesired: field('tokenA'), amountAMin: field('tokenA'), amountBDesired: field('tokenB'), amountBMin: field('tokenB'),
})
register(UNISWAP_V2_ROUTER_ABI, ['addLiquidityETH'], { amountTokenDesired: field('token'), amountTokenMin: field('token'), amountETHMin: 'native' })
register(UNISWAP_V2_ROUTER_ABI, ['removeLiquidity', 'removeLiquidityWithPermit'], {
	liquidity: 'liquidity', amountAMin: field('tokenA'), amountBMin: field('tokenB'),
})
register(UNISWAP_V2_ROUTER_ABI, ['removeLiquidityETH', 'removeLiquidityETHSupportingFeeOnTransferTokens', 'removeLiquidityETHWithPermit', 'removeLiquidityETHWithPermitSupportingFeeOnTransferTokens'], { liquidity: 'liquidity', amountTokenMin: field('token'), amountETHMin: 'native' })
register(UNISWAP_V2_ROUTER_ABI, ['swapExactTokensForTokens', 'swapExactTokensForTokensSupportingFeeOnTransferTokens'], { amountIn: path('first'), amountOutMin: path('last') })
register(UNISWAP_V2_ROUTER_ABI, ['swapTokensForExactTokens'], { amountOut: path('last'), amountInMax: path('first') })
register(UNISWAP_V2_ROUTER_ABI, ['swapExactTokensForETH', 'swapExactTokensForETHSupportingFeeOnTransferTokens'], { amountIn: path('first'), amountOutMin: 'native' })
register(UNISWAP_V2_ROUTER_ABI, ['swapTokensForExactETH'], { amountOut: 'native', amountInMax: path('first') })
register(UNISWAP_V2_ROUTER_ABI, ['swapExactETHForTokens', 'swapExactETHForTokensSupportingFeeOnTransferTokens'], { amountOutMin: path('last') })
register(UNISWAP_V2_ROUTER_ABI, ['swapETHForExactTokens'], { amountOut: path('last') })
register(UNISWAP_V3_ROUTER_ABI, ['selfPermit', 'selfPermitIfNecessary'], { value: field('token') })
register(UNISWAP_V3_ROUTER_ABI, ['sweepToken', 'sweepTokenWithFee'], { amountMinimum: field('token') })
register(UNISWAP_V3_ROUTER_ABI, ['unwrapWETH9', 'unwrapWETH9WithFee'], { amountMinimum: 'native' })
register(UNISWAP_V3_ROUTER_ABI, ['exactInput'], { amountIn: path('first'), amountOutMinimum: path('last') })
register(UNISWAP_V3_ROUTER_ABI, ['exactOutput'], { amountOut: path('first'), amountInMaximum: path('last') })
register(UNISWAP_V3_ROUTER_ABI, ['exactInputSingle'], { amountIn: field('tokenIn'), amountOutMinimum: field('tokenOut') })
register(UNISWAP_V3_ROUTER_ABI, ['exactOutputSingle'], { amountOut: field('tokenOut'), amountInMaximum: field('tokenIn') })

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

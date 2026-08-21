import { abiFunctionSignatures } from './abiSignatures.js'
import { NATIVE_TOKEN_SENTINEL } from './chainConfiguration.js'
import { bytesToHex } from './ethereum.js'
import type { DecodedTransactionData, TransactionDataDecodeResult } from './transactionDecoder.js'
import { TRANSACTION_DEFINITIONS, type AmountTokenReference, type FunctionRule, type TokenSource } from './transactionDefinitions.js'

export type { AmountTokenReference } from './transactionDefinitions.js'

const FUNCTION_RULES: Readonly<Record<string, FunctionRule>> = Object.fromEntries(TRANSACTION_DEFINITIONS.flatMap((definition) =>
	(definition.functions ?? []).flatMap(({ names, rule }) => abiFunctionSignatures(definition.abi, names).map((signature) => [signature, rule] as const)),
))

const NESTED_SCOPE_AMOUNT_RULES = TRANSACTION_DEFINITIONS.flatMap(({ nestedAmounts }) => nestedAmounts ?? [])

const ARGUMENT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
	amount: 'Amount', amountADesired: 'Token A desired', amountAMin: 'Token A minimum', amountBDesired: 'Token B desired', amountBMin: 'Token B minimum',
	amountIn: 'Amount in', amountInMax: 'Maximum amount in', amountInMaximum: 'Maximum amount in', amountOut: 'Amount out', amountOutMin: 'Minimum amount out', amountOutMinimum: 'Minimum amount out', amountMinimum: 'Minimum amount',
	assets: 'Assets', approved: 'Approved address', aggregatorId: 'Aggregator', controller: 'Controller', data: 'Data', deadline: 'Deadline', dest: 'Destination token', destAddress: 'Recipient', fee: 'Pool fee', feeAddress: 'Fee recipient', feeAmount: 'Fee amount', feeBips: 'Fee (bps)', feeRecipient: 'Fee recipient',
	from: 'Sender', id: 'Token ID', liquidity: 'Liquidity', maxDestAmount: 'Maximum destination amount', minConversionRate: 'Minimum conversion rate', operator: 'Operator', owner: 'Owner', path: 'Swap path', paymentReference: 'Payment reference', platformWallet: 'Platform wallet', recipient: 'Recipient', receiver: 'Recipient', shares: 'Shares', spender: 'Spender', sqrtPriceLimitX96: 'Price limit', src: 'Source token', srcAmount: 'Source amount', srcQty: 'Source amount',
	to: 'Recipient', token: 'Token', tokenA: 'Token A', tokenB: 'Token B', tokenAddress: 'Token', tokenFrom: 'Source token', tokenIn: 'Input token', tokenOut: 'Output token', tokenId: 'Token ID', value: 'Amount', wad: 'Amount',
}

function humanizeArgumentName(name: string) {
	const words = name.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2').toLowerCase()
	return words.length === 0 ? 'Argument' : `${ words[0]!.toUpperCase() }${ words.slice(1) }`
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
	return ARGUMENT_LABEL_OVERRIDES[name] ?? humanizeArgumentName(name)
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

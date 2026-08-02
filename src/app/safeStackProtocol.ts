import * as funtypes from 'funtypes'

export const SAFE_STACK_EXPORT_NAME = 'Interceptor Safe Stack'
export const SAFE_STACK_FORMAT_VERSION = '1.0.0'
export const SUPPORTED_SAFE_STACK_FORMAT_VERSIONS = [SAFE_STACK_FORMAT_VERSION] as const

type Parser<T> = funtypes.ParsedValue<funtypes.String, T>['config']

const hexBigIntParser = (digits: number | undefined, label: string): Parser<bigint> => ({
	parse(value) {
		const pattern = digits === undefined ? /^0x[0-9a-fA-F]{1,64}$/u : new RegExp(`^0x[0-9a-fA-F]{${ digits }}$`, 'u')
		if (!pattern.test(value)) return { success: false, message: `${ value } is not a valid ${ label }.` }
		return { success: true, value: BigInt(value) }
	},
	serialize(value) {
		if (typeof value !== 'bigint' || value < 0n) return { success: false, message: `${ label } must be a non-negative bigint.` }
		if (digits !== undefined && value >= 16n ** BigInt(digits)) return { success: false, message: `${ label } is too large.` }
		const encoded = value.toString(16)
		return { success: true, value: `0x${ digits === undefined ? encoded : encoded.padStart(digits, '0') }` }
	},
})

const decimalBigIntParser: Parser<bigint> = {
	parse(value) {
		if (!/^[0-9]+$/u.test(value)) return { success: false, message: `${ value } is not a decimal integer.` }
		return { success: true, value: BigInt(value) }
	},
	serialize(value) {
		if (typeof value !== 'bigint' || value < 0n) return { success: false, message: 'Safe transaction integer must be a non-negative bigint.' }
		return { success: true, value: value.toString() }
	},
}

const bytesParser: Parser<Uint8Array> = {
	parse(value) {
		if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) return { success: false, message: `${ value } is not a byte-aligned hex string.` }
		return { success: true, value: Uint8Array.from(value.slice(2).match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)) }
	},
	serialize(value) {
		if (!(value instanceof Uint8Array)) return { success: false, message: 'Safe transaction data must be a Uint8Array.' }
		return { success: true, value: `0x${ Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('') }` }
	},
}

const timestampParser: Parser<Date> = {
	parse(value) {
		if (!/^0x[0-9a-fA-F]+$/u.test(value)) return { success: false, message: `${ value } is not a hexadecimal timestamp.` }
		const milliseconds = BigInt(value) * 1000n
		if (milliseconds > BigInt(8_640_000_000_000_000)) return { success: false, message: `${ value } is outside the supported date range.` }
		const date = new Date(Number(milliseconds))
		if (Number.isNaN(date.valueOf())) return { success: false, message: `${ value } is not a valid timestamp.` }
		return { success: true, value: date }
	},
	serialize(value) {
		if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return { success: false, message: 'Safe transaction timestamp must be a valid Date.' }
		return { success: true, value: `0x${ Math.floor(value.valueOf() / 1000).toString(16) }` }
	},
}

const EthereumQuantity = funtypes.String.withParser(hexBigIntParser(undefined, 'Ethereum quantity'))
export const EthereumAddress = funtypes.String.withParser(hexBigIntParser(40, 'Ethereum address'))
const EthereumBytes32 = funtypes.String.withParser(hexBigIntParser(64, '32-byte value'))
const EthereumData = funtypes.String.withParser(bytesParser)
const EthereumTimestamp = funtypes.String.withParser(timestampParser)
const DecimalBigInt = funtypes.String.withParser(decimalBigIntParser)

const SafeTxFields = funtypes.ReadonlyTuple(
	funtypes.ReadonlyObject({ name: funtypes.Literal('to'), type: funtypes.Literal('address') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('value'), type: funtypes.Literal('uint256') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('data'), type: funtypes.Literal('bytes') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('operation'), type: funtypes.Literal('uint8') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('safeTxGas'), type: funtypes.Literal('uint256') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('baseGas'), type: funtypes.Literal('uint256') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('gasPrice'), type: funtypes.Literal('uint256') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('gasToken'), type: funtypes.Literal('address') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('refundReceiver'), type: funtypes.Literal('address') }),
	funtypes.ReadonlyObject({ name: funtypes.Literal('nonce'), type: funtypes.Literal('uint256') }),
)

export type SafeTx = funtypes.Static<typeof SafeTx>
export const SafeTx = funtypes.ReadonlyObject({
	types: funtypes.ReadonlyObject({
		SafeTx: SafeTxFields,
		EIP712Domain: funtypes.ReadonlyTuple(
			funtypes.Partial({ name: funtypes.Literal('chainId'), type: funtypes.Literal('uint256') }),
			funtypes.ReadonlyObject({ name: funtypes.Literal('verifyingContract'), type: funtypes.Literal('address') }),
		),
	}),
	primaryType: funtypes.Literal('SafeTx'),
	domain: funtypes.Intersect(
		funtypes.Partial({ chainId: funtypes.Union(EthereumQuantity, DecimalBigInt) }),
		funtypes.ReadonlyObject({ verifyingContract: EthereumAddress }),
	),
	message: funtypes.ReadonlyObject({
		to: EthereumAddress,
		value: DecimalBigInt,
		data: EthereumData,
		operation: DecimalBigInt,
		safeTxGas: DecimalBigInt,
		baseGas: DecimalBigInt,
		gasPrice: DecimalBigInt,
		gasToken: EthereumAddress,
		refundReceiver: EthereumAddress,
		nonce: DecimalBigInt,
	}),
})

export type SafeOwnerSignature = funtypes.Static<typeof SafeOwnerSignature>
export const SafeOwnerSignature = funtypes.ReadonlyObject({
	signer: EthereumAddress,
	signature: funtypes.String,
})

export type SafeStackTransaction = funtypes.Static<typeof SafeStackTransaction>
export const SafeStackTransaction = funtypes.ReadonlyObject({
	safeTx: SafeTx,
	safeTxHash: EthereumBytes32,
	created: EthereumTimestamp,
	websiteOrigin: funtypes.String,
	transactionIdentifier: EthereumQuantity,
	signatures: funtypes.ReadonlyArray(SafeOwnerSignature),
})

export type SafeTransactionStack = funtypes.Static<typeof SafeTransactionStack>
export const SafeTransactionStack = funtypes.ReadonlyObject({
	chainId: EthereumQuantity,
	safeAddress: EthereumAddress,
	safeVersion: funtypes.String,
	baseNonce: EthereumQuantity,
	threshold: EthereumQuantity,
	transactions: funtypes.ReadonlyArray(SafeStackTransaction),
})

export type SafeStackExport = funtypes.Static<typeof SafeStackExport>
export const SafeStackExport = funtypes.ReadonlyObject({
	name: funtypes.Literal(SAFE_STACK_EXPORT_NAME),
	version: funtypes.Literal(SAFE_STACK_FORMAT_VERSION),
	stacks: funtypes.ReadonlyArray(SafeTransactionStack),
})

import { Decoder, ERC1155, ERC20, ERC721, WETH, type SignatureInfo } from 'micro-eth-signer/advanced/abi.js'
import { formatTokenBalance } from './accountBalances.js'
import { addressString, bytesToHex, decodeSafeUint, ensureHex, type Hex } from './ethereum.js'
import type { InjectedProvider } from './safeStackValidation.js'

const CUSTOM_PAYMENT_ABI = [{
	type: 'function',
	name: 'transferFromWithReferenceAndFee',
	inputs: [
		{ name: '_tokenAddress', type: 'address' },
		{ name: '_to', type: 'address' },
		{ name: '_amount', type: 'uint256' },
		{ name: '_paymentReference', type: 'bytes' },
		{ name: '_feeAmount', type: 'uint256' },
		{ name: '_feeAddress', type: 'address' },
	],
}, {
	type: 'function',
	name: 'safeTransferFrom',
	inputs: [
		{ name: '_tokenAddress', type: 'address' },
		{ name: '_to', type: 'address' },
		{ name: '_amount', type: 'uint256' },
	],
}] as const

const DECODER_ADDRESSES = [
	'0xfffffffffffffffffffffffffffffffffffffff1',
	'0xfffffffffffffffffffffffffffffffffffffff2',
	'0xfffffffffffffffffffffffffffffffffffffff3',
	'0xfffffffffffffffffffffffffffffffffffffff4',
	'0xfffffffffffffffffffffffffffffffffffffff5',
] as const

function createTransactionDecoder() {
	const decoder = new Decoder()
	decoder.add(DECODER_ADDRESSES[0], ERC20)
	decoder.add(DECODER_ADDRESSES[1], ERC721)
	decoder.add(DECODER_ADDRESSES[2], ERC1155)
	decoder.add(DECODER_ADDRESSES[3], WETH)
	decoder.add(DECODER_ADDRESSES[4], CUSTOM_PAYMENT_ABI)
	return decoder
}

const transactionDecoder = createTransactionDecoder()

export type DecodedTransactionData = {
	readonly name: string
	readonly signature: string
	readonly arguments: Readonly<Record<string, unknown>> | readonly unknown[] | undefined
}

export type TransactionDataDecodeResult =
	| { readonly status: 'empty' }
	| { readonly status: 'unknown' }
	| { readonly status: 'error', readonly error: string }
	| { readonly status: 'decoded', readonly call: DecodedTransactionData }

function uniqueCandidates(decoded: SignatureInfo | readonly SignatureInfo[]) {
	const candidates = Array.isArray(decoded) ? decoded : [decoded]
	return candidates.filter((candidate, index) => candidates.findIndex(({ signature }) => signature === candidate.signature) === index)
}

export function decodeTransactionData(destination: bigint, data: Uint8Array): TransactionDataDecodeResult {
	if (data.length === 0) return { status: 'empty' }
	try {
		const decoded = transactionDecoder.decode(addressString(destination), data)
		if (decoded === undefined) return { status: 'unknown' }
		const candidates = uniqueCandidates(decoded)
		// The requested payment helper shares its selector with ERC-721's three-argument
		// safeTransferFrom. Prefer the helper's descriptive argument names; the four-
		// argument ERC-721 overload remains unambiguous.
		const call = candidates[0]?.signature === 'safeTransferFrom(address,address,uint256)'
			? (Array.isArray(decoded) ? [...decoded].reverse().find(({ signature }) => signature === 'safeTransferFrom(address,address,uint256)') : decoded)
			: candidates[0]
		if (call === undefined) return { status: 'unknown' }
		return {
			status: 'decoded',
			call: {
				name: call.name,
				signature: call.signature,
				arguments: call.value as Readonly<Record<string, unknown>> | readonly unknown[] | undefined,
			},
		}
	} catch (decodeError) {
		return { status: 'error', error: decodeError instanceof Error ? decodeError.message : 'Calldata is malformed.' }
	}
}

export function decodedArguments(call: DecodedTransactionData): readonly { readonly name: string, readonly value: unknown }[] {
	if (call.arguments === undefined) return []
	if (Array.isArray(call.arguments)) return call.arguments.map((value, index) => ({ name: `Argument ${ index + 1 }`, value }))
	return Object.entries(call.arguments).map(([name, value]) => ({ name: name.replace(/^_/u, '') || 'Argument', value }))
}

export function tokenAddressForAmount(call: DecodedTransactionData) {
	if (call.signature === 'transfer(address,uint256)' || call.signature === 'approve(address,uint256)' || call.signature === 'transferFrom(address,address,uint256)' || call.signature === 'withdraw(uint256)' || call.signature === 'deposit()') return 'destination' as const
	if (call.signature === 'transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)' || call.signature === 'safeTransferFrom(address,address,uint256)') {
		const first = decodedArguments(call)[0]?.value
		return typeof first === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(first) ? BigInt(first) : undefined
	}
	return undefined
}

export function isFungibleAmountArgument(call: DecodedTransactionData, argumentName: string) {
	const normalized = argumentName.toLowerCase()
	if (call.signature === 'deposit()') return false
	if (call.signature === 'withdraw(uint256)') return normalized === 'wad'
	if (call.signature === 'transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)') return normalized === 'amount' || normalized === 'feeamount'
	if (call.signature === 'safeTransferFrom(address,address,uint256)') return normalized === 'amount'
	if (call.signature === 'transfer(address,uint256)' || call.signature === 'approve(address,uint256)' || call.signature === 'transferFrom(address,address,uint256)') return normalized === 'value'
	return false
}

export function formatDecodedValue(value: unknown): string {
	if (typeof value === 'bigint') return value.toString()
	if (typeof value === 'boolean') return value ? 'Yes' : 'No'
	if (typeof value === 'string') return value
	if (value instanceof Uint8Array) return bytesToHex(value)
	if (Array.isArray(value)) return value.map(formatDecodedValue).join(', ')
	return String(value)
}

export function formatTokenAmount(value: bigint, decimals: number, symbol = 'tokens') {
	return `${ formatTokenBalance(value, decimals, Math.min(decimals, 12)) } ${ symbol }`
}

const DECIMALS_CALL = '0x313ce567'
const ERC721_INTERFACE_CALL = `0x01ffc9a7${ '80ac58cd'.padEnd(64, '0') }`

export async function readTokenDecimals(provider: InjectedProvider, tokenAddress: bigint) {
	const response = ensureHex(String(await provider.request({
		method: 'eth_call',
		params: [{ to: addressString(tokenAddress), data: DECIMALS_CALL }, 'latest'],
	})), 'Token decimals result')
	const decimals = decodeSafeUint(response, 'Token decimals')
	if (decimals > 255n) throw new Error('Token returned an invalid decimals value.')
	return Number(decimals)
}

export async function readIsErc721(provider: InjectedProvider, tokenAddress: bigint) {
	const response = ensureHex(String(await provider.request({
		method: 'eth_call',
		params: [{ to: addressString(tokenAddress), data: ERC721_INTERFACE_CALL }, 'latest'],
	})), 'ERC-721 interface result')
	return decodeSafeUint(response, 'ERC-721 interface') !== 0n
}

export function hasErc721AmountAmbiguity(call: DecodedTransactionData) {
	return call.signature === 'approve(address,uint256)'
		|| call.signature === 'transferFrom(address,address,uint256)'
		|| call.signature === 'safeTransferFrom(address,address,uint256)'
}

export function rawTransactionData(data: Uint8Array): Hex {
	return bytesToHex(data)
}

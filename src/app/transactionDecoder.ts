import { Decoder, type ContractABI, type SignatureInfo } from 'micro-eth-signer/advanced/abi.js'
import { transactionAbisForDestination } from './abis/transaction.js'
import { addressString, bytesToHex, type Hex } from './ethereum.js'

export type DecodedTransactionData = {
	readonly name: string
	readonly signature: string
	readonly arguments: Readonly<Record<string, unknown>> | readonly unknown[] | undefined
	readonly ambiguity?: 'erc721-or-token-helper'
}

export type TransactionDataDecodeResult =
	| { readonly status: 'empty' }
	| { readonly status: 'unknown' }
	| { readonly status: 'error', readonly error: string }
	| { readonly status: 'decoded', readonly call: DecodedTransactionData }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array)
}

function decodeWithAbi(destination: string, data: Uint8Array, abi: ContractABI) {
	const decoder = new Decoder()
	decoder.add(destination, abi)
	return decoder.decode(destination, data)
}

function decodeWithTransactionAbis(destination: bigint, data: Uint8Array) {
	const destinationAddress = addressString(destination)
	return transactionAbisForDestination(destinationAddress).flatMap((abi) => {
		const decoded = decodeWithAbi(destinationAddress, data, abi)
		return decoded === undefined ? [] : Array.isArray(decoded) ? decoded : [decoded]
	})
}

function uniqueCandidates(decoded: SignatureInfo | readonly SignatureInfo[]) {
	const candidates = Array.isArray(decoded) ? decoded : [decoded]
	return candidates.filter((candidate, index) => candidates.findIndex(({ signature }) => signature === candidate.signature) === index)
}

export function decodeTransactionData(destination: bigint, data: Uint8Array): TransactionDataDecodeResult {
	if (data.length === 0) return { status: 'empty' }
	try {
		const candidates = uniqueCandidates(decodeWithTransactionAbis(destination, data))
		const call = candidates[0]
		if (call === undefined) return { status: 'unknown' }
		if (call.signature === 'safeTransferFrom(address,address,uint256)') {
			const values = Array.isArray(call.value) ? call.value : Object.values(call.value ?? {})
			return {
				status: 'decoded',
				call: {
					name: call.name,
					signature: call.signature,
					arguments: { address1: values[0], recipient: values[1], value: values[2] },
					ambiguity: 'erc721-or-token-helper',
				},
			}
		}
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

export function resolveAmbiguousSafeTransfer(call: DecodedTransactionData, interpretation: 'erc721' | 'token-helper'): DecodedTransactionData {
	if (call.ambiguity !== 'erc721-or-token-helper' || !isRecord(call.arguments)) return call
	const { address1, recipient, value } = call.arguments
	return interpretation === 'erc721'
		? { name: call.name, signature: call.signature, arguments: { from: address1, to: recipient, tokenId: value } }
		: { name: call.name, signature: call.signature, arguments: { _tokenAddress: address1, _to: recipient, _amount: value } }
}

export function decodedArguments(call: DecodedTransactionData): readonly { readonly name: string, readonly value: unknown }[] {
	if (call.arguments === undefined) return []
	if (Array.isArray(call.arguments)) return call.arguments.map((value, index) => ({ name: `Argument ${ index + 1 }`, value }))
	return Object.entries(call.arguments).map(([name, value]) => ({ name: name.replace(/^_/u, '') || 'Argument', value }))
}

export function rawTransactionData(data: Uint8Array): Hex {
	return bytesToHex(data)
}

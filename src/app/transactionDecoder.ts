import { Decoder, type ContractABI, type SignatureInfo } from 'micro-eth-signer/advanced/abi.js'
import { addressString, bytesToHex, type Hex } from './ethereum.js'
import { transactionAbisForDestination } from './transactionRegistry.js'

export type DecodedTransactionData = {
	readonly name: string
	readonly signature: string
	readonly arguments: Readonly<Record<string, unknown>> | readonly unknown[] | undefined
	readonly nestedSignatures?: ReadonlyMap<object, string>
}

export type TransactionDataDecodeResult =
	| { readonly status: 'empty' }
	| { readonly status: 'unknown' }
	| { readonly status: 'error', readonly error: string }
	| { readonly status: 'decoded', readonly call: DecodedTransactionData, readonly candidates: readonly DecodedTransactionData[] }

function decodeWithAbi(destination: string, data: Uint8Array, abi: ContractABI) {
	const decoder = new Decoder()
	decoder.add(destination, abi)
	return decoder.decode(destination, data)
}

function decodeWithTransactionAbis(chainId: bigint, destination: bigint, data: Uint8Array) {
	const destinationAddress = addressString(destination)
	return transactionAbisForDestination(chainId, destinationAddress).flatMap((abi) => {
		const decoded = decodeWithAbi(destinationAddress, data, abi)
		return decoded === undefined ? [] : Array.isArray(decoded) ? decoded : [decoded]
	})
}

function candidateKey(candidate: SignatureInfo) {
	const argumentNames = Array.isArray(candidate.value) ? candidate.value.map((_value, index) => index.toString()) : Object.keys(candidate.value ?? {})
	return `${ candidate.signature }:${ argumentNames.join(',') }`
}

function uniqueCandidates(decoded: SignatureInfo | readonly SignatureInfo[]) {
	const candidates = Array.isArray(decoded) ? decoded : [decoded]
	return candidates.filter((candidate, index) => candidates.findIndex((other) => candidateKey(other) === candidateKey(candidate)) === index)
}

function splitTopLevelSignatures(value: string) {
	const signatures: string[] = []
	let depth = 0
	let start = 0
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index]
		if (character === '(') depth += 1
		else if (character === ')') depth -= 1
		else if (character === ',' && depth === 0) {
			signatures.push(value.slice(start, index).trim())
			start = index + 1
		}
	}
	const finalSignature = value.slice(start).trim()
	if (finalSignature.length > 0) signatures.push(finalSignature)
	return signatures
}

function collectNestedSignatures(signature: string, value: unknown, result: Map<object, string>) {
	if (!signature.startsWith('multicall(') || !signature.endsWith(')') || !Array.isArray(value)) return
	const signatures = splitTopLevelSignatures(signature.slice('multicall('.length, -1))
	for (const [index, nestedSignature] of signatures.entries()) {
		const nestedValue = value[index]
		if (typeof nestedValue === 'object' && nestedValue !== null) result.set(nestedValue, nestedSignature)
		collectNestedSignatures(nestedSignature, nestedValue, result)
	}
}

function decodedCall(call: SignatureInfo): DecodedTransactionData {
	const nestedSignatures = new Map<object, string>()
	collectNestedSignatures(call.signature, call.value, nestedSignatures)
	return {
		name: call.name,
		signature: call.signature,
		arguments: call.value as Readonly<Record<string, unknown>> | readonly unknown[] | undefined,
		...(nestedSignatures.size === 0 ? {} : { nestedSignatures }),
	}
}

export function decodeTransactionData(chainId: bigint, destination: bigint, data: Uint8Array): TransactionDataDecodeResult {
	if (data.length === 0) return { status: 'empty' }
	try {
		const candidates = uniqueCandidates(decodeWithTransactionAbis(chainId, destination, data)).map(decodedCall)
		const call = candidates[0]
		if (call === undefined) return { status: 'unknown' }
		return {
			status: 'decoded',
			call,
			candidates,
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

export function rawTransactionData(data: Uint8Array): Hex {
	return bytesToHex(data)
}

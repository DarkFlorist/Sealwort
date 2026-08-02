import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex as nobleBytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import { addr } from 'micro-eth-signer'

export type Hex = `0x${ string }`
export type SafeReadMethod = 'VERSION' | 'nonce' | 'getOwners' | 'getThreshold'

const HEX_REGEX = /^0x[0-9a-fA-F]*$/u
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/u
const WORD_BYTES = 32

export function ensureHex(value: string, name = 'hex'): Hex {
	if (!HEX_REGEX.test(value)) throw new Error(`${ name } must be a 0x-prefixed hex string.`)
	if (value.length % 2 !== 0) throw new Error(`${ name } must contain an even number of hex digits.`)
	return `0x${ value.slice(2) }`
}

export const bytesFromHex = (value: Hex) => hexToBytes(value.slice(2))
export const bytesToHex = (value: Uint8Array): Hex => `0x${ nobleBytesToHex(value) }`
export const dataStringWith0xStart = bytesToHex

export function addressString(address: bigint): Hex {
	if (address < 0n || address >= 2n ** 160n) throw new Error('Ethereum address is outside the 160-bit address range.')
	return `0x${ address.toString(16).padStart(40, '0') }`
}

export const checksummedAddress = (address: bigint) => addr.addChecksum(addressString(address))
export const bytes32String = (value: bigint): Hex => `0x${ value.toString(16).padStart(64, '0') }`

export const keccak256 = (value: Uint8Array): Uint8Array => keccak_256(value)

const functionSelector = (signature: string): Hex => `0x${ nobleBytesToHex(keccak_256(utf8ToBytes(signature)).slice(0, 4)) }`

const SAFE_READ_CALLS = {
	VERSION: functionSelector('VERSION()'),
	nonce: functionSelector('nonce()'),
	getOwners: functionSelector('getOwners()'),
	getThreshold: functionSelector('getThreshold()'),
} as const

export const encodeSafeReadCall = (method: SafeReadMethod) => SAFE_READ_CALLS[method]

function readWord(data: Uint8Array, wordIndex: number, label: string) {
	const start = wordIndex * WORD_BYTES
	const end = start + WORD_BYTES
	if (end > data.length) throw new Error(`${ label } is truncated.`)
	return data.slice(start, end)
}

function wordToBigInt(word: Uint8Array) {
	return BigInt(bytesToHex(word))
}

function safeNumber(value: bigint, label: string) {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${ label } is too large.`)
	return Number(value)
}

function dynamicStart(data: Uint8Array, label: string) {
	const offset = safeNumber(wordToBigInt(readWord(data, 0, label)), `${ label } offset`)
	if (offset % WORD_BYTES !== 0 || offset + WORD_BYTES > data.length) throw new Error(`${ label } contains an invalid ABI offset.`)
	return offset
}

export function decodeSafeVersion(value: Hex) {
	const data = bytesFromHex(value)
	if (data.length < WORD_BYTES) throw new Error('Safe VERSION() did not return a complete ABI-encoded string.')
	const start = dynamicStart(data, 'Safe VERSION result')
	const length = safeNumber(wordToBigInt(data.slice(start, start + WORD_BYTES)), 'Safe VERSION length')
	const contentStart = start + WORD_BYTES
	if (contentStart + length > data.length) throw new Error('Safe VERSION() did not return a complete ABI-encoded string.')
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(data.slice(contentStart, contentStart + length))
	} catch {
		throw new Error('Safe VERSION result is not valid UTF-8.')
	}
}

export function decodeSafeUint(value: Hex, label: string) {
	const data = bytesFromHex(value)
	if (data.length < WORD_BYTES) throw new Error(`${ label } result is truncated.`)
	return wordToBigInt(data.slice(0, WORD_BYTES))
}

export function decodeSafeOwners(value: Hex) {
	const data = bytesFromHex(value)
	const start = dynamicStart(data, 'Safe getOwners result')
	const count = safeNumber(wordToBigInt(data.slice(start, start + WORD_BYTES)), 'Safe owner count')
	const ownersStart = start + WORD_BYTES
	if (ownersStart + count * WORD_BYTES > data.length) throw new Error('Safe getOwners result is truncated.')
	const owners: bigint[] = []
	for (let index = 0; index < count; index += 1) {
		const word = data.slice(ownersStart + index * WORD_BYTES, ownersStart + (index + 1) * WORD_BYTES)
		if (word.slice(0, 12).some((byte) => byte !== 0)) throw new Error('Safe getOwners result contains an invalid address.')
		owners.push(wordToBigInt(word.slice(12)))
	}
	return owners
}

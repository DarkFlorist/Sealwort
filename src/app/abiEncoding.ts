import { concatBytes } from '@noble/hashes/utils'
import { addressString, bytesFromHex } from './ethereum.js'

export const ABI_WORD_BYTES = 32
const UINT256_LIMIT = 2n ** 256n

export function uint256Word(value: bigint, label: string) {
	if (value < 0n || value >= UINT256_LIMIT) throw new Error(`${ label } is outside the uint256 range.`)
	return bytesFromHex(`0x${ value.toString(16).padStart(ABI_WORD_BYTES * 2, '0') }`)
}

export function addressWord(value: bigint, label: string) {
	addressString(value)
	return uint256Word(value, label)
}

export function encodeDynamicBytes(value: Uint8Array) {
	const paddingLength = (ABI_WORD_BYTES - value.length % ABI_WORD_BYTES) % ABI_WORD_BYTES
	return concatBytes(uint256Word(BigInt(value.length), 'ABI byte length'), value, new Uint8Array(paddingLength))
}

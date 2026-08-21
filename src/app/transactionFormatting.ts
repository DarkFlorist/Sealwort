import { formatTokenBalance } from './assetFormatting.js'
import { bytesToHex } from './ethereum.js'

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

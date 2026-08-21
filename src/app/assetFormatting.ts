import { getNativeAssetIdentity } from './addressRegistry.js'

export function getNativeAssetSymbol(chainId: bigint) {
	return getNativeAssetIdentity(chainId).symbol
}

export function formatTokenBalance(value: bigint, decimals: number, maximumFractionDigits = 6) {
	if (!Number.isSafeInteger(decimals) || decimals < 0) throw new Error('Token decimals must be a non-negative integer.')
	if (!Number.isSafeInteger(maximumFractionDigits) || maximumFractionDigits < 0) throw new Error('Maximum fraction digits must be a non-negative integer.')
	if (value < 0n) throw new Error('Token balance cannot be negative.')
	const unit = 10n ** BigInt(decimals)
	const integerPart = value / unit
	const fractionDigits = Math.min(decimals, maximumFractionDigits)
	if (fractionDigits === 0) return integerPart.toString()
	const visibleFractionUnit = 10n ** BigInt(decimals - fractionDigits)
	const visibleFractionValue = value % unit / visibleFractionUnit
	if (integerPart === 0n && visibleFractionValue === 0n && value !== 0n) return `<0.${ '0'.repeat(fractionDigits - 1) }1`
	const visibleFraction = visibleFractionValue.toString().padStart(fractionDigits, '0').replace(/0+$/u, '')
	return visibleFraction.length === 0 ? integerPart.toString() : `${ integerPart.toString() }.${ visibleFraction }`
}

export const DIRECT_PAYMENT_ABI = [{
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
}] as const

export const CONVERSION_PAYMENT_ABI = [{
	type: 'function',
	name: 'transferFromWithReferenceAndFee',
	inputs: [
		{ name: '_to', type: 'address' },
		{ name: '_requestAmount', type: 'uint256' },
		{ name: '_path', type: 'address[]' },
		{ name: '_paymentReference', type: 'bytes' },
		{ name: '_feeAmount', type: 'uint256' },
		{ name: '_feeAddress', type: 'address' },
		{ name: '_maxToSpend', type: 'uint256' },
		{ name: '_maxRateTimespan', type: 'uint256' },
	],
}] as const

export const PAYMENT_SAFE_TRANSFER_ABI = [{
	type: 'function',
	name: 'safeTransferFrom',
	inputs: [
		{ name: '_tokenAddress', type: 'address' },
		{ name: '_to', type: 'address' },
		{ name: '_amount', type: 'uint256' },
	],
}] as const

export const CUSTOM_PAYMENT_ABI = [...DIRECT_PAYMENT_ABI, ...CONVERSION_PAYMENT_ABI, ...PAYMENT_SAFE_TRANSFER_ABI] as const

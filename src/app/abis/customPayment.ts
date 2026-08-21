export const CUSTOM_PAYMENT_ABI = [{
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

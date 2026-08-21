export const ERC721_SAFE_TRANSFER_WITH_DATA_ABI = [{
	type: 'function',
	name: 'safeTransferFrom',
	inputs: [
		{ name: 'from', type: 'address' },
		{ name: 'to', type: 'address' },
		{ name: 'tokenId', type: 'uint256' },
		{ name: 'data', type: 'bytes' },
	],
}] as const

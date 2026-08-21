export const TOKEN_METADATA_ABI = [{
	type: 'function',
	name: 'balanceOf',
	inputs: [{ name: 'owner', type: 'address' }],
	outputs: [{ name: 'balance', type: 'uint256' }],
}, {
	type: 'function',
	name: 'decimals',
	inputs: [],
	outputs: [{ name: 'decimals', type: 'uint8' }],
}, {
	type: 'function',
	name: 'supportsInterface',
	inputs: [{ name: 'interfaceId', type: 'bytes4' }],
	outputs: [{ name: 'supported', type: 'bool' }],
}] as const

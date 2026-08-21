export const ERC2612_ABI = [{
	type: 'function',
	name: 'permit',
	inputs: [
		{ name: 'owner', type: 'address' },
		{ name: 'spender', type: 'address' },
		{ name: 'value', type: 'uint256' },
		{ name: 'deadline', type: 'uint256' },
		{ name: 'v', type: 'uint8' },
		{ name: 'r', type: 'bytes32' },
		{ name: 's', type: 'bytes32' },
	],
}] as const

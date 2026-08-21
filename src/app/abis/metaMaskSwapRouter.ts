export const METAMASK_SWAP_ROUTER_ABI = [{
	type: 'function',
	name: 'swap',
	inputs: [
		{ name: 'aggregatorId', type: 'string' },
		{ name: 'tokenFrom', type: 'address' },
		{ name: 'amount', type: 'uint256' },
		{ name: 'data', type: 'bytes' },
	],
}] as const

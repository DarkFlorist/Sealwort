export const METAMASK_SWAP_ROUTER_ADDRESS = 0x881d40237659c251811cec9c364ef91dc08d300cn

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

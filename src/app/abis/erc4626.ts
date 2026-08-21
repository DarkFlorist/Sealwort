export const ERC4626_ABI = [{
	type: 'function',
	name: 'deposit',
	inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }],
	outputs: [{ name: 'shares', type: 'uint256' }],
}, {
	type: 'function',
	name: 'mint',
	inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }],
	outputs: [{ name: 'assets', type: 'uint256' }],
}, {
	type: 'function',
	name: 'withdraw',
	inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }],
	outputs: [{ name: 'shares', type: 'uint256' }],
}, {
	type: 'function',
	name: 'redeem',
	inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }],
	outputs: [{ name: 'assets', type: 'uint256' }],
}] as const

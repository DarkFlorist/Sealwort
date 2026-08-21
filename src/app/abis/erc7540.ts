export const ERC7540_ABI = [{
	type: 'function',
	name: 'deposit',
	inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'controller', type: 'address' }],
	outputs: [{ name: 'shares', type: 'uint256' }],
}, {
	type: 'function',
	name: 'mint',
	inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'controller', type: 'address' }],
	outputs: [{ name: 'assets', type: 'uint256' }],
}, {
	type: 'function',
	name: 'requestDeposit',
	inputs: [{ name: 'assets', type: 'uint256' }, { name: 'controller', type: 'address' }, { name: 'owner', type: 'address' }],
	outputs: [{ name: 'requestId', type: 'uint256' }],
}, {
	type: 'function',
	name: 'redeem',
	inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'controller', type: 'address' }],
	outputs: [{ name: 'assets', type: 'uint256' }],
}, {
	type: 'function',
	name: 'withdraw',
	inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'controller', type: 'address' }],
	outputs: [{ name: 'shares', type: 'uint256' }],
}, {
	type: 'function',
	name: 'requestRedeem',
	inputs: [{ name: 'shares', type: 'uint256' }, { name: 'controller', type: 'address' }, { name: 'owner', type: 'address' }],
	outputs: [{ name: 'requestId', type: 'uint256' }],
}, {
	type: 'function',
	name: 'setOperator',
	inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }],
	outputs: [{ name: 'success', type: 'bool' }],
}] as const

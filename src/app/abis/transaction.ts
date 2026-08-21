import { CONTRACTS, ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './customPayment.js'
import { ERC2612_ABI } from './erc2612.js'
import { ERC4626_ABI } from './erc4626.js'
import { ERC7540_ABI } from './erc7540.js'
import { METAMASK_SWAP_ROUTER_ABI, METAMASK_SWAP_ROUTER_ADDRESS } from './metaMaskSwapRouter.js'

export const TRANSACTION_ABIS: readonly ContractABI[] = [ERC20, ERC721, ERC1155, WETH, ERC2612_ABI, ERC4626_ABI, ERC7540_ABI, CUSTOM_PAYMENT_ABI]

const INLINE_CONTRACT_ABIS = Object.fromEntries(Object.entries(CONTRACTS).flatMap(([address, contract]) =>
	typeof contract.abi === 'string' ? [] : [[address, contract.abi]],
)) as Readonly<Record<string, ContractABI>>

export const ADDRESS_BOUND_TRANSACTION_ABIS: Readonly<Record<string, ContractABI>> = {
	...INLINE_CONTRACT_ABIS,
	[`0x${ METAMASK_SWAP_ROUTER_ADDRESS.toString(16).padStart(40, '0') }`]: METAMASK_SWAP_ROUTER_ABI,
}

export function transactionAbisForDestination(destination: string) {
	const exactAbi = ADDRESS_BOUND_TRANSACTION_ABIS[destination.toLowerCase()]
	return exactAbi === undefined ? TRANSACTION_ABIS : [exactAbi, ...TRANSACTION_ABIS]
}

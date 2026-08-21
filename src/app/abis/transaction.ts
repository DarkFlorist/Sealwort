import { CONTRACTS, ERC1155, ERC20, ERC721, KYBER_NETWORK_PROXY_CONTRACT, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './customPayment.js'
import { ERC2612_ABI } from './erc2612.js'
import { ERC4626_ABI } from './erc4626.js'
import { ERC7540_ABI } from './erc7540.js'
import { METAMASK_SWAP_ROUTER_ABI, METAMASK_SWAP_ROUTER_ADDRESS } from './metaMaskSwapRouter.js'

export const TRANSACTION_ABIS: readonly ContractABI[] = [ERC20, ERC721, ERC1155, WETH, ERC2612_ABI, ERC4626_ABI, ERC7540_ABI, CUSTOM_PAYMENT_ABI]

type AddressBoundTransactionDefinition = { readonly abi: ContractABI, readonly label: string }

const CONTRACT_LABELS: Readonly<Record<string, string>> = {
	[UNISWAP_V2_ROUTER_CONTRACT]: 'Uniswap V2 Router',
	[UNISWAP_V3_ROUTER_CONTRACT]: 'Uniswap V3 Router',
	[KYBER_NETWORK_PROXY_CONTRACT]: 'Kyber Network Proxy',
}

export const ADDRESS_BOUND_TRANSACTION_DEFINITIONS: Readonly<Record<string, AddressBoundTransactionDefinition>> = {
	...Object.fromEntries(Object.entries(CONTRACTS).flatMap(([address, contract]) =>
		typeof contract.abi === 'string' ? [] : [[address, { abi: contract.abi, label: CONTRACT_LABELS[address] ?? contract.name ?? 'Contract' }]],
	)),
	[`0x${ METAMASK_SWAP_ROUTER_ADDRESS.toString(16).padStart(40, '0') }`]: { abi: METAMASK_SWAP_ROUTER_ABI, label: 'MetaMask Swap Router' },
}

export const ADDRESS_BOUND_TRANSACTION_ABIS: Readonly<Record<string, ContractABI>> = Object.fromEntries(
	Object.entries(ADDRESS_BOUND_TRANSACTION_DEFINITIONS).map(([address, { abi }]) => [address, abi]),
)

export const TRANSACTION_CONTRACT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(ADDRESS_BOUND_TRANSACTION_DEFINITIONS).map(([address, { label }]) => [address, label]),
)

export function transactionAbisForDestination(destination: string) {
	const definition = ADDRESS_BOUND_TRANSACTION_DEFINITIONS[destination.toLowerCase()]
	return definition === undefined ? TRANSACTION_ABIS : [definition.abi, ...TRANSACTION_ABIS]
}

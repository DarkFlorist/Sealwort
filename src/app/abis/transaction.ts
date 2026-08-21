import { CONTRACTS, ERC1155, ERC20, ERC721, KYBER_NETWORK_PROXY_CONTRACT, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { ETHEREUM_MAINNET_CHAIN_ID } from '../chainConfiguration.js'
import { CUSTOM_PAYMENT_ABI } from './customPayment.js'
import { ERC2612_ABI } from './erc2612.js'
import { ERC4626_ABI } from './erc4626.js'
import { ERC7540_ABI } from './erc7540.js'
import { MAINNET_METAMASK_SWAP_ROUTER_ADDRESS, METAMASK_SWAP_ROUTER_ABI } from './metaMaskSwapRouter.js'

export const TRANSACTION_ABIS: readonly ContractABI[] = [ERC20, ERC721, ERC1155, WETH, ERC2612_ABI, ERC4626_ABI, ERC7540_ABI, CUSTOM_PAYMENT_ABI]

type AddressBoundTransactionDefinition = { readonly abi: ContractABI, readonly label: string }

const CONTRACT_LABELS: Readonly<Record<string, string>> = {
	[UNISWAP_V2_ROUTER_CONTRACT]: 'Uniswap V2 Router',
	[UNISWAP_V3_ROUTER_CONTRACT]: 'Uniswap V3 Router',
	[KYBER_NETWORK_PROXY_CONTRACT]: 'Kyber Network Proxy',
}

const MAINNET_TRANSACTION_DEFINITIONS: Readonly<Record<string, AddressBoundTransactionDefinition>> = {
	...Object.fromEntries(Object.entries(CONTRACTS).flatMap(([address, contract]) =>
		typeof contract.abi === 'string' ? [] : [[address, { abi: contract.abi, label: CONTRACT_LABELS[address] ?? contract.name ?? 'Contract' }]],
	)),
	[`0x${ MAINNET_METAMASK_SWAP_ROUTER_ADDRESS.toString(16).padStart(40, '0') }`]: { abi: METAMASK_SWAP_ROUTER_ABI, label: 'MetaMask Swap Router' },
}

export const CHAIN_TRANSACTION_DEFINITIONS: Readonly<Record<string, Readonly<Record<string, AddressBoundTransactionDefinition>>>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: MAINNET_TRANSACTION_DEFINITIONS,
}

export const MAINNET_ADDRESS_BOUND_TRANSACTION_ABIS: Readonly<Record<string, ContractABI>> = Object.fromEntries(
	Object.entries(MAINNET_TRANSACTION_DEFINITIONS).map(([address, { abi }]) => [address, abi]),
)

export function transactionContractLabelsForChain(chainId: bigint): Readonly<Record<string, string>> {
	return Object.fromEntries(Object.entries(CHAIN_TRANSACTION_DEFINITIONS[chainId.toString()] ?? {}).map(([address, { label }]) => [address, label]))
}

export function transactionAbisForDestination(chainId: bigint, destination: string) {
	const definition = CHAIN_TRANSACTION_DEFINITIONS[chainId.toString()]?.[destination.toLowerCase()]
	return definition === undefined ? TRANSACTION_ABIS : [definition.abi, ...TRANSACTION_ABIS]
}

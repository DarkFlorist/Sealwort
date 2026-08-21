import { CONTRACTS, KYBER_NETWORK_PROXY_CONTRACT, UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V3_ROUTER_CONTRACT, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { METAMASK_SWAP_ROUTER_ABI } from './abis/metaMaskSwapRouter.js'
import { TRANSACTION_ABIS } from './abis/transaction.js'
import { ETHEREUM_MAINNET_CHAIN_ID, getChainConfiguration } from './chainConfiguration.js'
import { addressString } from './ethereum.js'

type AddressBoundTransactionDefinition = { readonly abi: ContractABI }

function contractAbi(address: string) {
	const abi = CONTRACTS[address]?.abi
	return abi === undefined || typeof abi === 'string' ? undefined : abi
}

function mainnetTransactionDefinitions(): Readonly<Record<string, AddressBoundTransactionDefinition>> {
	const deployments = getChainConfiguration(ETHEREUM_MAINNET_CHAIN_ID).transactionContracts
	if (deployments === undefined) return {}
	const definitions: readonly [string, ContractABI | undefined][] = [
		[addressString(deployments.uniswapV2Router), contractAbi(UNISWAP_V2_ROUTER_CONTRACT)],
		[addressString(deployments.uniswapV3Router), contractAbi(UNISWAP_V3_ROUTER_CONTRACT)],
		[addressString(deployments.kyberNetworkProxy), contractAbi(KYBER_NETWORK_PROXY_CONTRACT)],
		[addressString(deployments.metaMaskSwapRouter), METAMASK_SWAP_ROUTER_ABI],
	]
	return Object.fromEntries(definitions.flatMap(([address, abi]) => abi === undefined ? [] : [[address.toLowerCase(), { abi }]]))
}

const CHAIN_TRANSACTION_DEFINITIONS: Readonly<Record<string, Readonly<Record<string, AddressBoundTransactionDefinition>>>> = {
	[ETHEREUM_MAINNET_CHAIN_ID.toString()]: mainnetTransactionDefinitions(),
}

export const MAINNET_ADDRESS_BOUND_TRANSACTION_ABIS: Readonly<Record<string, ContractABI>> = Object.fromEntries(
	Object.entries(CHAIN_TRANSACTION_DEFINITIONS[ETHEREUM_MAINNET_CHAIN_ID.toString()] ?? {}).map(([address, { abi }]) => [address, abi]),
)

export function transactionAbisForDestination(chainId: bigint, destination: string) {
	const definition = CHAIN_TRANSACTION_DEFINITIONS[chainId.toString()]?.[destination.toLowerCase()]
	return definition === undefined ? TRANSACTION_ABIS : [definition.abi, ...TRANSACTION_ABIS]
}

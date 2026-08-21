import { type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { ETHEREUM_MAINNET_CHAIN_ID } from './chainConfiguration.js'
import { addressString } from './ethereum.js'
import { TRANSACTION_DEFINITIONS, transactionDefinitionForAddress } from './transactionDefinitions.js'

export const MAINNET_ADDRESS_BOUND_TRANSACTION_ABIS: Readonly<Record<string, ContractABI>> = Object.fromEntries(
	TRANSACTION_DEFINITIONS.flatMap(({ abi, deployment }) => deployment?.chainId === ETHEREUM_MAINNET_CHAIN_ID ? [[addressString(deployment.address).toLowerCase(), abi]] : []),
)

export function transactionAbisForDestination(chainId: bigint, destination: string) {
	const genericAbis = TRANSACTION_DEFINITIONS.flatMap((definition) => definition.deployment === undefined ? [definition.abi] : [])
	const definition = transactionDefinitionForAddress(chainId, BigInt(destination))
	return definition === undefined ? genericAbis : [definition.abi, ...genericAbis]
}

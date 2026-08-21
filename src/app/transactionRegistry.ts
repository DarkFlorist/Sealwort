import { TRANSACTION_DEFINITIONS, transactionDefinitionForAddress } from './transactionDefinitions.js'

export function transactionAbisForDestination(chainId: bigint, destination: string) {
	const genericAbis = TRANSACTION_DEFINITIONS.flatMap((definition) => definition.deployment === undefined ? [definition.abi] : [])
	const definition = transactionDefinitionForAddress(chainId, BigInt(destination))
	return definition === undefined ? genericAbis : [definition.abi, ...genericAbis]
}

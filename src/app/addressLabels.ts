import { getChainConfiguration, NATIVE_TOKEN_SENTINEL } from './chainConfiguration.js'
import { checksummedAddress } from './ethereum.js'
import { transactionDefinitionForAddress } from './transactionDefinitions.js'

export function getAddressLabel(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	if (connectedAccount === address) return 'connected wallet'
	const configuration = getChainConfiguration(chainId)
	const token = configuration.tokens.find((deployment) => deployment.address === address)
	if (token !== undefined) return token.symbol
	if (address === NATIVE_TOKEN_SENTINEL) return 'native asset'
	return transactionDefinitionForAddress(chainId, address)?.deployment?.label
}

export function identifiedAddress(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	const formatted = checksummedAddress(address)
	const label = getAddressLabel(address, chainId, connectedAccount)
	return label === undefined ? formatted : `${ formatted } (${ label })`
}

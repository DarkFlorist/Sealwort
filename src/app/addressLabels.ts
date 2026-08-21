import { transactionContractLabelsForChain } from './abis/transaction.js'
import { getChainConfiguration } from './chainConfiguration.js'
import { checksummedAddress } from './ethereum.js'

export function getAddressLabel(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	if (connectedAccount === address) return 'connected wallet'
	const key = `0x${ address.toString(16).padStart(40, '0') }`
	return getChainConfiguration(chainId).addressLabels[key] ?? transactionContractLabelsForChain(chainId)[key]
}

export function identifiedAddress(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	const formatted = checksummedAddress(address)
	const label = getAddressLabel(address, chainId, connectedAccount)
	return label === undefined ? formatted : `${ formatted } (${ label })`
}

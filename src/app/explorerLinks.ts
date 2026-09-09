import { getBlockExplorerUrl } from './addressRegistry.js'

export function getTransactionExplorerUrl(chainId: bigint, transactionHash: string) {
	const explorerUrl = getBlockExplorerUrl(chainId)
	return explorerUrl === undefined ? undefined : `${ explorerUrl }/tx/${ transactionHash }`
}

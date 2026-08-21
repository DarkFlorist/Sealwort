import { ChainDiscoveryUnavailableError, type ChainDiscoveryContext } from './chainDiscoveryError.js'
import { isWalletRequestTimeoutError } from './walletProvider.js'

export async function mapChainDiscoveryTimeout<Result>(operation: () => Promise<Result>, context: ChainDiscoveryContext) {
	try {
		return await operation()
	} catch (chainDiscoveryError) {
		if (isWalletRequestTimeoutError(chainDiscoveryError, 'eth_chainId')) {
			throw new ChainDiscoveryUnavailableError(context, { cause: chainDiscoveryError })
		}
		throw chainDiscoveryError
	}
}

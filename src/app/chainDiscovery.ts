import { ChainDiscoveryUnavailableError, type ChainDiscoveryContext } from './chainDiscoveryError.js'
import { isWalletChainDiscoveryTimeoutError } from './walletProvider.js'

export async function mapChainDiscoveryTimeout<Result>(operation: () => Promise<Result>, context: ChainDiscoveryContext) {
	try {
		return await operation()
	} catch (chainDiscoveryError) {
		if (isWalletChainDiscoveryTimeoutError(chainDiscoveryError)) {
			throw new ChainDiscoveryUnavailableError(context, { cause: chainDiscoveryError })
		}
		throw chainDiscoveryError
	}
}

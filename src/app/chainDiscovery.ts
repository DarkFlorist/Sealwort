import { ChainDiscoveryUnavailableError } from './chainDiscoveryError.js'
import { isWalletChainDiscoveryTimeoutError } from './walletProvider.js'

export async function withChainDiscoveryError<Result>(operation: () => Promise<Result>) {
	try {
		return await operation()
	} catch (chainDiscoveryError) {
		if (isWalletChainDiscoveryTimeoutError(chainDiscoveryError)) {
			throw new ChainDiscoveryUnavailableError({ cause: chainDiscoveryError })
		}
		throw chainDiscoveryError
	}
}

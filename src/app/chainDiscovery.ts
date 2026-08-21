import * as funtypes from 'funtypes'
import { ChainDiscoveryUnavailableError, type ChainDiscoveryContext } from './chainDiscoveryError.js'
import type { InjectedProvider } from './provider.js'
import { isWalletRequestTimeoutError } from './walletProvider.js'

export async function readChainId(provider: InjectedProvider, context: ChainDiscoveryContext) {
	try {
		return BigInt(funtypes.String.parse(await provider.request({ method: 'eth_chainId' })))
	} catch (chainDiscoveryError) {
		if (isWalletRequestTimeoutError(chainDiscoveryError, 'eth_chainId')) {
			throw new ChainDiscoveryUnavailableError(context, { cause: chainDiscoveryError })
		}
		throw chainDiscoveryError
	}
}

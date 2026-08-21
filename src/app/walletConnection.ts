import * as funtypes from 'funtypes'
import { WalletConnectionUnavailableError } from './walletConnectionError.js'
import { isWalletChainDiscoveryTimeoutError } from './walletProvider.js'

type WalletChainProvider = {
	request(request: { readonly method: string }): Promise<unknown>
}

export async function readWalletChainId(provider: WalletChainProvider) {
	try {
		return BigInt(funtypes.String.parse(await provider.request({ method: 'eth_chainId' })))
	} catch (chainDiscoveryError) {
		if (isWalletChainDiscoveryTimeoutError(chainDiscoveryError)) {
			throw new WalletConnectionUnavailableError({ cause: chainDiscoveryError })
		}
		throw chainDiscoveryError
	}
}

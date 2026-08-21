import * as funtypes from 'funtypes'
import { mapChainDiscoveryTimeout } from './chainDiscovery.js'

type WalletChainProvider = {
	request(request: { readonly method: string }): Promise<unknown>
}

export async function readWalletChainId(provider: WalletChainProvider) {
	return await mapChainDiscoveryTimeout(
		async () => BigInt(funtypes.String.parse(await provider.request({ method: 'eth_chainId' }))),
		'wallet-connection',
	)
}

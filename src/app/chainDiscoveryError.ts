export type ChainDiscoveryContext = 'wallet-connection' | 'stack-verification'

export class ChainDiscoveryUnavailableError extends Error {
	readonly context: ChainDiscoveryContext

	constructor(context: ChainDiscoveryContext, options?: ErrorOptions) {
		super('Chain discovery is unavailable.', options)
		this.name = 'ChainDiscoveryUnavailableError'
		this.context = context
	}
}

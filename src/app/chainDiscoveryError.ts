export class ChainDiscoveryUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super('Chain discovery is unavailable.', options)
		this.name = 'ChainDiscoveryUnavailableError'
	}
}

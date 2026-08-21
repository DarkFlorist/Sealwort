export class WalletConnectionUnavailableError extends Error {
	constructor(options?: ErrorOptions) {
		super('The wallet connection is unavailable.', options)
		this.name = 'WalletConnectionUnavailableError'
	}
}

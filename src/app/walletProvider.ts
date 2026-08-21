import type { InjectedProvider, ProviderRequest } from './safeStackValidation.js'

export const DEFAULT_WALLET_REQUEST_TIMEOUT_MS = 15_000
export const INTERACTIVE_WALLET_REQUEST_TIMEOUT_MS = 120_000

export class WalletRequestTimeoutError extends Error {
	readonly method: string

	constructor(method: string) {
		super(getWalletRequestTimeoutMessage(method))
		this.name = 'WalletRequestTimeoutError'
		this.method = method
	}
}

export function isWalletRequestTimeoutError(error: unknown, method?: string): error is WalletRequestTimeoutError {
	return error instanceof WalletRequestTimeoutError && (method === undefined || error.method === method)
}

function requiresUnlimitedReviewTime(method: string) {
	return method === 'eth_sendTransaction'
		|| method === 'eth_sign'
		|| method === 'personal_sign'
		|| method.startsWith('eth_signTypedData')
}

function isInteractiveWalletRequest(method: string) {
	return method === 'eth_requestAccounts'
		|| method === 'wallet_requestPermissions'
		|| method === 'wallet_switchEthereumChain'
		|| method === 'wallet_addEthereumChain'
		|| method === 'wallet_watchAsset'
}

export function getWalletRequestTimeoutMessage(method: string) {
	return `The wallet did not respond to ${ method }. Reconnect the wallet and try again.`
}

export function withWalletRequestTimeout(
	provider: InjectedProvider,
	timeoutMs?: number,
): InjectedProvider {
	if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error('The wallet request timeout must be a positive number.')
	return {
		async request(request: ProviderRequest) {
			if (requiresUnlimitedReviewTime(request.method)) return await provider.request(request)
			const requestTimeoutMs = timeoutMs ?? (isInteractiveWalletRequest(request.method)
				? INTERACTIVE_WALLET_REQUEST_TIMEOUT_MS
				: DEFAULT_WALLET_REQUEST_TIMEOUT_MS)
			let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
			try {
				return await Promise.race([
					Promise.resolve().then(async () => await provider.request(request)),
					new Promise<never>((_resolve, reject) => {
						timeout = globalThis.setTimeout(() => reject(new WalletRequestTimeoutError(request.method)), requestTimeoutMs)
					}),
				])
			} finally {
				if (timeout !== undefined) globalThis.clearTimeout(timeout)
			}
		},
	}
}

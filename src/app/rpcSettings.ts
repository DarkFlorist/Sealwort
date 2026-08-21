export const DEFAULT_ETHEREUM_RPC_URL = 'https://ethereum.dark.florist'
export const PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY = 'sealwort.ethereum-rpc-url'

export type RpcSettingsStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

function isLoopbackHostname(hostname: string) {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function validateEthereumRpcUrl(value: string) {
	const trimmedValue = value.trim()
	let parsed: URL
	try {
		parsed = new URL(trimmedValue)
	} catch {
		throw new Error('Enter a valid Ethereum RPC URL.')
	}
	if (parsed.host.length === 0) throw new Error('The Ethereum RPC URL must include a host.')
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
		throw new Error('The Ethereum RPC URL must use HTTPS, except for HTTP loopback addresses.')
	}
	if (parsed.username.length !== 0 || parsed.password.length !== 0) {
		throw new Error('The Ethereum RPC URL must not contain embedded credentials.')
	}
	if (parsed.hash.length !== 0) throw new Error('The Ethereum RPC URL must not contain a fragment.')
	return trimmedValue
}

export function getEthereumRpcHost(rpcUrl: string) {
	return new URL(rpcUrl).host
}

export function readPersistedEthereumRpcUrl(storage: RpcSettingsStorage | undefined) {
	if (storage === undefined) return DEFAULT_ETHEREUM_RPC_URL
	try {
		const persistedValue = storage.getItem(PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY)
		return persistedValue === null ? DEFAULT_ETHEREUM_RPC_URL : validateEthereumRpcUrl(persistedValue)
	} catch {
		return DEFAULT_ETHEREUM_RPC_URL
	}
}

export function persistEthereumRpcUrl(storage: RpcSettingsStorage | undefined, rpcUrl: string) {
	if (storage === undefined) return false
	try {
		if (rpcUrl === DEFAULT_ETHEREUM_RPC_URL) storage.removeItem(PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY)
		else storage.setItem(PERSISTED_ETHEREUM_RPC_URL_STORAGE_KEY, rpcUrl)
		return true
	} catch {
		return false
	}
}

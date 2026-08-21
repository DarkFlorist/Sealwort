import * as funtypes from 'funtypes'
import type { InjectedProvider, ProviderRequest } from './safeStackValidation.js'
import { DEFAULT_ETHEREUM_RPC_URL, getEthereumRpcSourceLabel } from './rpcSettings.js'

export type SafeInformationSource = string
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseJsonRpcResponse(value: unknown, expectedId: number) {
	if (!isRecord(value) || value.id !== expectedId) throw new Error('The Ethereum RPC returned an invalid JSON-RPC response.')
	if (value.error !== undefined) {
		const message = isRecord(value.error) && typeof value.error.message === 'string' && value.error.message.trim().length !== 0
			? value.error.message
			: 'The Ethereum RPC rejected the request.'
		throw new Error(message)
	}
	if (!('result' in value)) throw new Error('The Ethereum RPC response did not include a result.')
	return value.result
}

export function createJsonRpcProvider(
	url: string,
	fetchImplementation: FetchImplementation = globalThis.fetch,
): InjectedProvider {
	let requestId = 0
	return {
		async request(request: ProviderRequest) {
			requestId += 1
			const currentRequestId = requestId
			let response: Response
			try {
				response = await fetchImplementation(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: currentRequestId,
						method: request.method,
						params: request.params ?? [],
					}),
				})
			} catch {
				throw new Error('Could not reach the Ethereum RPC.')
			}
			if (!response.ok) throw new Error(`The Ethereum RPC returned HTTP ${ response.status }.`)
			let responseBody: unknown
			try {
				responseBody = await response.json()
			} catch {
				throw new Error('The Ethereum RPC returned invalid JSON.')
			}
			return parseJsonRpcResponse(responseBody, currentRequestId)
		},
	}
}

export type SafeReadProvider = {
	readonly provider: InjectedProvider
	readonly source: SafeInformationSource
}

async function injectedProviderMatchesChain(provider: InjectedProvider, chainId: bigint) {
	try {
		return BigInt(funtypes.String.parse(await provider.request({ method: 'eth_chainId' }))) === chainId
	} catch {
		return false
	}
}

export async function getSafeReadProvider(
	chainId: bigint,
	injectedProvider: InjectedProvider | undefined,
	fetchImplementation: FetchImplementation = globalThis.fetch,
	ethereumRpcUrl = DEFAULT_ETHEREUM_RPC_URL,
): Promise<SafeReadProvider> {
	if (injectedProvider !== undefined && await injectedProviderMatchesChain(injectedProvider, chainId)) {
		return { provider: injectedProvider, source: 'Injected wallet' }
	}
	if (chainId === 1n) {
		return {
			provider: createJsonRpcProvider(ethereumRpcUrl, fetchImplementation),
			source: getEthereumRpcSourceLabel(ethereumRpcUrl),
		}
	}
	if (injectedProvider === undefined) {
		throw new Error(`No injected wallet is available to read Gnosis Safe information on chain ${ chainId.toString() }.`)
	}
	throw new Error(`Switch the injected wallet to chain ${ chainId.toString() } to read this Gnosis Safe’s current information.`)
}

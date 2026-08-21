import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { createJsonRpcProvider, getSafeReadProvider } from '../src/app/readProvider.js'
import { DEFAULT_ETHEREUM_RPC_URL } from '../src/app/rpcSettings.js'
import type { InjectedProvider } from '../src/app/provider.js'

function jsonResponse(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

describe('Safe information read provider', () => {
	test('uses an injected provider already connected to the Safe chain', async () => {
		const injectedProvider: InjectedProvider = {
			async request(request) {
				if (request.method === 'eth_chainId') return '0x1'
				throw new Error('Unexpected request')
			},
		}
		let fallbackRequested = false

		const selected = await getSafeReadProvider(1n, injectedProvider, async () => {
			fallbackRequested = true
			return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' })
		})

		assert.equal(selected.provider, injectedProvider)
		assert.deepEqual(selected.source, { kind: 'injected' })
		assert.equal(fallbackRequested, false)
	})

	test('uses the Dark Florist Ethereum RPC without an injected provider', async () => {
		const requests: { readonly url: string, readonly body: unknown }[] = []
		const selected = await getSafeReadProvider(1n, undefined, async (input, init) => {
			requests.push({
				url: String(input),
				body: JSON.parse(String(init?.body)),
			})
			return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' })
		})

		assert.deepEqual(selected.source, { kind: 'rpc', host: 'ethereum.dark.florist' })
		assert.equal(await selected.provider.request({ method: 'eth_chainId' }), '0x1')
		assert.equal(requests[0]?.url, DEFAULT_ETHEREUM_RPC_URL)
		assert.deepEqual(requests[0]?.body, {
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_chainId',
			params: [],
		})
	})

	test('falls back to the mainnet RPC when the injected wallet is on another chain', async () => {
		const injectedProvider: InjectedProvider = {
			async request() {
				return '0xaa36a7'
			},
		}

		const selected = await getSafeReadProvider(1n, injectedProvider, async () => jsonResponse({
			jsonrpc: '2.0',
			id: 1,
			result: '0x1',
		}))

		assert.deepEqual(selected.source, { kind: 'rpc', host: 'ethereum.dark.florist' })
		assert.equal(await selected.provider.request({ method: 'eth_chainId' }), '0x1')
	})

	test('uses the configured mainnet RPC without exposing its path in the source label', async () => {
		const requests: string[] = []
		const selected = await getSafeReadProvider(1n, undefined, async (input) => {
			requests.push(String(input))
			return jsonResponse({ jsonrpc: '2.0', id: 1, result: '0x1' })
		}, 'https://rpc.example.test/private-api-key')

		assert.deepEqual(selected.source, { kind: 'rpc', host: 'rpc.example.test' })
		assert.equal(await selected.provider.request({ method: 'eth_chainId' }), '0x1')
		assert.deepEqual(requests, ['https://rpc.example.test/private-api-key'])
	})

	test('reports JSON-RPC and transport failures clearly', async () => {
		const rejectedProvider = createJsonRpcProvider(DEFAULT_ETHEREUM_RPC_URL, async () => jsonResponse({
			jsonrpc: '2.0',
			id: 1,
			error: { code: -32000, message: 'upstream unavailable' },
		}))
		await assert.rejects(rejectedProvider.request({ method: 'eth_chainId' }), /upstream unavailable/u)

		const malformedErrorProvider = createJsonRpcProvider(DEFAULT_ETHEREUM_RPC_URL, async () => jsonResponse({
			jsonrpc: '2.0',
			id: 1,
			error: null,
		}))
		await assert.rejects(malformedErrorProvider.request({ method: 'eth_chainId' }), /Ethereum RPC rejected the request/u)

		const unavailableProvider = createJsonRpcProvider(DEFAULT_ETHEREUM_RPC_URL, async () => {
			throw new Error('network failure')
		})
		await assert.rejects(unavailableProvider.request({ method: 'eth_chainId' }), /Could not reach the Ethereum RPC/u)
	})

	test('matches concurrent responses to the request that created each ID', async () => {
		const pendingResponses = new Map<number, (response: Response) => void>()
		const provider = createJsonRpcProvider(DEFAULT_ETHEREUM_RPC_URL, async (_input, init) => {
			const body: unknown = JSON.parse(String(init?.body))
			if (typeof body !== 'object' || body === null || !('id' in body)) {
				throw new Error('Missing request ID')
			}
			const requestId = body.id
			if (typeof requestId !== 'number') throw new Error('Invalid request ID')
			return await new Promise<Response>((resolve) => {
				pendingResponses.set(requestId, resolve)
			})
		})

		const firstRequest = provider.request({ method: 'first' })
		const secondRequest = provider.request({ method: 'second' })
		pendingResponses.get(2)?.(jsonResponse({ jsonrpc: '2.0', id: 2, result: 'second result' }))
		pendingResponses.get(1)?.(jsonResponse({ jsonrpc: '2.0', id: 1, result: 'first result' }))

		assert.deepEqual(await Promise.all([firstRequest, secondRequest]), ['first result', 'second result'])
	})

	test('requires an injected provider for non-mainnet Safe information', async () => {
		await assert.rejects(
			getSafeReadProvider(11155111n, undefined),
			/No injected wallet is available to read Gnosis Safe information on chain 11155111/u,
		)
	})
})

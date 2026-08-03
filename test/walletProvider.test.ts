import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { getWalletRequestTimeoutMessage, withWalletRequestTimeout } from '../src/app/walletProvider.js'

describe('wallet provider request timeout', () => {
	test('rejects a provider request that never settles with the RPC method in the message', async () => {
		const provider = withWalletRequestTimeout({
			async request() {
				return await new Promise<never>(() => undefined)
			},
		}, 5)

		await assert.rejects(
			provider.request({ method: 'eth_getCode' }),
			new Error(getWalletRequestTimeoutMessage('eth_getCode')),
		)
	})

	test('preserves a provider response that settles before the timeout', async () => {
		const provider = withWalletRequestTimeout({
			async request(request) {
				return `${ request.method } response`
			},
		}, 50)

		assert.equal(await provider.request({ method: 'eth_chainId' }), 'eth_chainId response')
	})
})

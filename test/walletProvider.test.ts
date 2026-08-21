import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { getWalletRequestTimeoutMessage, isWalletRequestTimeoutError, withWalletRequestTimeout } from '../src/app/walletProvider.js'

describe('wallet provider request timeout', () => {
	test('rejects a provider request that never settles with the RPC method in the message', async () => {
		const provider = withWalletRequestTimeout({
			async request() {
				return await new Promise<never>(() => undefined)
			},
		}, 5)

		await assert.rejects(
			provider.request({ method: 'eth_getCode' }),
			(error) => isWalletRequestTimeoutError(error, 'eth_getCode') && error.message === getWalletRequestTimeoutMessage('eth_getCode'),
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

	test('allows unlimited review time for signing and transaction submission', async () => {
		const methods = ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4']
		const provider = withWalletRequestTimeout({
			async request(request) {
				await Bun.sleep(20)
				return `${ request.method } approved`
			},
		}, 5)

		await Promise.all(methods.map(async (method) => {
			assert.equal(await provider.request({ method }), `${ method } approved`)
		}))
	})
})

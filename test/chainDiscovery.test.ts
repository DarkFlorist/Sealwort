import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { mapChainDiscoveryTimeout } from '../src/app/chainDiscovery.js'
import { ChainDiscoveryUnavailableError } from '../src/app/chainDiscoveryError.js'
import { WalletRequestTimeoutError } from '../src/app/walletProvider.js'

describe('chain discovery errors', () => {
	test('translates only chain ID timeouts and preserves their usage context', async () => {
		await assert.rejects(
			mapChainDiscoveryTimeout(
				async () => { throw new WalletRequestTimeoutError('eth_chainId') },
				'wallet-connection',
			),
			(error) => error instanceof ChainDiscoveryUnavailableError && error.context === 'wallet-connection',
		)

		const otherTimeout = new WalletRequestTimeoutError('eth_getCode')
		await assert.rejects(
			mapChainDiscoveryTimeout(async () => { throw otherTimeout }, 'stack-verification'),
			(error) => error === otherTimeout,
		)
	})
})

import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { getUserFacingErrorMessage, isUserRejectedError, readSafeStackFile } from '../src/app/userFacingErrors.js'
import { ChainDiscoveryUnavailableError } from '../src/app/chainDiscoveryError.js'

describe('user-facing errors', () => {
	test('normalizes wallet rejections, provider objects, and unknown thrown values', () => {
		assert.equal(getUserFacingErrorMessage({ code: 4001 }), 'The wallet request was rejected.')
		assert.equal(getUserFacingErrorMessage(Object.assign(new Error('Provider-specific rejection'), { code: 4001 })), 'The wallet request was rejected.')
		assert.equal(getUserFacingErrorMessage(new Error('MetaMask - RPC Error: User rejected the request.')), 'The wallet request was rejected.')
		assert.equal(getUserFacingErrorMessage({ message: 'Switch networks in your wallet.' }), 'Switch networks in your wallet.')
		assert.equal(getUserFacingErrorMessage({ data: { message: 'Provider unavailable.' } }), 'Provider unavailable.')
		assert.equal(getUserFacingErrorMessage({
			message: 'Failed to process message signing request. See Interceptor for error message',
			data: { originalError: { message: 'The Safe signing route is unavailable.' } },
		}), 'The Safe signing route is unavailable.')
		assert.equal(getUserFacingErrorMessage({ reason: 'opaque' }), 'An unexpected error occurred. Try again or reload Sealwort.')
		assert.equal(getUserFacingErrorMessage(new ChainDiscoveryUnavailableError('wallet-connection')), 'The wallet connection could not be completed. Try connecting again.')
		assert.equal(getUserFacingErrorMessage(new ChainDiscoveryUnavailableError('stack-verification')), 'The wallet network could not be confirmed. Try again.')
	})

	test('recognizes wallet rejection variants that should leave signing retryable', () => {
		assert.equal(isUserRejectedError({ code: 4001 }), true)
		assert.equal(isUserRejectedError(new Error('MetaMask - RPC Error: User rejected the request.')), true)
		assert.equal(isUserRejectedError({ cause: { data: { message: 'User denied transaction signature.' } } }), true)
		assert.equal(isUserRejectedError(new Error('Safe nonce changed.')), false)

		const cyclicError: { cause?: unknown } = {}
		cyclicError.cause = cyclicError
		assert.equal(isUserRejectedError(cyclicError), false)
	})

	test('turns file read failures into an actionable import error', async () => {
		await assert.rejects(
			readSafeStackFile({ text: async () => { throw new DOMException('Unreadable') } }),
			/could not be read/u,
		)
	})
})

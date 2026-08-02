import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { runExecutionAttempt } from '../src/app/executionAttempt.js'

describe('Gnosis Safe execution attempt', () => {
	test('runs preparation, funding, and submission in order', async () => {
		const calls: string[] = []
		const result = await runExecutionAttempt({
			prepare: async () => { calls.push('prepare'); return { current: true } },
			isCurrent: ({ current }) => current,
			assertFunding: async () => { calls.push('funding') },
			submit: async () => { calls.push('submit'); return '0x01' },
		})

		assert.deepEqual(calls, ['prepare', 'funding', 'submit'])
		assert.equal(result.status, 'submitted')
	})

	test('cancels stale operations before funding or submission', async () => {
		let fundingChecked = false
		let submitted = false
		const result = await runExecutionAttempt({
			prepare: async () => ({ current: false }),
			isCurrent: ({ current }) => current,
			assertFunding: async () => { fundingChecked = true },
			submit: async () => { submitted = true; return '0x01' },
		})

		assert.equal(result.status, 'cancelled')
		assert.equal(fundingChecked, false)
		assert.equal(submitted, false)
	})

	test('invalidates verification only for non-rejection preparation failures', async () => {
		const preparationFailure = await runExecutionAttempt({
			prepare: async () => { throw new Error('stale stack') },
			isCurrent: () => true,
			assertFunding: async () => undefined,
			submit: async () => '0x01',
		})
		const fundingFailure = await runExecutionAttempt({
			prepare: async () => true,
			isCurrent: () => true,
			assertFunding: async () => { throw new Error('insufficient funds') },
			submit: async () => '0x01',
		})

		assert.equal(preparationFailure.status, 'failed')
		assert.equal(preparationFailure.status === 'failed' && preparationFailure.invalidateVerification, true)
		assert.equal(fundingFailure.status, 'failed')
		assert.equal(fundingFailure.status === 'failed' && fundingFailure.invalidateVerification, false)
	})

	test('keeps verification retryable when the wallet rejects preparation', async () => {
		const result = await runExecutionAttempt({
			prepare: async () => { throw { code: 4001, message: 'User rejected the request.' } },
			isCurrent: () => true,
			assertFunding: async () => undefined,
			submit: async () => '0x01',
		})

		assert.equal(result.status, 'failed')
		assert.equal(result.status === 'failed' && result.invalidateVerification, false)
	})
})

import * as assert from 'assert'
import { describe, test } from 'bun:test'
import { isCurrentStackOperation } from '../src/app/stackOperationState.js'

describe('Sealwort Safe stack async operation state', () => {
	test('accepts completion only for the same revision and stack object', () => {
		const stack = { name: 'stack A' }

		assert.equal(isCurrentStackOperation(4, 4, stack, stack), true)
		assert.equal(isCurrentStackOperation(5, 4, stack, stack), false)
		assert.equal(isCurrentStackOperation(4, 4, { name: 'stack B' }, stack), false)
		assert.equal(isCurrentStackOperation(4, 4, { name: 'stack B' }, undefined), false)
	})
})

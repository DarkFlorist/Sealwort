import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { normalizeRepositoryUrl } from '../scripts/buildMetadata.mjs'

describe('build repository metadata', () => {
	test('normalizes HTTPS and SCP-style Git remotes', () => {
		assert.equal(normalizeRepositoryUrl('https://github.com/example/Sealwort.git'), 'https://github.com/example/Sealwort')
		assert.equal(normalizeRepositoryUrl('git@github.com:example/Sealwort.git'), 'https://github.com/example/Sealwort')
	})

	test('normalizes ssh URLs and repository suffixes before creating web links', () => {
		assert.equal(normalizeRepositoryUrl('ssh://git@github.example:2222/example/Sealwort.git'), 'https://github.example/example/Sealwort')
		assert.equal(normalizeRepositoryUrl('https://github.example/example/Sealwort.git/'), 'https://github.example/example/Sealwort')
	})

	test('rejects unsupported repository URL schemes', () => {
		assert.throws(() => normalizeRepositoryUrl('file:///tmp/Sealwort'), /must use HTTP, HTTPS, or SSH/u)
	})
})

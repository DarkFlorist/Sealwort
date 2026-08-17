import * as assert from 'node:assert'
import { describe, test } from 'bun:test'
import { normalizeRepositoryUrl, resolveBuildMetadata } from '../scripts/buildMetadata.mjs'

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

	test('resolves explicit metadata before GitHub, Git, and package fallbacks', () => {
		const metadata = resolveBuildMetadata({
			SEALWORT_RELEASE: 'v2.0.0',
			SEALWORT_COMMIT_HASH: 'explicit-commit',
			SEALWORT_REPOSITORY_URL: 'https://explicit.example/Sealwort.git',
			GITHUB_REF_TYPE: 'tag',
			GITHUB_REF_NAME: 'v1.0.0',
			GITHUB_SHA: 'github-commit',
			GITHUB_SERVER_URL: 'https://github.example',
			GITHUB_REPOSITORY: 'example/Sealwort',
		}, () => 'git-value', 'https://package.example/Sealwort')

		assert.deepEqual(metadata, { release: 'v2.0.0', commitHash: 'explicit-commit', repositoryUrl: 'https://explicit.example/Sealwort' })
	})

	test('resolves GitHub metadata and only treats tags as releases', () => {
		const metadata = resolveBuildMetadata({
			GITHUB_REF_TYPE: 'branch',
			GITHUB_REF_NAME: 'main',
			GITHUB_SHA: 'github-commit',
			GITHUB_SERVER_URL: 'https://github.example',
			GITHUB_REPOSITORY: 'example/Sealwort',
		}, () => undefined, undefined)

		assert.deepEqual(metadata, { release: undefined, commitHash: 'github-commit', repositoryUrl: 'https://github.example/example/Sealwort' })
	})
})

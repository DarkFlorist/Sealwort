import * as assert from 'node:assert'
import { afterEach, describe, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/preact'
import { BuildInformationLink, getBuildInformation } from '../src/app/buildInformation.js'

afterEach(cleanup)

describe('build information', () => {
	test('links a versioned build to its GitHub release', () => {
		const information = getBuildInformation('v0.2.0', '0123456789abcdef')
		render(<BuildInformationLink information = { information } />)

		const link = screen.getByRole('link', { name: 'Release v0.2.0' })
		assert.equal(link.getAttribute('href'), 'https://github.com/DarkFlorist/Sealwort/releases/tag/v0.2.0')
	})

	test('falls back to a linked abbreviated commit hash', () => {
		const information = getBuildInformation(undefined, '0123456789abcdef')
		render(<BuildInformationLink information = { information } />)

		const link = screen.getByRole('link', { name: 'Commit 0123456' })
		assert.equal(link.getAttribute('href'), 'https://github.com/DarkFlorist/Sealwort/commit/0123456789abcdef')
		assert.equal(link.getAttribute('title'), '0123456789abcdef')
	})
})

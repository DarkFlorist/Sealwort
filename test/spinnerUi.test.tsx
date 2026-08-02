import * as assert from 'node:assert'
import { afterEach, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/preact'
import { LoadingIndicator, Spinner } from '../src/app/Spinner.js'

afterEach(cleanup)

test('the shared loading indicator renders an accessible label and ring', () => {
	render(<LoadingIndicator>Waiting for wallet…</LoadingIndicator>)

	const label = screen.getByText('Waiting for wallet…')
	const spinner = label.parentElement?.querySelector('svg.spinner')
	assert.notEqual(spinner, null)
	assert.equal(spinner?.getAttribute('viewBox'), '0 0 100 100')
	assert.equal(spinner?.querySelector('circle')?.getAttribute('r'), '45')
})

test('a standalone spinner is hidden from assistive technology', () => {
	const { container } = render(<Spinner size = '2em'/>)
	const spinner = container.querySelector('svg.spinner')
	assert.equal(spinner?.getAttribute('aria-hidden'), 'true')
	assert.equal(spinner?.getAttribute('style')?.includes('2em'), true)
})

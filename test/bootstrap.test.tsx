import * as assert from 'node:assert'
import { afterEach, spyOn, test } from 'bun:test'
import { cleanup, screen } from '@testing-library/preact'
import { bootstrapApplication } from '../src/app/bootstrap.js'
import { runBackgroundTask } from '../src/app/unexpectedFailure.js'

afterEach(() => {
	cleanup()
	document.body.replaceChildren()
})

test('keeps the global async failure boundary while ignoring a missing MetaMask provider', async () => {
	const app = document.createElement('div')
	app.id = 'app'
	document.body.append(app)
	bootstrapApplication(undefined)
	const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)

	const providerRejection = new Event('unhandledrejection', { cancelable: true })
	Object.defineProperty(providerRejection, 'reason', {
		value: new Error('Failed to connect to MetaMask', { cause: new Error('MetaMask extension not found') }),
	})
	window.dispatchEvent(providerRejection)

	assert.equal(providerRejection.defaultPrevented, false)
	assert.equal(screen.queryByText('Sealwort encountered an unexpected error'), null)
	assert.notEqual(screen.getByRole('heading', { name: 'Sealwort' }), undefined)
	runBackgroundTask(Promise.reject({
		message: 'Failed to connect to MetaMask',
		cause: new Error('MetaMask extension not found'),
	}))
	await Promise.resolve()
	assert.equal(screen.queryByText('Sealwort encountered an unexpected error'), null)
	assert.equal(consoleError.mock.calls.length, 0)

	const sealwortRejection = new Event('unhandledrejection', { cancelable: true })
	Object.defineProperty(sealwortRejection, 'reason', { value: { reason: 'Unexpected async failure' } })
	window.dispatchEvent(sealwortRejection)

	assert.equal(sealwortRejection.defaultPrevented, true)
	assert.notEqual(await screen.findByText('Sealwort encountered an unexpected error'), undefined)
	assert.equal(consoleError.mock.calls.length, 1)
})

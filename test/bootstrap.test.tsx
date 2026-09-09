import * as assert from 'node:assert'
import { afterEach, spyOn, test } from 'bun:test'
import { cleanup, screen } from '@testing-library/preact'
import { bootstrapApplication } from '../src/app/bootstrap.js'
import { runBackgroundTask } from '../src/app/unexpectedFailure.js'

afterEach(() => {
	cleanup()
	document.body.replaceChildren()
})

test('attributes only registered background task rejections to Sealwort', async () => {
	const app = document.createElement('div')
	app.id = 'app'
	document.body.append(app)
	bootstrapApplication(undefined)

	const providerRejection = new Event('unhandledrejection', { cancelable: true })
	Object.defineProperty(providerRejection, 'reason', {
		value: Object.assign(new Error('MetaMask extension not found'), { stack: 'Error: MetaMask extension not found\n    at connect (inpage.js:7:84292)' }),
	})
	window.dispatchEvent(providerRejection)

	assert.equal(providerRejection.defaultPrevented, false)
	assert.equal(screen.queryByText('Sealwort encountered an unexpected error'), null)
	assert.notEqual(screen.getByRole('heading', { name: 'Sealwort' }), undefined)

	const consoleError = spyOn(console, 'error').mockImplementation(() => undefined)
	runBackgroundTask(Promise.reject({ reason: 'Unexpected async failure' }))

	assert.notEqual(await screen.findByText('Sealwort encountered an unexpected error'), undefined)
	assert.equal(consoleError.mock.calls.length, 1)
})

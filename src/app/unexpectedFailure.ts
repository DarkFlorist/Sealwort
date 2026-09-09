import { signal } from '@preact/signals'
import { isMissingMetaMaskError } from './userFacingErrors.js'

export const unexpectedFailure = signal(false)

export function reportUnexpectedFailure(error: unknown) {
	if (isMissingMetaMaskError(error)) return false
	console.error('Unexpected Sealwort error.', error)
	unexpectedFailure.value = true
	return true
}

export function runBackgroundTask(task: Promise<unknown>) {
	void task.catch(reportUnexpectedFailure)
}

import { signal } from '@preact/signals'

export const unexpectedFailure = signal(false)

export function reportUnexpectedFailure(error: unknown) {
	console.error('Unexpected Sealwort error.', error)
	unexpectedFailure.value = true
}

export function runBackgroundTask(task: Promise<unknown>) {
	void task.catch(reportUnexpectedFailure)
}

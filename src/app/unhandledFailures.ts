import { reportUnexpectedFailure } from './unexpectedFailure.js'
import { isMissingMetaMaskError } from './userFacingErrors.js'

export function handleUnhandledFailure(error: unknown) {
	if (isMissingMetaMaskError(error)) {
		console.warn('Wallet provider unavailable.', error)
		return
	}
	reportUnexpectedFailure(error)
}

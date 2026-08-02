type ErrorRecord = {
	readonly code?: unknown
	readonly message?: unknown
	readonly data?: unknown
	readonly cause?: unknown
}

const isErrorRecord = (value: unknown): value is ErrorRecord => typeof value === 'object' && value !== null

const messageFromRecord = (error: ErrorRecord) => {
	if (typeof error.message === 'string' && error.message.trim().length !== 0) return error.message
	if (isErrorRecord(error.data) && typeof error.data.message === 'string' && error.data.message.trim().length !== 0) return error.data.message
	return undefined
}

function isUserRejectedErrorWithSeen(error: unknown, seen: Set<object>): boolean {
	if (!isErrorRecord(error)) return false
	if (seen.has(error)) return false
	seen.add(error)
	if (error.code === 4001 || error.code === '4001') return true
	const message = messageFromRecord(error)
	if (message !== undefined && /(?:user (?:rejected|denied)|denied by (?:the )?user)/iu.test(message)) return true
	return error.cause === undefined ? false : isUserRejectedErrorWithSeen(error.cause, seen)
}

export function isUserRejectedError(error: unknown): boolean {
	return isUserRejectedErrorWithSeen(error, new Set<object>())
}

export function getUserFacingErrorMessage(error: unknown) {
	if (isUserRejectedError(error)) return 'The wallet request was rejected.'
	if (error instanceof Error && error.message.trim().length !== 0) return error.message
	if (typeof error === 'string' && error.trim().length !== 0) return error
	if (isErrorRecord(error)) {
		const message = messageFromRecord(error)
		if (message !== undefined) return message
	}
	return 'An unexpected error occurred. Try again or reload Sealwort.'
}

export async function readSafeStackFile(file: Pick<File, 'text'>) {
	try {
		return await file.text()
	} catch {
		throw new Error('The selected Gnosis Safe Stack file could not be read. Choose the file again or paste its JSON.')
	}
}

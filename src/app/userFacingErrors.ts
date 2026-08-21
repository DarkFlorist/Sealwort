type ErrorRecord = {
	readonly code?: unknown
	readonly message?: unknown
	readonly data?: unknown
	readonly cause?: unknown
	readonly error?: unknown
	readonly originalError?: unknown
}

const isErrorRecord = (value: unknown): value is ErrorRecord => typeof value === 'object' && value !== null

const messageFromRecord = (error: ErrorRecord) => {
	if (typeof error.message === 'string' && error.message.trim().length !== 0) return error.message
	if (isErrorRecord(error.data) && typeof error.data.message === 'string' && error.data.message.trim().length !== 0) return error.data.message
	return undefined
}

const providerErrorChildren = (error: ErrorRecord) => [error.data, error.cause, error.error, error.originalError]

function nestedProviderMessage(error: unknown, seen: Set<object>): string | undefined {
	if (typeof error === 'string' && error.trim().length !== 0 && !/^0x[\da-f]+$/iu.test(error.trim())) return error
	if (!isErrorRecord(error) || seen.has(error)) return undefined
	seen.add(error)
	for (const child of providerErrorChildren(error)) {
		const message = nestedProviderMessage(child, seen)
		if (message !== undefined) return message
	}
	return messageFromRecord(error)
}

function isUserRejectedErrorWithSeen(error: unknown, seen: Set<object>): boolean {
	if (!isErrorRecord(error)) return false
	if (seen.has(error)) return false
	seen.add(error)
	if (error.code === 4001 || error.code === '4001') return true
	const message = messageFromRecord(error)
	if (message !== undefined && /(?:user (?:rejected|denied)|denied by (?:the )?user)/iu.test(message)) return true
	return providerErrorChildren(error).some((child) => isUserRejectedErrorWithSeen(child, seen))
}

export function isUserRejectedError(error: unknown): boolean {
	return isUserRejectedErrorWithSeen(error, new Set<object>())
}

export function getUserFacingErrorMessage(error: unknown) {
	if (isUserRejectedError(error)) return 'The wallet request was rejected.'
	if (error instanceof Error && error.message.trim().length !== 0) {
		const nestedMessage = nestedProviderMessage(error, new Set<object>())
		return nestedMessage ?? error.message
	}
	if (typeof error === 'string' && error.trim().length !== 0) return error
	if (isErrorRecord(error)) {
		const message = nestedProviderMessage(error, new Set<object>())
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

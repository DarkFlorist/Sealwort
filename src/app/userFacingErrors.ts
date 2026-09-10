import { ChainDiscoveryUnavailableError, type ChainDiscoveryContext } from './chainDiscoveryError.js'

const CHAIN_DISCOVERY_UNAVAILABLE_MESSAGES = {
	'wallet-connection': 'The wallet connection could not be completed. Try connecting again.',
	'stack-verification': 'The wallet network could not be confirmed. Try again.',
} as const satisfies Record<ChainDiscoveryContext, string>

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

function providerErrorValues(error: unknown, seen: Set<object>): readonly unknown[] {
	if (typeof error === 'string') return [error]
	if (!isErrorRecord(error) || seen.has(error)) return []
	seen.add(error)
	return [...providerErrorChildren(error).flatMap((child) => providerErrorValues(child, seen)), error]
}

function providerValueMessage(value: unknown) {
	if (typeof value === 'string' && value.trim().length !== 0 && !/^0x[\da-f]+$/iu.test(value.trim())) return value
	return isErrorRecord(value) ? messageFromRecord(value) : undefined
}

function nestedProviderMessage(error: unknown): string | undefined {
	for (const value of providerErrorValues(error, new Set<object>())) {
		const message = providerValueMessage(value)
		if (message !== undefined) return message
	}
	return undefined
}

export function isUserRejectedError(error: unknown): boolean {
	return providerErrorValues(error, new Set<object>()).some((value) => {
		if (!isErrorRecord(value)) return false
		if (value.code === 4001 || value.code === '4001') return true
		const message = messageFromRecord(value)
		return message !== undefined && /(?:user (?:rejected|denied)|denied by (?:the )?user)/iu.test(message)
	})
}

export function isMissingMetaMaskError(error: unknown): boolean {
	return providerErrorValues(error, new Set<object>()).some((value) => providerValueMessage(value) === 'MetaMask extension not found')
}

export function getUserFacingErrorMessage(error: unknown) {
	if (isUserRejectedError(error)) return 'The wallet request was rejected.'
	if (error instanceof ChainDiscoveryUnavailableError) return CHAIN_DISCOVERY_UNAVAILABLE_MESSAGES[error.context]
	if (error instanceof Error && error.message.trim().length !== 0) {
		const nestedMessage = nestedProviderMessage(error)
		return nestedMessage ?? error.message
	}
	if (typeof error === 'string' && error.trim().length !== 0) return error
	if (isErrorRecord(error)) {
		const message = nestedProviderMessage(error)
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

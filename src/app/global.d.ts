import type { InjectedProvider } from './safeStackValidation.js'

declare global {
	const SEALWORT_RELEASE: string
	const SEALWORT_COMMIT_HASH: string
	const SEALWORT_REPOSITORY_URL: string

	interface Window {
		ethereum?: InjectedProvider
	}
}

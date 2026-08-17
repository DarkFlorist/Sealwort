import type { InjectedProvider } from './safeStackValidation.js'

declare global {
	interface Window {
		ethereum?: InjectedProvider
	}
}

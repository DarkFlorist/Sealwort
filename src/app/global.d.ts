import type { InjectedProvider } from './provider.js'

declare global {
	interface Window {
		ethereum?: InjectedProvider
	}
}

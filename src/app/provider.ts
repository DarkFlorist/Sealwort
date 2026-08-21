export type ProviderRequest = {
	readonly method: string
	readonly params?: readonly unknown[]
}

export type InjectedProvider = {
	request(request: ProviderRequest): Promise<unknown>
	on?(eventName: 'accountsChanged' | 'chainChanged', listener: (value: unknown) => void): void
	removeListener?(eventName: 'accountsChanged' | 'chainChanged', listener: (value: unknown) => void): void
}

import { useSignal } from '@preact/signals'
import * as funtypes from 'funtypes'
import { type ConnectedAccountInformation, inspectConnectedAccount } from './accountInspection.js'
import { type ConnectedSafeBalances, readConnectedSafeBalances } from './accountBalances.js'
import type { ConnectedSafeWalletSigner } from './appTypes.js'
import { EthereumAddress } from './safeStackProtocol.js'
import type { InjectedProvider } from './safeStackValidation.js'
import { getConnectedSafeWalletSigner } from './walletCapabilities.js'
import { readWalletChainId } from './walletConnection.js'

const EthereumAccounts = funtypes.ReadonlyArray(EthereumAddress)

type ConnectedSafeBalanceState = {
	readonly address: bigint
	readonly chainId: bigint
	readonly balances: ConnectedSafeBalances
}

type ConnectedWalletLoadResult = { readonly status: 'connected', readonly account: bigint, readonly chainId: bigint }
type WalletLoadResult =
	| ConnectedWalletLoadResult
	| { readonly status: 'disconnected' }

export function useWalletState() {
	const account = useSignal<bigint | undefined>(undefined)
	const chainId = useSignal<bigint | undefined>(undefined)
	const information = useSignal<ConnectedAccountInformation | undefined>(undefined)
	const informationLoading = useSignal(false)
	const balances = useSignal<ConnectedSafeBalanceState | undefined>(undefined)
	const balancesLoading = useSignal(false)
	const balancesRevision = useSignal(0)
	const revision = useSignal(0)
	const loading = useSignal(window.ethereum?.on !== undefined)
	const safeWalletSigners = useSignal<readonly ConnectedSafeWalletSigner[]>([])
	const safeWalletSignerLoading = useSignal(false)
	const safeWalletSignerRevision = useSignal(0)

	const isCurrent = (operationRevision: number) => revision.peek() === operationRevision

	const resetWalletState = () => {
		account.value = undefined
		chainId.value = undefined
		information.value = undefined
		informationLoading.value = false
		balances.value = undefined
		balancesLoading.value = false
		safeWalletSigners.value = []
		safeWalletSignerLoading.value = false
	}

	const beginLoad = () => {
		const operationRevision = revision.peek() + 1
		revision.value = operationRevision
		resetWalletState()
		loading.value = true
		return operationRevision
	}

	const stopLoading = (operationRevision: number) => {
		if (!isCurrent(operationRevision)) return
		informationLoading.value = false
		balancesLoading.value = false
		loading.value = false
		safeWalletSignerLoading.value = false
	}

	const refreshAccountInformation = async (
		provider: InjectedProvider,
		selectedAccount: bigint | undefined,
		selectedChainId: bigint,
		operationRevision: number,
	) => {
		const balanceOperationRevision = balancesRevision.peek() + 1
		balancesRevision.value = balanceOperationRevision
		balances.value = undefined
		balancesLoading.value = false
		information.value = undefined
		if (selectedAccount === undefined) {
			informationLoading.value = false
			return
		}
		informationLoading.value = true
		try {
			const inspectedAccount = await inspectConnectedAccount(provider, selectedAccount, selectedChainId)
			if (!isCurrent(operationRevision)) return
			if (account.peek() !== selectedAccount || chainId.peek() !== selectedChainId) return
			balancesLoading.value = inspectedAccount.kind === 'safe'
			if (inspectedAccount.kind === 'safe') {
				void readConnectedSafeBalances(provider, selectedAccount, selectedChainId).then((updatedBalances) => {
					if (balancesRevision.peek() !== balanceOperationRevision || !isCurrent(operationRevision)) return
					if (account.peek() !== selectedAccount || chainId.peek() !== selectedChainId) return
					balances.value = { address: selectedAccount, chainId: selectedChainId, balances: updatedBalances }
				}).finally(() => {
					if (balancesRevision.peek() !== balanceOperationRevision || !isCurrent(operationRevision)) return
					if (account.peek() !== selectedAccount || chainId.peek() !== selectedChainId) return
					balancesLoading.value = false
				})
			}
			information.value = inspectedAccount
		} finally {
			if (isCurrent(operationRevision) && account.peek() === selectedAccount && chainId.peek() === selectedChainId) {
				informationLoading.value = false
			}
		}
	}

	const refreshSafeWalletSigner = async (
		provider: InjectedProvider,
		selectedAccount: bigint | undefined,
		selectedChainId: bigint,
		operationRevision: number,
	) => {
		const signerOperationRevision = safeWalletSignerRevision.peek() + 1
		safeWalletSignerRevision.value = signerOperationRevision
		safeWalletSigners.value = []
		safeWalletSignerLoading.value = selectedAccount !== undefined
		if (selectedAccount === undefined) return
		try {
			const signer = await getConnectedSafeWalletSigner(provider, selectedAccount, selectedChainId)
			if (safeWalletSignerRevision.peek() !== signerOperationRevision || !isCurrent(operationRevision)) return
			if (account.peek() !== selectedAccount || chainId.peek() !== selectedChainId) return
			if (signer !== undefined) safeWalletSigners.value = [{ safeAddress: selectedAccount, signer }]
		} finally {
			if (
				safeWalletSignerRevision.peek() === signerOperationRevision
				&& isCurrent(operationRevision)
				&& account.peek() === selectedAccount
				&& chainId.peek() === selectedChainId
			) safeWalletSignerLoading.value = false
		}
	}

	const load = async (
		provider: InjectedProvider,
		operationRevision: number,
		requestAccess: boolean,
	): Promise<WalletLoadResult | undefined> => {
		try {
			const accountsResult = await provider.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' })
			const accounts = EthereumAccounts.parse(accountsResult)
			if (!isCurrent(operationRevision)) return undefined
			const selectedAccount = accounts[0]
			if (requestAccess && selectedAccount === undefined) throw new Error('The wallet did not provide an account.')
			if (selectedAccount === undefined) return { status: 'disconnected' }
			const selectedChainId = await readWalletChainId(provider)
			if (!isCurrent(operationRevision)) return undefined
			account.value = selectedAccount
			chainId.value = selectedChainId
			const accountInformationPromise = refreshAccountInformation(provider, selectedAccount, selectedChainId, operationRevision)
			void refreshSafeWalletSigner(provider, selectedAccount, selectedChainId, operationRevision)
			await accountInformationPromise
			if (!isCurrent(operationRevision)) return undefined
			return { status: 'connected', account: selectedAccount, chainId: selectedChainId }
		} finally {
			if (isCurrent(operationRevision)) loading.value = false
		}
	}

	return {
		account,
		chainId,
		information,
		informationLoading,
		balances,
		balancesLoading,
		loading,
		revision,
		safeWalletSigners,
		safeWalletSignerLoading,
		beginLoad,
		isCurrent,
		load,
		stopLoading,
	}
}

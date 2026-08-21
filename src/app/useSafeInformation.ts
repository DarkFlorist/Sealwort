import { type Signal, useSignal } from '@preact/signals'
import { getNativeAssetSymbol, readNativeAssetBalance } from './accountBalances.js'
import type { SafeInformation } from './appTypes.js'
import type { SafeStackExport } from './safeStackProtocol.js'
import { getSafeReadProvider } from './readProvider.js'
import { readSafeState } from './safeStackValidation.js'
import { isCurrentStackOperation } from './stackOperationState.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { withWalletRequestTimeout } from './walletProvider.js'

export function useSafeInformation(
	stackRevision: Signal<number>,
	stackExport: Signal<SafeStackExport | undefined>,
	ethereumRpcUrl: Signal<string>,
	walletRequestTimeoutMs?: number,
) {
	const information = useSignal<readonly SafeInformation[]>([])
	const informationRevision = useSignal(0)

	const refresh = async (loadedStack: SafeStackExport, operationRevision: number) => {
		if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), loadedStack)) return
		const refreshRevision = informationRevision.peek() + 1
		informationRevision.value = refreshRevision
		information.value = loadedStack.stacks.map((stack) => ({
			chainId: stack.chainId,
			safeAddress: stack.safeAddress,
			loading: true,
			nativeAssetLoading: true,
		}))
		const updateInformation = (stackIndex: number, update: (current: SafeInformation) => SafeInformation) => {
			if (informationRevision.peek() !== refreshRevision) return
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), loadedStack)) return
			information.value = information.peek().map((current, index) => index === stackIndex ? update(current) : current)
		}
		await Promise.all(loadedStack.stacks.map(async (stack, stackIndex) => {
			try {
				const injectedProvider = window.ethereum === undefined
					? undefined
					: withWalletRequestTimeout(window.ethereum, walletRequestTimeoutMs)
				const safeReadProvider = await getSafeReadProvider(stack.chainId, injectedProvider, globalThis.fetch, ethereumRpcUrl.peek())
				updateInformation(stackIndex, (current) => ({ ...current, source: safeReadProvider.source }))
				void readNativeAssetBalance(safeReadProvider.provider, stack.safeAddress, stack.chainId).then((nativeAsset) => {
					updateInformation(stackIndex, (current) => ({ ...current, nativeAssetLoading: false, nativeAsset }))
				}).catch((balanceError) => {
					updateInformation(stackIndex, (current) => ({
						...current,
						nativeAssetLoading: false,
						nativeAsset: {
							symbol: getNativeAssetSymbol(stack.chainId),
							balance: { status: 'unavailable', error: getUserFacingErrorMessage(balanceError) },
						},
					}))
				})
				const state = await readSafeState(safeReadProvider.provider, stack)
				updateInformation(stackIndex, (current) => ({ ...current, loading: false, state }))
			} catch (safeInformationError) {
				updateInformation(stackIndex, (current) => ({
					...current,
					loading: false,
					nativeAssetLoading: current.source === undefined ? false : current.nativeAssetLoading,
					error: getUserFacingErrorMessage(safeInformationError),
				}))
			}
		}))
	}

	return { information, refresh }
}

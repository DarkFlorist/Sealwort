import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getNativeAssetSymbol } from './assetFormatting.js'
import type { ConnectedSafeWalletSigner, ExecutionGasCheck } from './appTypes.js'
import { readSafeExecutionGasFunding } from './safeExecution.js'
import type { SafeStackExport } from './safeStackProtocol.js'
import type { VerifiedSafeState } from './safeStackValidation.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { getExecutionGasFundingDisabledReason } from './uiState.js'
import { withWalletRequestTimeout } from './walletProvider.js'
import { runBackgroundTask } from './unexpectedFailure.js'

export function useExecutionGasChecks(
	stackExport: SafeStackExport | undefined,
	account: bigint | undefined,
	walletChainId: bigint | undefined,
	connectedSafeWalletSigners: readonly ConnectedSafeWalletSigner[],
	verifiedSafeStates: readonly VerifiedSafeState[],
	walletRequestTimeoutMs?: number,
) {
	const checks = useSignal<readonly ExecutionGasCheck[]>([])
	const revision = useSignal(0)

	useEffect(() => {
		const checkRevision = revision.peek() + 1
		revision.value = checkRevision
		const injectedProvider = window.ethereum
		if (injectedProvider === undefined || stackExport === undefined || account === undefined || walletChainId === undefined) {
			checks.value = []
			return
		}
		const provider = withWalletRequestTimeout(injectedProvider, walletRequestTimeoutMs)
		const targets = stackExport.stacks.flatMap((stack, stackIndex) => {
			if (stack.chainId !== walletChainId) return []
			const safeState = verifiedSafeStates[stackIndex]
			if (safeState === undefined) return []
			const executor = account === stack.safeAddress
				? connectedSafeWalletSigners.find(({ safeAddress }) => safeAddress === stack.safeAddress)?.signer
				: account
			if (executor === undefined) return []
			return stack.transactions.flatMap((transaction) => {
				if (transaction.safeTx.message.nonce !== safeState.nonce) return []
				const signatureCount = BigInt(transaction.signatures.length)
				const ready = signatureCount >= safeState.threshold
				const connectedAccountCanSign = account === stack.safeAddress || safeState.owners.includes(account)
				const signerCanComplete = connectedAccountCanSign
					&& !transaction.signatures.some(({ signer }) => signer === executor)
					&& signatureCount + 1n >= safeState.threshold
				if (!ready && !signerCanComplete) return []
				return [{ stack, transaction, executor, prevalidatedSigner: ready ? undefined : executor }]
			})
		})
		checks.value = targets.map(({ transaction }) => ({ safeTxHash: transaction.safeTxHash, status: 'loading' }))
		runBackgroundTask(Promise.all(targets.map(async ({ stack, transaction, executor, prevalidatedSigner }): Promise<ExecutionGasCheck> => {
			try {
				const funding = await readSafeExecutionGasFunding(provider, executor, stack.safeAddress, transaction, prevalidatedSigner)
				return {
					safeTxHash: transaction.safeTxHash,
					status: 'complete',
					disabledReason: getExecutionGasFundingDisabledReason(funding, getNativeAssetSymbol(stack.chainId)),
				}
			} catch (gasCheckError) {
				return {
					safeTxHash: transaction.safeTxHash,
					status: 'complete',
					disabledReason: `Sealwort could not confirm that the active signer can pay the execution gas: ${ getUserFacingErrorMessage(gasCheckError) }`,
				}
			}
		})).then((updatedChecks) => {
			if (revision.peek() !== checkRevision) return
			checks.value = updatedChecks
		}))
	}, [stackExport, account, walletChainId, connectedSafeWalletSigners, verifiedSafeStates, walletRequestTimeoutMs])

	return checks
}

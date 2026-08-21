import type { Signal } from '@preact/signals'
import * as funtypes from 'funtypes'
import type { ConnectedAccountInformation } from './accountInspection.js'
import { getNativeAssetSymbol } from './assetFormatting.js'
import { CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE, type ConnectedSafeWalletSigner, type PendingAction, type SubmittedExecution, type TransactionActionError } from './appTypes.js'
import { addressString, checksummedAddress } from './ethereum.js'
import { type ExecutionAttemptResult, runExecutionAttempt } from './executionAttempt.js'
import type { InjectedProvider } from './provider.js'
import { normalizeSafeSignature, recoverSafeSignatureOwner, safeTxToTypedDataJson } from './safeProtocol.js'
import { readSafeExecutionGasFunding, submitSafeExecution } from './safeExecution.js'
import { SafeStackExport, type SafeStackTransaction } from './safeStackProtocol.js'
import { assertProviderEoaOwner, assertReturnedSafeOwner, getFreshSigningAccount, getSafeSigningAccountMode, type VerifiedSafeState, validateSafeStackAtCurrentNonce } from './safeStackValidation.js'
import { isCurrentStackOperation } from './stackOperationState.js'
import { clearTransactionActionError, hasSubmittedExecution, recordSubmittedExecution, setTransactionActionError } from './transactionActionState.js'
import { getExecutionGasFundingDisabledReason } from './uiState.js'
import { getUserFacingErrorMessage, isUserRejectedError } from './userFacingErrors.js'
import { getConnectedSafeWalletDuplicateSignerMessage, getConnectedSafeWalletSigner } from './walletCapabilities.js'
import { withWalletRequestTimeout } from './walletProvider.js'

async function getProvider(walletRequestTimeoutMs: number | undefined) {
	if (window.ethereum === undefined) throw new Error('No injected Ethereum wallet was found.')
	return withWalletRequestTimeout(window.ethereum, walletRequestTimeoutMs)
}

async function assertExecutionGasFunding(
	provider: InjectedProvider,
	executor: bigint,
	safeAddress: bigint,
	transaction: Parameters<typeof readSafeExecutionGasFunding>[3],
	nativeAssetSymbol: string,
	prevalidatedSigner: bigint | undefined = undefined,
) {
	const funding = await readSafeExecutionGasFunding(provider, executor, safeAddress, transaction, prevalidatedSigner)
	const disabledReason = getExecutionGasFundingDisabledReason(funding, nativeAssetSymbol)
	if (disabledReason !== undefined) throw new Error(disabledReason)
}

function assertTransactionReadyForExecution(
	transaction: SafeStackTransaction,
	safeState: VerifiedSafeState,
	additionalSignatures = 0n,
) {
	if (BigInt(transaction.signatures.length) + additionalSignatures < safeState.threshold) {
		throw new Error('This transaction still needs more Gnosis Safe owner signatures before execution.')
	}
	if (transaction.safeTx.message.nonce !== safeState.nonce) {
		throw new Error('Execute earlier Gnosis Safe transactions before this nonce.')
	}
}

export function createTransactionActions({
	persistStackText,
	stackExport,
	stackVerified,
	verifiedSafeStates,
	account,
	accountInformation,
	stackRevision,
	connectedSafeWalletSigners,
	pendingAction,
	status,
	error,
	signedStackJson,
	submittedExecutions,
	transactionActionErrors,
	walletRequestTimeoutMs,
}: {
	readonly persistStackText: (text: string) => void
	readonly stackExport: Signal<SafeStackExport | undefined>
	readonly stackVerified: Signal<boolean>
	readonly verifiedSafeStates: Signal<readonly VerifiedSafeState[]>
	readonly account: Signal<bigint | undefined>
	readonly accountInformation: Signal<ConnectedAccountInformation | undefined>
	readonly stackRevision: Signal<number>
	readonly connectedSafeWalletSigners: Signal<readonly ConnectedSafeWalletSigner[]>
	readonly pendingAction: Signal<PendingAction | undefined>
	readonly status: Signal<string | undefined>
	readonly error: Signal<string | undefined>
	readonly signedStackJson: Signal<string | undefined>
	readonly submittedExecutions: Signal<readonly SubmittedExecution[]>
	readonly transactionActionErrors: Signal<readonly TransactionActionError[]>
	readonly walletRequestTimeoutMs: number | undefined
}) {
	const finishPendingAction = (action: PendingAction) => {
		if (pendingAction.peek() === action) pendingAction.value = undefined
	}

	const handleExecutionFailure = (
		result: ExecutionAttemptResult<unknown>,
		safeTxHash: bigint,
		clearGlobalMessages = false,
	) => {
		if (result.status !== 'failed') return
		if (result.invalidateVerification) {
			stackVerified.value = false
			verifiedSafeStates.value = []
		}
		if (clearGlobalMessages) {
			status.value = undefined
			error.value = undefined
		}
		setTransactionActionError(transactionActionErrors, safeTxHash, getUserFacingErrorMessage(result.error))
	}

	const readExecutableSafeStates = async (
		provider: InjectedProvider,
		currentExport: SafeStackExport,
		stackIndex: number,
		transaction: SafeStackTransaction,
	) => {
		const safeStates = await validateSafeStackAtCurrentNonce(provider, currentExport)
		const safeState = safeStates[stackIndex]
		if (safeState === undefined) throw new Error('The selected Gnosis Safe stack could not be verified for execution.')
		assertTransactionReadyForExecution(transaction, safeState)
		return safeStates
	}

	const signTransaction = async (stackIndex: number, transactionIndex: number, executeAfterSigning: boolean) => {
		const currentExport = stackExport.peek()
		const currentAccount = account.peek()
		const stack = currentExport?.stacks[stackIndex]
		const transaction = stack?.transactions[transactionIndex]
		if (currentExport === undefined || stack === undefined || transaction === undefined) return
		const operationRevision = stackRevision.peek()
		if (currentAccount === undefined) {
			setTransactionActionError(transactionActionErrors, transaction.safeTxHash, 'Connect the owner wallet before signing.')
			return
		}
		if (!stackVerified.peek()) {
			setTransactionActionError(transactionActionErrors, transaction.safeTxHash, 'Verify this Gnosis Safe stack against the current wallet network before signing.')
			return
		}
		const action = executeAfterSigning
			? `sign-and-execute:${ stackIndex }:${ transactionIndex }` as const
			: `sign:${ stackIndex }:${ transactionIndex }` as const
		try {
			pendingAction.value = action
			clearTransactionActionError(transactionActionErrors, transaction.safeTxHash)
			error.value = undefined
			const provider = await getProvider(walletRequestTimeoutMs)
			const currentSafeStates = await validateSafeStackAtCurrentNonce(provider, currentExport)
			const safeState = currentSafeStates[stackIndex]
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport)) return
			if (safeState === undefined) throw new Error('The selected Gnosis Safe stack could not be verified.')
			const freshAccount = await getFreshSigningAccount(provider, currentAccount)
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport)) return
			account.value = freshAccount
			const signingAccountMode = getSafeSigningAccountMode(stack.safeAddress, safeState.owners, freshAccount)
			if (signingAccountMode === 'owner') await assertProviderEoaOwner(provider, freshAccount)
			const advertisedRouteSigner = signingAccountMode === 'owner'
				? freshAccount
				: connectedSafeWalletSigners.peek().find(({ safeAddress }) => safeAddress === stack.safeAddress)?.signer
			if (advertisedRouteSigner !== undefined && transaction.signatures.some(({ signer }) => signer === advertisedRouteSigner)) {
				throw new Error(`The active owner ${ checksummedAddress(advertisedRouteSigner) } already signed this transaction.`)
			}
			if (executeAfterSigning && signingAccountMode === 'connected-safe-wallet') {
				const executionResult = await runExecutionAttempt({
					prepare: async () => {
						const activeSigner = await getConnectedSafeWalletSigner(provider, freshAccount, stack.chainId)
						if (activeSigner === undefined) throw new Error(CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE)
						const duplicateSignerMessage = getConnectedSafeWalletDuplicateSignerMessage(
							transaction.signatures.map(({ signer }) => signer),
							activeSigner,
						)
						if (duplicateSignerMessage !== undefined) throw new Error(duplicateSignerMessage)
						assertTransactionReadyForExecution(transaction, safeState, 1n)
						return { activeSigner }
					},
					isCurrent: () => isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport),
					assertFunding: async ({ activeSigner }) => await assertExecutionGasFunding(provider, activeSigner, stack.safeAddress, transaction, getNativeAssetSymbol(stack.chainId), activeSigner),
					submit: async () => await submitSafeExecution(provider, freshAccount, stack.safeAddress, transaction),
				})
				if (executionResult.status === 'submitted') {
					connectedSafeWalletSigners.value = [{ safeAddress: stack.safeAddress, signer: executionResult.preparation.activeSigner }]
					recordSubmittedExecution(submittedExecutions, transaction.safeTxHash, executionResult.transactionHash)
					verifiedSafeStates.value = currentSafeStates
					status.value = undefined
				} else handleExecutionFailure(executionResult, transaction.safeTxHash)
				return
			}

			const signature = funtypes.String.parse(await provider.request({
				method: 'eth_signTypedData_v4',
				params: [addressString(freshAccount), safeTxToTypedDataJson(transaction.safeTx)],
			}))
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport)) return
			const recoveredOwner = await recoverSafeSignatureOwner(transaction.safeTxHash, signature)
			assertReturnedSafeOwner(signingAccountMode, safeState.owners, freshAccount, recoveredOwner)
			if (signingAccountMode === 'connected-safe-wallet') await assertProviderEoaOwner(provider, recoveredOwner)
			if (transaction.signatures.some(({ signer }) => signer === recoveredOwner)) {
				throw new Error(`The active owner ${ checksummedAddress(recoveredOwner) } already signed this transaction.`)
			}
			if (signingAccountMode === 'connected-safe-wallet') {
				connectedSafeWalletSigners.value = [
					...connectedSafeWalletSigners.peek().filter(({ safeAddress }) => safeAddress !== stack.safeAddress),
					{ safeAddress: stack.safeAddress, signer: recoveredOwner },
				]
			}
			const updatedTransaction = {
				...transaction,
				signatures: [...transaction.signatures, {
					signer: recoveredOwner,
					signature: normalizeSafeSignature(signature),
				}],
			}
			const updatedStack = {
				...stack,
				safeVersion: safeState.version,
				threshold: safeState.threshold,
				transactions: stack.transactions.map((entry, index) => index === transactionIndex ? updatedTransaction : entry),
			}
			const updatedExport = {
				...currentExport,
				stacks: currentExport.stacks.map((entry, index) => index === stackIndex ? updatedStack : entry),
			}
			stackExport.value = updatedExport
			signedStackJson.value = JSON.stringify(SafeStackExport.serialize(updatedExport), undefined, '\t')
			persistStackText(signedStackJson.value)
			verifiedSafeStates.value = currentSafeStates
			stackVerified.value = true
			const signatureStatus = `Signature from ${ checksummedAddress(recoveredOwner) } added for Gnosis Safe nonce ${ transaction.safeTx.message.nonce.toString() }.`
			status.value = `${ signatureStatus } The updated stack is ready below.`
			if (executeAfterSigning) {
				const executionResult = await runExecutionAttempt({
					prepare: async () => {
						const executionSafeStates = await readExecutableSafeStates(provider, updatedExport, stackIndex, updatedTransaction)
						const executionAccount = await getFreshSigningAccount(provider, freshAccount)
						return { executionAccount, executionSafeStates }
					},
					isCurrent: () => isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), updatedExport),
					assertFunding: async ({ executionAccount }) => await assertExecutionGasFunding(provider, executionAccount, stack.safeAddress, updatedTransaction, getNativeAssetSymbol(stack.chainId)),
					submit: async ({ executionAccount }) => await submitSafeExecution(provider, executionAccount, stack.safeAddress, updatedTransaction),
				})
				if (executionResult.status === 'submitted') {
					recordSubmittedExecution(submittedExecutions, updatedTransaction.safeTxHash, executionResult.transactionHash)
					verifiedSafeStates.value = executionResult.preparation.executionSafeStates
					status.value = signatureStatus
				} else handleExecutionFailure(executionResult, transaction.safeTxHash)
			}
		} catch (signError) {
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport)) return
			if (!isUserRejectedError(signError)) {
				stackVerified.value = false
				verifiedSafeStates.value = []
			}
			status.value = undefined
			error.value = undefined
			setTransactionActionError(transactionActionErrors, transaction.safeTxHash, getUserFacingErrorMessage(signError))
		} finally {
			if (stackRevision.peek() === operationRevision) finishPendingAction(action)
		}
	}

	const executeTransaction = async (stackIndex: number, transactionIndex: number) => {
		const currentExport = stackExport.peek()
		const currentAccount = account.peek()
		const stack = currentExport?.stacks[stackIndex]
		const transaction = stack?.transactions[transactionIndex]
		if (currentExport === undefined || stack === undefined || transaction === undefined) return
		const operationRevision = stackRevision.peek()
		if (currentAccount === undefined) {
			setTransactionActionError(transactionActionErrors, transaction.safeTxHash, 'Connect an EOA wallet before executing this Gnosis Safe transaction.')
			return
		}
		if (hasSubmittedExecution(submittedExecutions, transaction.safeTxHash)) return
		const action = `execute:${ stackIndex }:${ transactionIndex }` as const
		try {
			pendingAction.value = action
			clearTransactionActionError(transactionActionErrors, transaction.safeTxHash)
			error.value = undefined
			const provider = await getProvider(walletRequestTimeoutMs)
			const executionResult = await runExecutionAttempt({
				prepare: async () => {
					const currentSafeStates = await readExecutableSafeStates(provider, currentExport, stackIndex, transaction)
					const freshAccount = await getFreshSigningAccount(provider, currentAccount)
					const executionThroughConnectedSafeWallet = freshAccount === stack.safeAddress
					if (accountInformation.peek()?.kind !== 'eoa' && !executionThroughConnectedSafeWallet) {
						throw new Error('Switch to an EOA wallet account or a connected Safe wallet to submit the execution transaction.')
					}
					const executionGasPayer = executionThroughConnectedSafeWallet
						? connectedSafeWalletSigners.peek().find(({ safeAddress }) => safeAddress === stack.safeAddress)?.signer
						: freshAccount
					if (executionGasPayer === undefined) throw new Error('The connected Safe wallet has not exposed an active signer for the execution gas check.')
					return { currentSafeStates, executionGasPayer, freshAccount }
				},
				isCurrent: () => isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport),
				assertFunding: async ({ executionGasPayer }) => await assertExecutionGasFunding(provider, executionGasPayer, stack.safeAddress, transaction, getNativeAssetSymbol(stack.chainId)),
				submit: async ({ freshAccount }) => await submitSafeExecution(provider, freshAccount, stack.safeAddress, transaction),
			})
			if (executionResult.status === 'cancelled') return
			if (executionResult.status === 'failed') {
				handleExecutionFailure(executionResult, transaction.safeTxHash, true)
				return
			}
			account.value = executionResult.preparation.freshAccount
			recordSubmittedExecution(submittedExecutions, transaction.safeTxHash, executionResult.transactionHash)
			verifiedSafeStates.value = executionResult.preparation.currentSafeStates
			stackVerified.value = true
			status.value = undefined
		} catch (executionError) {
			if (!isCurrentStackOperation(stackRevision.peek(), operationRevision, stackExport.peek(), currentExport)) return
			status.value = undefined
			error.value = undefined
			setTransactionActionError(transactionActionErrors, transaction.safeTxHash, getUserFacingErrorMessage(executionError))
		} finally {
			if (stackRevision.peek() === operationRevision) finishPendingAction(action)
		}
	}

	return { executeTransaction, signTransaction }
}

import type { ConnectedAccountInformation } from '../accountInspection.js'
import { getStackAccountCompatibility } from '../accountInspection.js'
import { formatTokenBalance, getNativeAssetSymbol, getPreferredNativeAssetBalance, type ConnectedSafeBalances } from '../accountBalances.js'
import { type ExecutionGasCheck, type PendingAction, type SafeInformation, type TransactionActionError, CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE } from '../appTypes.js'
import { checksummedAddress, dataStringWith0xStart } from '../ethereum.js'
import type { SafeTransactionStack } from '../safeStackProtocol.js'
import { hasSafeSignatureFromCurrentRoute, type VerifiedSafeState } from '../safeStackValidation.js'
import { LoadingIndicator } from '../Spinner.js'
import { getExecutionDisabledReason, getNativeTransferDisabledReason, getSignatureDisabledReason } from '../uiState.js'
import { getConnectedSafeWalletDuplicateSignerMessage } from '../walletCapabilities.js'

function SafeStateDetails({ state, source }: { readonly state: VerifiedSafeState, readonly source: string | undefined }) {
	return <dl class = 'details safe-details'>
		{ source === undefined ? <></> : <><dt>Source</dt><dd>{ source }</dd></> }
		<dt>Version</dt><dd>{ state.version }</dd>
		<dt>Nonce</dt><dd>{ state.nonce.toString() }</dd>
		<dt>Threshold</dt><dd>{ state.threshold.toString() }/{ state.owners.length.toString() }</dd>
		<dt>Owners</dt><dd class = 'owner-list'>{ state.owners.map((owner) => <code key = { owner.toString() }>{ checksummedAddress(owner) }</code>) }</dd>
	</dl>
}

export function SafeStackPanel({
	stack,
	stackIndex,
	account,
	walletChainId,
	accountInformation,
	routedSigner,
	currentSafeInformation,
	currentConnectedSafeBalances,
	accountInformationLoading,
	connectedSafeBalancesLoading,
	stackVerificationLoading,
	stackVerified,
	verifiedSafeState,
	executionGasChecks,
	pendingAction,
	busy,
	submittedExecutionHashes,
	transactionActionErrors,
	onSign,
	onExecute,
}: {
	readonly stack: SafeTransactionStack
	readonly stackIndex: number
	readonly account: bigint | undefined
	readonly walletChainId: bigint | undefined
	readonly accountInformation: ConnectedAccountInformation | undefined
	readonly routedSigner: bigint | undefined
	readonly currentSafeInformation: SafeInformation | undefined
	readonly currentConnectedSafeBalances: ConnectedSafeBalances | undefined
	readonly accountInformationLoading: boolean
	readonly connectedSafeBalancesLoading: boolean
	readonly stackVerificationLoading: boolean
	readonly stackVerified: boolean
	readonly verifiedSafeState: VerifiedSafeState | undefined
	readonly executionGasChecks: readonly ExecutionGasCheck[]
	readonly pendingAction: PendingAction | undefined
	readonly busy: boolean
	readonly submittedExecutionHashes: readonly bigint[]
	readonly transactionActionErrors: readonly TransactionActionError[]
	readonly onSign: (transactionIndex: number, executeAfterSigning: boolean) => void
	readonly onExecute: (transactionIndex: number) => void
}) {
	const usingConnectedSafeWallet = account === stack.safeAddress
	const nativeAssetSymbol = getNativeAssetSymbol(stack.chainId)
	const connectedSafeWalletCanExecute = usingConnectedSafeWallet && routedSigner !== undefined
	const connectedSafeWalletExecutionUnavailableReason = usingConnectedSafeWallet && !connectedSafeWalletCanExecute
		? CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE
		: undefined
	const transactionNativeAsset = getPreferredNativeAssetBalance(
		currentSafeInformation?.nativeAsset,
		usingConnectedSafeWallet ? currentConnectedSafeBalances?.native : undefined,
	)
	const stackAccountCompatibility = getStackAccountCompatibility(accountInformation, stack, currentSafeInformation?.state)
	return <section class = 'panel'>
		<div class = 'stack-header'>
			<div><p class = 'eyebrow'>Chain { stack.chainId.toString() } · Gnosis Safe { stack.safeVersion }</p><h2 class = 'address'>{ checksummedAddress(stack.safeAddress) }</h2></div>
			<div><span class = 'badge'>{ stack.threshold.toString() } signature{ stack.threshold === 1n ? '' : 's' } required</span></div>
		</div>
		{ usingConnectedSafeWallet ? <p class = 'signer-route-note'>This connected Safe wallet exposes the Gnosis Safe address and can route signatures and completed executions through its configured signer.</p> : <></> }
		<section class = 'safe-information' aria-live = 'polite' aria-busy = { currentSafeInformation === undefined || currentSafeInformation.loading }>
			<h3>Current Gnosis Safe information</h3>
			{ currentSafeInformation === undefined || currentSafeInformation.loading
				? <p class = 'muted' role = 'status'><LoadingIndicator>Retrieving current Gnosis Safe information…</LoadingIndicator></p>
				: currentSafeInformation.state === undefined
					? <>{ currentSafeInformation.source === undefined ? <></> : <p class = 'meta'>Source: { currentSafeInformation.source }</p> }<p class = 'safe-information-error'>{ currentSafeInformation.error ?? 'Current Gnosis Safe information is unavailable.' }</p></>
					: <SafeStateDetails state = { currentSafeInformation.state } source = { currentSafeInformation.source }/> }
		</section>
		{ stackAccountCompatibility?.status === 'mismatch' ? <p class = 'account-compatibility mismatch' role = 'alert'>{ stackAccountCompatibility.message }</p> : <></> }
		<div class = 'transactions'>{ stack.transactions.map((transaction, transactionIndex) => {
			const signatureCount = transaction.signatures.length
			const ready = BigInt(signatureCount) >= stack.threshold
			const signAction = `sign:${ stackIndex }:${ transactionIndex }` as const
			const signAndExecuteAction = `sign-and-execute:${ stackIndex }:${ transactionIndex }` as const
			const executeAction = `execute:${ stackIndex }:${ transactionIndex }` as const
			const signedByCurrentRoute = hasSafeSignatureFromCurrentRoute(transaction.signatures.map(({ signer }) => signer), account, routedSigner)
			const submittedExecution = submittedExecutionHashes.includes(transaction.safeTxHash)
			const connectedAccountCanSign = account !== undefined && (account === stack.safeAddress || verifiedSafeState?.owners.some((owner) => owner === account) === true)
			const matchingConnectedSafeBalanceLoading = usingConnectedSafeWallet && (accountInformationLoading || connectedSafeBalancesLoading) && transactionNativeAsset?.balance.status !== 'available'
			const safeDataLoading = stackVerificationLoading || currentSafeInformation === undefined || currentSafeInformation.loading
			const nativeAssetLoading = transaction.safeTx.message.value !== 0n
				&& transactionNativeAsset?.balance.status !== 'available'
				&& (currentSafeInformation?.nativeAssetLoading === true || matchingConnectedSafeBalanceLoading)
			const signatureDisabledReason = safeDataLoading ? 'Loading current Gnosis Safe information…' : getSignatureDisabledReason({
				connectedAccount: account,
				walletChainId,
				safeChainId: stack.chainId,
				safeVerified: stackVerified && verifiedSafeState !== undefined,
				safeNonce: verifiedSafeState?.nonce,
				transactionNonce: transaction.safeTx.message.nonce,
				connectedAccountCanSign,
			})
			const duplicateSignerMessage = usingConnectedSafeWallet ? getConnectedSafeWalletDuplicateSignerMessage(transaction.signatures.map(({ signer }) => signer), routedSigner) : undefined
			const alreadySignedReason = !ready && signedByCurrentRoute ? duplicateSignerMessage ?? 'The connected owner already signed this transaction.' : undefined
			const signatureActionDisabledReason = signatureDisabledReason ?? alreadySignedReason
			const finalSignatureNeeded = !ready && !signedByCurrentRoute && BigInt(signatureCount) + 1n >= stack.threshold
			const earlierTransactionValue = verifiedSafeState === undefined ? 0n : stack.transactions.reduce((value, earlierTransaction) => {
				const nonce = earlierTransaction.safeTx.message.nonce
				return nonce < verifiedSafeState.nonce || nonce >= transaction.safeTx.message.nonce ? value : value + earlierTransaction.safeTx.message.value
			}, 0n)
			const nativeTransferDisabledReason = safeDataLoading
				? undefined
				: nativeAssetLoading
					? `Loading the Gnosis Safe vault’s ${ transactionNativeAsset?.symbol ?? nativeAssetSymbol } balance…`
					: getNativeTransferDisabledReason({
						balance: transactionNativeAsset?.balance,
						symbol: transactionNativeAsset?.symbol ?? nativeAssetSymbol,
						earlierTransactionValue,
						transactionValue: transaction.safeTx.message.value,
					})
			const executionGasCheck = executionGasChecks.find(({ safeTxHash }) => safeTxHash === transaction.safeTxHash)
			const pendingExecutionGasCheckReason = executionGasCheck === undefined || executionGasCheck.status === 'loading' ? 'Checking the active signer’s balance and estimated execution gas…' : executionGasCheck.disabledReason
			const signAndExecuteDisabledReason = signatureActionDisabledReason
				?? connectedSafeWalletExecutionUnavailableReason
				?? (accountInformation?.kind === 'eoa' || connectedSafeWalletCanExecute ? undefined : 'Connect a Gnosis Safe EOA owner or a connected Safe wallet to sign and execute this transaction.')
				?? (verifiedSafeState?.nonce === transaction.safeTx.message.nonce ? undefined : 'Execute earlier Gnosis Safe transactions before this nonce.')
				?? duplicateSignerMessage
				?? nativeTransferDisabledReason
				?? (finalSignatureNeeded ? pendingExecutionGasCheckReason : undefined)
			const executionPrerequisiteDisabledReason = safeDataLoading ? 'Loading current Gnosis Safe information…' : connectedSafeWalletExecutionUnavailableReason ?? getExecutionDisabledReason({
				connectedAccount: account,
				connectedAccountCanExecute: accountInformation?.kind === 'eoa' || connectedSafeWalletCanExecute,
				walletChainId,
				safeChainId: stack.chainId,
				safeVerified: stackVerified && verifiedSafeState !== undefined,
				safeNonce: verifiedSafeState?.nonce,
				transactionNonce: transaction.safeTx.message.nonce,
				signatureCount,
				threshold: stack.threshold,
			})
			const executionGasDisabledReason = !ready || executionPrerequisiteDisabledReason !== undefined ? undefined : pendingExecutionGasCheckReason
			const executionDisabledReason = executionPrerequisiteDisabledReason ?? nativeTransferDisabledReason ?? executionGasDisabledReason
			const actionDisabledReason = ready ? executionDisabledReason : signatureActionDisabledReason
			const actionExplanationId = `action-explanation-${ stackIndex }-${ transactionIndex }`
			const transactionActionError = transactionActionErrors.find(({ safeTxHash }) => safeTxHash === transaction.safeTxHash)?.message
			const actionErrorId = `action-error-${ stackIndex }-${ transactionIndex }`
			const executionFundingReasonId = `execution-funding-reason-${ stackIndex }-${ transactionIndex }`
			const visibleExecutionFundingReason = ready ? nativeTransferDisabledReason ?? executionGasDisabledReason : finalSignatureNeeded ? nativeTransferDisabledReason ?? pendingExecutionGasCheckReason : undefined
			const executionFundingCheckLoading = visibleExecutionFundingReason === pendingExecutionGasCheckReason && (executionGasCheck === undefined || executionGasCheck.status === 'loading')
			const executionFundingLoading = executionFundingCheckLoading || visibleExecutionFundingReason === nativeTransferDisabledReason && nativeAssetLoading
			const actionExplanation = ready ? executionPrerequisiteDisabledReason : alreadySignedReason ?? (finalSignatureNeeded
				? signatureDisabledReason ?? (usingConnectedSafeWallet ? undefined : 'Your signature will satisfy the threshold. You can add it to the stack or sign and execute the transaction immediately.')
				: signatureDisabledReason ?? 'Review every field before asking your wallet to sign.')
			const actionDescriptionIds = [actionExplanation === undefined ? undefined : actionExplanationId, transactionActionError === undefined ? undefined : actionErrorId].filter((value) => value !== undefined)
			const actionDescription = actionDescriptionIds.length === 0 ? undefined : actionDescriptionIds.join(' ')
			const executionDescriptionIds = [...actionDescriptionIds, visibleExecutionFundingReason === undefined ? undefined : executionFundingReasonId].filter((value) => value !== undefined)
			const executionDescription = executionDescriptionIds.length === 0 ? undefined : executionDescriptionIds.join(' ')
			return <article class = 'transaction' key = { transaction.safeTxHash.toString() }>
				<div class = 'transaction-header'><div><h3>Gnosis Safe Transaction { transaction.safeTx.message.nonce.toString() }</h3><p class = 'meta'>{ transaction.websiteOrigin }</p></div><span class = { `badge${ ready ? '' : ' pending' }` }>{ signatureCount } / { stack.threshold.toString() } signatures</span></div>
				<dl class = 'details'>
					<dt>Nonce</dt><dd>{ transaction.safeTx.message.nonce.toString() }</dd>
					<dt>Destination</dt><dd class = 'address'>{ checksummedAddress(transaction.safeTx.message.to) }</dd>
					<dt>Value</dt><dd>{ formatTokenBalance(transaction.safeTx.message.value, 18) } { nativeAssetSymbol }</dd>
					<dt>Data</dt><dd class = 'address'>{ dataStringWith0xStart(transaction.safeTx.message.data) }</dd>
					<dt>Gnosis Safe tx hash</dt><dd class = 'address'>{ `0x${ transaction.safeTxHash.toString(16).padStart(64, '0') }` }</dd>
					<dt>Signed owners</dt><dd>{ transaction.signatures.length === 0 ? 'None' : transaction.signatures.map(({ signer }) => checksummedAddress(signer)).join(', ') }</dd>
				</dl>
				<div class = 'transaction-actions'>
					{ actionExplanation === undefined ? <></> : <p class = { actionDisabledReason === undefined ? 'muted' : 'signing-explanation' } id = { actionExplanationId }>{ safeDataLoading ? <LoadingIndicator>{ actionExplanation }</LoadingIndicator> : actionExplanation }</p> }
					<div class = 'transaction-action-control'><div class = 'transaction-action-buttons'>
						<button aria-busy = { pendingAction === executeAction || pendingAction === signAction } disabled = { busy || submittedExecution || actionDisabledReason !== undefined } aria-describedby = { ready ? executionDescription : actionDescription } title = { actionDisabledReason } onClick = { () => { ready ? onExecute(transactionIndex) : onSign(transactionIndex, false) } }>
							{ ready ? pendingAction === executeAction ? <LoadingIndicator>Confirm execution…</LoadingIndicator> : submittedExecution ? 'Execution submitted' : 'Execute transaction' : pendingAction === signAction ? <LoadingIndicator>Waiting for wallet…</LoadingIndicator> : signedByCurrentRoute ? 'Already signed' : 'Add my signature' }
						</button>
						{ finalSignatureNeeded ? <button aria-busy = { pendingAction === signAndExecuteAction } disabled = { busy || signAndExecuteDisabledReason !== undefined } aria-describedby = { executionDescription } title = { signAndExecuteDisabledReason } onClick = { () => { onSign(transactionIndex, true) } }>
							{ pendingAction === signAndExecuteAction ? <LoadingIndicator>{ usingConnectedSafeWallet ? 'Confirm execution…' : 'Confirm signature and execution…' }</LoadingIndicator> : usingConnectedSafeWallet ? 'Execute through connected Safe wallet' : 'Sign and execute' }
						</button> : <></> }
					</div>
					{ visibleExecutionFundingReason === undefined ? <></> : <p class = 'transaction-action-disabled-reason' id = { executionFundingReasonId }>{ executionFundingLoading ? <LoadingIndicator>{ visibleExecutionFundingReason }</LoadingIndicator> : visibleExecutionFundingReason }</p> }
					{ transactionActionError === undefined ? <></> : <p class = 'transaction-action-error' id = { actionErrorId } role = 'alert'>{ transactionActionError }</p> }
					</div>
				</div>
			</article>
		}) }</div>
	</section>
}

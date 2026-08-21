import type { ConnectedAccountInformation } from '../accountInspection.js'
import { getStackAccountCompatibility } from '../accountInspection.js'
import { getPreferredNativeAssetBalance, type ConnectedSafeBalances } from '../accountBalances.js'
import { formatTokenBalance, getNativeAssetSymbol } from '../assetFormatting.js'
import { type ExecutionGasCheck, type PendingAction, type SafeInformation, type SubmittedExecution, type TransactionActionError, CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE } from '../appTypes.js'
import { identifiedAddress } from '../addressLabels.js'
import type { SafeTransactionStack } from '../safeStackProtocol.js'
import { hasSafeSignatureFromCurrentRoute, type VerifiedSafeState } from '../safeStackValidation.js'
import { LoadingIndicator } from '../Spinner.js'
import { getExecutionDisabledReason, getNativeTransferDisabledReason, getSignatureDisabledReason, getVisibleExecutionFundingReason } from '../uiState.js'
import { getConnectedSafeWalletDuplicateSignerMessage } from '../walletCapabilities.js'
import { TransactionDataDetails } from './TransactionDataDetails.js'
import type { TransactionDataMetadataResult } from '../useTransactionDataMetadata.js'

function getSafeInformationSourceLabel(source: NonNullable<SafeInformation['source']>) {
	return source.kind === 'injected' ? 'Injected wallet' : source.host
}

const ZERO_ADDRESS = 0n

function operationLabel(operation: bigint) {
	if (operation === 0n) return 'Call'
	if (operation === 1n) return 'Delegate call'
	return `Unknown (${ operation.toString() })`
}

function SafeStateDetails({ state, source, chainId, connectedAccount }: { readonly state: VerifiedSafeState, readonly source: SafeInformation['source'], readonly chainId: bigint, readonly connectedAccount: bigint | undefined }) {
	return <dl class = 'details safe-details'>
		{ source === undefined ? <></> : <><dt>Source</dt><dd>{ getSafeInformationSourceLabel(source) }</dd></> }
		<dt>Version</dt><dd>{ state.version }</dd>
		<dt>Nonce</dt><dd>{ state.nonce.toString() }</dd>
		<dt>Threshold</dt><dd>{ state.threshold.toString() }/{ state.owners.length.toString() }</dd>
		<dt>Owners</dt><dd class = 'owner-list'>{ state.owners.map((owner) => <code key = { owner.toString() }>{ identifiedAddress(owner, chainId, connectedAccount) }</code>) }</dd>
	</dl>
}

function ExecutionSubmissionLabel({ submission, fallback }: {
	readonly submission: SubmittedExecution | undefined
	readonly fallback: string
}) {
	if (submission?.status === 'pending') return <LoadingIndicator>Waiting for chain inclusion…</LoadingIndicator>
	if (submission?.status === 'confirmed') return <>Execution included</>
	if (submission?.status === 'unconfirmed') return <>Receipt confirmation unavailable</>
	return <>{ fallback }</>
}

function ExecutionSubmissionDetails({ submission }: { readonly submission: SubmittedExecution | undefined }) {
	if (submission === undefined) return <></>
	if (submission.status === 'confirmed') {
		return <p class = 'meta'>Gnosis Safe execution transaction included in block { submission.blockNumber.toString() }: { submission.transactionHash }</p>
	}
	if (submission.status === 'pending') {
		return <p class = 'meta'>Gnosis Safe execution transaction submitted: { submission.transactionHash }</p>
	}
	return <p class = 'meta'>Gnosis Safe execution transaction receipt confirmation unavailable: { submission.transactionHash }</p>
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
	submittedExecutions,
	transactionActionErrors,
	transactionDataMetadata,
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
	readonly submittedExecutions: readonly SubmittedExecution[]
	readonly transactionActionErrors: readonly TransactionActionError[]
	readonly transactionDataMetadata: readonly TransactionDataMetadataResult[]
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
			<div><p class = 'eyebrow'>Chain { stack.chainId.toString() } · Gnosis Safe { stack.safeVersion }</p><h2 class = 'address'>{ identifiedAddress(stack.safeAddress, stack.chainId, account) }</h2></div>
			<div><span class = 'badge'>{ stack.threshold.toString() } signature{ stack.threshold === 1n ? '' : 's' } required</span></div>
		</div>
		{ usingConnectedSafeWallet ? <p class = 'signer-route-note'>This connected Safe wallet exposes the Gnosis Safe address and can route signatures and completed executions through its configured signer.</p> : <></> }
		<section class = 'safe-information' aria-live = 'polite' aria-busy = { currentSafeInformation === undefined || currentSafeInformation.loading }>
			<h3>Current Gnosis Safe information</h3>
			{ currentSafeInformation === undefined || currentSafeInformation.loading
				? <p class = 'muted' role = 'status'><LoadingIndicator>Retrieving current Gnosis Safe information…</LoadingIndicator></p>
				: currentSafeInformation.state === undefined
					? <>{ currentSafeInformation.source === undefined ? <></> : <p class = 'meta'>Source: { getSafeInformationSourceLabel(currentSafeInformation.source) }</p> }<p class = 'safe-information-error'>{ currentSafeInformation.error ?? 'Current Gnosis Safe information is unavailable.' }</p></>
					: <SafeStateDetails state = { currentSafeInformation.state } source = { currentSafeInformation.source } chainId = { stack.chainId } connectedAccount = { account }/> }
		</section>
		{ stackAccountCompatibility?.status === 'mismatch' ? <p class = 'account-compatibility mismatch' role = 'alert'>{ stackAccountCompatibility.message }</p> : <></> }
		<div class = 'transactions'>{ stack.transactions.map((transaction, transactionIndex) => {
			const signatureCount = transaction.signatures.length
			const ready = BigInt(signatureCount) >= stack.threshold
			const signAction = `sign:${ stackIndex }:${ transactionIndex }` as const
			const signAndExecuteAction = `sign-and-execute:${ stackIndex }:${ transactionIndex }` as const
			const executeAction = `execute:${ stackIndex }:${ transactionIndex }` as const
			const signedByCurrentRoute = hasSafeSignatureFromCurrentRoute(transaction.signatures.map(({ signer }) => signer), account, routedSigner)
			const submittedExecution = submittedExecutions.find(({ safeTxHash }) => safeTxHash === transaction.safeTxHash)
			const executionPending = submittedExecution?.status === 'pending'
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
			const signAndExecutePrerequisiteDisabledReason = signatureActionDisabledReason
				?? connectedSafeWalletExecutionUnavailableReason
				?? (accountInformation?.kind === 'eoa' || connectedSafeWalletCanExecute ? undefined : 'Connect a Gnosis Safe EOA owner or a connected Safe wallet to sign and execute this transaction.')
				?? (verifiedSafeState?.nonce === transaction.safeTx.message.nonce ? undefined : 'Execute earlier Gnosis Safe transactions before this nonce.')
				?? duplicateSignerMessage
			const signAndExecuteDisabledReason = signAndExecutePrerequisiteDisabledReason
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
			const visibleExecutionFundingReason = getVisibleExecutionFundingReason({
				transactionActionError,
				ready,
				finalSignatureNeeded,
				executionPrerequisiteDisabledReason,
				signAndExecutePrerequisiteDisabledReason,
				nativeTransferDisabledReason,
				executionGasDisabledReason,
				pendingExecutionGasCheckReason,
			})
			const executionFundingCheckLoading = visibleExecutionFundingReason === pendingExecutionGasCheckReason && (executionGasCheck === undefined || executionGasCheck.status === 'loading')
			const executionFundingLoading = executionFundingCheckLoading || visibleExecutionFundingReason === nativeTransferDisabledReason && nativeAssetLoading
			const actionExplanation = ready
				? executionPrerequisiteDisabledReason
				: alreadySignedReason
					?? signatureDisabledReason
					?? (finalSignatureNeeded
						? usingConnectedSafeWallet
							? 'Review the transaction in your connected Safe wallet before approving it.'
							: 'Your signature will reach the required threshold. Choose whether to add the signature only or sign and execute.'
						: 'Review every transaction field in your wallet before signing.')
			const actionDescriptionIds = [actionExplanation === undefined ? undefined : actionExplanationId, transactionActionError === undefined ? undefined : actionErrorId].filter((value) => value !== undefined)
			const actionDescription = actionDescriptionIds.length === 0 ? undefined : actionDescriptionIds.join(' ')
			const executionDescriptionIds = [...actionDescriptionIds, visibleExecutionFundingReason === undefined ? undefined : executionFundingReasonId].filter((value) => value !== undefined)
			const executionDescription = executionDescriptionIds.length === 0 ? undefined : executionDescriptionIds.join(' ')
			const dataMetadata = transactionDataMetadata[transactionIndex] ?? { decoded: { status: 'error', error: 'Transaction details unavailable.' }, metadata: { status: 'idle' } } as const
			return <article class = 'transaction' key = { transaction.safeTxHash.toString() }>
				<div class = 'transaction-header'><div><h3>Gnosis Safe Transaction { transaction.safeTx.message.nonce.toString() }</h3><p class = 'meta'>{ transaction.websiteOrigin }</p></div><span class = { `badge${ ready ? '' : ' pending' }` }>{ signatureCount } / { stack.threshold.toString() } signatures</span></div>
				<dl class = 'details'>
					<dt>Nonce</dt><dd>{ transaction.safeTx.message.nonce.toString() }</dd>
					<dt>Destination</dt><dd class = 'address'>{ identifiedAddress(transaction.safeTx.message.to, stack.chainId, account) }</dd>
					<dt>Value</dt><dd>{ formatTokenBalance(transaction.safeTx.message.value, 18) } { nativeAssetSymbol }</dd>
					<dt>Operation</dt><dd>{ operationLabel(transaction.safeTx.message.operation) }</dd>
					<dt>Safe tx gas</dt><dd>{ transaction.safeTx.message.safeTxGas === 0n ? 'Not specified' : transaction.safeTx.message.safeTxGas.toString() }</dd>
					<dt>Base gas</dt><dd>{ transaction.safeTx.message.baseGas === 0n ? 'None' : transaction.safeTx.message.baseGas.toString() }</dd>
					<dt>Gas price</dt><dd>{ transaction.safeTx.message.gasPrice === 0n ? 'Gas refund disabled' : `${ transaction.safeTx.message.gasPrice.toString() } wei` }</dd>
					<dt>Gas token</dt><dd class = { transaction.safeTx.message.gasToken === ZERO_ADDRESS ? undefined : 'address' }>{ transaction.safeTx.message.gasToken === ZERO_ADDRESS ? transaction.safeTx.message.gasPrice === 0n ? 'Not enabled' : 'Native token' : identifiedAddress(transaction.safeTx.message.gasToken, stack.chainId, account) }</dd>
					<dt>Refund receiver</dt><dd class = { transaction.safeTx.message.refundReceiver === ZERO_ADDRESS ? undefined : 'address' }>{ transaction.safeTx.message.refundReceiver === ZERO_ADDRESS ? transaction.safeTx.message.gasPrice === 0n ? 'Not enabled' : 'Transaction sender' : identifiedAddress(transaction.safeTx.message.refundReceiver, stack.chainId, account) }</dd>
					<dt>Data</dt><dd><TransactionDataDetails data = { transaction.safeTx.message.data } destination = { transaction.safeTx.message.to } transactionValue = { transaction.safeTx.message.value } chainId = { stack.chainId } connectedAccount = { account } result = { dataMetadata }/></dd>
					<dt>Gnosis Safe tx hash</dt><dd class = 'address'>{ `0x${ transaction.safeTxHash.toString(16).padStart(64, '0') }` }</dd>
					<dt>Signed owners</dt><dd>{ transaction.signatures.length === 0 ? 'None' : transaction.signatures.map(({ signer }) => identifiedAddress(signer, stack.chainId, account)).join(', ') }</dd>
				</dl>
				<div class = 'transaction-actions'>
					{ actionExplanation === undefined ? <></> : <p class = { actionDisabledReason === undefined ? 'muted' : 'signing-explanation' } id = { actionExplanationId }>{ safeDataLoading ? <LoadingIndicator>{ actionExplanation }</LoadingIndicator> : actionExplanation }</p> }
					<div class = 'transaction-action-control'><div class = 'transaction-action-buttons'>
						<button aria-busy = { pendingAction === executeAction || pendingAction === signAction || executionPending } disabled = { busy || submittedExecution !== undefined || actionDisabledReason !== undefined } aria-describedby = { ready ? executionDescription : actionDescription } title = { actionDisabledReason } onClick = { () => { ready ? onExecute(transactionIndex) : onSign(transactionIndex, false) } }>
							{ ready ? pendingAction === executeAction ? <LoadingIndicator>Confirm execution…</LoadingIndicator> : <ExecutionSubmissionLabel submission = { submittedExecution } fallback = 'Execute transaction'/> : pendingAction === signAction ? <LoadingIndicator>Waiting for wallet…</LoadingIndicator> : signedByCurrentRoute ? 'Already signed' : 'Add my signature' }
						</button>
						{ finalSignatureNeeded ? <button aria-busy = { pendingAction === signAndExecuteAction || executionPending } disabled = { busy || submittedExecution !== undefined || signAndExecuteDisabledReason !== undefined } aria-describedby = { executionDescription } title = { signAndExecuteDisabledReason } onClick = { () => { onSign(transactionIndex, true) } }>
							{ pendingAction === signAndExecuteAction ? <LoadingIndicator>{ usingConnectedSafeWallet ? 'Confirm execution…' : 'Confirm signature and execution…' }</LoadingIndicator> : <ExecutionSubmissionLabel submission = { submittedExecution } fallback = { usingConnectedSafeWallet ? 'Execute through connected Safe wallet' : 'Sign and execute' }/> }
						</button> : <></> }
					</div>
					<ExecutionSubmissionDetails submission = { submittedExecution }/>
					{ visibleExecutionFundingReason === undefined ? <></> : <p class = 'transaction-action-disabled-reason' id = { executionFundingReasonId }>{ executionFundingLoading ? <LoadingIndicator>{ visibleExecutionFundingReason }</LoadingIndicator> : visibleExecutionFundingReason }</p> }
					{ transactionActionError === undefined ? <></> : <p class = 'transaction-action-error' id = { actionErrorId } role = 'alert'>{ transactionActionError }</p> }
					</div>
				</div>
			</article>
		}) }</div>
	</section>
}

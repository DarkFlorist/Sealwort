import { type AssetBalance, formatTokenBalance } from './accountBalances.js'
import type { SafeExecutionGasFunding } from './safeExecution.js'

export type SignatureAvailability = {
	readonly connectedAccount: bigint | undefined
	readonly walletChainId: bigint | undefined
	readonly safeChainId: bigint
	readonly safeVerified: boolean
	readonly safeNonce: bigint | undefined
	readonly transactionNonce: bigint
	readonly connectedAccountCanSign: boolean
}

export function getSignatureDisabledReason(availability: SignatureAvailability) {
	if (availability.connectedAccount === undefined) return 'Connect a signer wallet before adding your signature.'
	if (availability.walletChainId !== availability.safeChainId) {
		return `Switch the signer wallet to chain ${ availability.safeChainId.toString() } before signing.`
	}
	if (!availability.safeVerified) return 'Current Gnosis Safe information is unavailable.'
	if (availability.safeNonce !== undefined && availability.transactionNonce < availability.safeNonce) {
		return 'This Gnosis Safe transaction nonce has already executed or expired.'
	}
	if (!availability.connectedAccountCanSign) return 'The connected account is not an owner of this Gnosis Safe.'
	return undefined
}

export type ExecutionAvailability = {
	readonly connectedAccount: bigint | undefined
	readonly connectedAccountCanExecute: boolean
	readonly walletChainId: bigint | undefined
	readonly safeChainId: bigint
	readonly safeVerified: boolean
	readonly safeNonce: bigint | undefined
	readonly transactionNonce: bigint
	readonly signatureCount: number
	readonly threshold: bigint
}

export function getExecutionDisabledReason(availability: ExecutionAvailability) {
	if (BigInt(availability.signatureCount) < availability.threshold) return 'Collect the required Gnosis Safe owner signatures before executing.'
	if (availability.connectedAccount === undefined) return 'Connect an EOA wallet or a connected Safe wallet to submit the execution transaction.'
	if (availability.walletChainId !== availability.safeChainId) {
		return `Switch the wallet to chain ${ availability.safeChainId.toString() } before executing.`
	}
	if (!availability.safeVerified) return 'Verify the transaction against current on-chain Gnosis Safe information before executing.'
	if (availability.safeNonce === undefined) return 'Current Gnosis Safe nonce information is unavailable.'
	if (availability.transactionNonce < availability.safeNonce) return 'This Gnosis Safe transaction nonce has already executed or expired.'
	if (availability.transactionNonce > availability.safeNonce) return 'Execute earlier Gnosis Safe transactions before this nonce.'
	if (!availability.connectedAccountCanExecute) return 'Switch to an EOA wallet account or a connected Safe wallet to submit the execution transaction.'
	return undefined
}

export type NativeTransferAvailability = {
	readonly balance: AssetBalance | undefined
	readonly symbol: string
	readonly earlierTransactionValue: bigint
	readonly transactionValue: bigint
}

export function getNativeTransferDisabledReason(availability: NativeTransferAvailability) {
	if (availability.transactionValue === 0n) return undefined
	if (availability.balance === undefined || availability.balance.status === 'unavailable') {
		return `The Gnosis Safe vault’s ${ availability.symbol } balance is unavailable, so Sealwort cannot confirm that this transfer has enough funds.`
	}
	const availableAfterEarlierTransactions = availability.balance.value > availability.earlierTransactionValue
		? availability.balance.value - availability.earlierTransactionValue
		: 0n
	if (availableAfterEarlierTransactions >= availability.transactionValue) return undefined
	const formattedAvailable = formatTokenBalance(availableAfterEarlierTransactions, 18)
	const formattedValue = formatTokenBalance(availability.transactionValue, 18)
	if (availability.earlierTransactionValue === 0n) {
		return `The Gnosis Safe vault has ${ formattedAvailable } ${ availability.symbol }, but this transaction sends ${ formattedValue } ${ availability.symbol }.`
	}
	const formattedReserved = formatTokenBalance(availability.earlierTransactionValue, 18)
	return `After reserving ${ formattedReserved } ${ availability.symbol } for earlier Gnosis Safe transactions, the vault has ${ formattedAvailable } ${ availability.symbol } available, but this transaction sends ${ formattedValue } ${ availability.symbol }.`
}

export function getExecutionGasFundingDisabledReason(funding: SafeExecutionGasFunding, symbol: string) {
	if (funding.balance >= funding.requiredBalance) return undefined
	return `The active signer has ${ formatTokenBalance(funding.balance, 18) } ${ symbol }, but it needs up to ${ formatTokenBalance(funding.requiredBalance, 18) } ${ symbol } to cover the estimated Gnosis Safe execution gas.`
}

export function shouldInvalidateExecutionVerification(submissionAttempted: boolean, userRejected: boolean) {
	return !submissionAttempted && !userRejected
}

type ResizableTextarea = Pick<HTMLTextAreaElement, 'scrollHeight'> & {
	readonly style: Pick<CSSStyleDeclaration, 'height'>
}

export function resizeTextareaToContent(textarea: ResizableTextarea, expanded: boolean) {
	if (!expanded) {
		textarea.style.height = ''
		return
	}
	textarea.style.height = 'auto'
	textarea.style.height = `${ textarea.scrollHeight }px`
}

export type AutomaticStackVerificationAction = 'no-stack' | 'await-account' | 'verify'

export function getAutomaticStackVerificationAction(stackLoaded: boolean, connectedAccount: bigint | undefined): AutomaticStackVerificationAction {
	if (!stackLoaded) return 'no-stack'
	if (connectedAccount === undefined) return 'await-account'
	return 'verify'
}

export type SafeStackTextAction = 'none' | 'clear' | 'import'

export function getSafeStackTextAction(text: string, lastImportedText: string | undefined): SafeStackTextAction {
	if (text === lastImportedText) return 'none'
	if (text.trim().length === 0) return 'clear'
	return 'import'
}

export const PERSISTED_SAFE_STACK_STORAGE_KEY = 'sealwort.safe-stack'
export const SAFE_STACK_PERSISTENCE_WARNING = 'Sealwort could not update browser storage. Refreshing or reopening this page may lose the current stack or restore an older one.'

export type SafeStackStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export function readPersistedSafeStackText(storage: SafeStackStorage | undefined) {
	if (storage === undefined) return ''
	try {
		return storage.getItem(PERSISTED_SAFE_STACK_STORAGE_KEY) ?? ''
	} catch {
		return ''
	}
}

export function persistSafeStackText(storage: SafeStackStorage | undefined, text: string) {
	if (storage === undefined) return false
	try {
		if (text.trim().length === 0) {
			storage.removeItem(PERSISTED_SAFE_STACK_STORAGE_KEY)
			return true
		}
		storage.setItem(PERSISTED_SAFE_STACK_STORAGE_KEY, text)
		return true
	} catch {
		return false
	}
}

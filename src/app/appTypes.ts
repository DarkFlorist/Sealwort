import type { NativeAssetBalance } from './accountBalances.js'
import type { SafeInformationSource } from './readProvider.js'
import type { VerifiedSafeState } from './safeStackValidation.js'

export type PendingAction = 'connect' | 'refresh' | 'import' | 'read-file' | `sign:${ number }:${ number }` | `sign-and-execute:${ number }:${ number }` | `execute:${ number }:${ number }`

export type ConnectedSafeWalletSigner = {
	readonly safeAddress: bigint
	readonly signer: bigint
}

export type SubmittedExecution = {
	readonly safeTxHash: bigint
	readonly transactionHash: string
}

export type TransactionActionError = {
	readonly safeTxHash: bigint
	readonly message: string
}

export const CONNECTED_SAFE_WALLET_EXECUTION_UNAVAILABLE = 'This connected Safe wallet does not advertise Gnosis Safe execution support. Add the signature only, or switch to an EOA owner.'

export type SafeInformation = {
	readonly chainId: bigint
	readonly safeAddress: bigint
	readonly loading: boolean
	readonly nativeAssetLoading: boolean
	readonly source?: SafeInformationSource
	readonly state?: VerifiedSafeState
	readonly nativeAsset?: NativeAssetBalance
	readonly error?: string
}

export type ExecutionGasCheck = {
	readonly safeTxHash: bigint
} & (
	| { readonly status: 'loading' }
	| { readonly status: 'complete', readonly disabledReason: string | undefined }
)

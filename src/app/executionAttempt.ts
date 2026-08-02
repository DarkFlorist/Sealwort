import type { Hex } from './ethereum.js'
import { isUserRejectedError } from './userFacingErrors.js'
import { shouldInvalidateExecutionVerification } from './uiState.js'

export type ExecutionAttemptResult<Preparation> =
	| { readonly status: 'cancelled' }
	| { readonly status: 'failed', readonly error: unknown, readonly invalidateVerification: boolean }
	| { readonly status: 'submitted', readonly preparation: Preparation, readonly transactionHash: Hex }

export async function runExecutionAttempt<Preparation>({
	prepare,
	isCurrent,
	assertFunding,
	submit,
}: {
	readonly prepare: () => Promise<Preparation>
	readonly isCurrent: (preparation: Preparation) => boolean
	readonly assertFunding: (preparation: Preparation) => Promise<void>
	readonly submit: (preparation: Preparation) => Promise<Hex>
}): Promise<ExecutionAttemptResult<Preparation>> {
	let fundingCheckStarted = false
	let submissionAttempted = false
	try {
		const preparation = await prepare()
		if (!isCurrent(preparation)) return { status: 'cancelled' }
		fundingCheckStarted = true
		await assertFunding(preparation)
		if (!isCurrent(preparation)) return { status: 'cancelled' }
		submissionAttempted = true
		const transactionHash = await submit(preparation)
		if (!isCurrent(preparation)) return { status: 'cancelled' }
		return { status: 'submitted', preparation, transactionHash }
	} catch (error) {
		return {
			status: 'failed',
			error,
			invalidateVerification: !fundingCheckStarted
				&& shouldInvalidateExecutionVerification(submissionAttempted, isUserRejectedError(error)),
		}
	}
}

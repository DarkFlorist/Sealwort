import * as funtypes from 'funtypes'
import { addressString, ensureHex } from './ethereum.js'
import type { SafeTransactionStack } from './safeStackProtocol.js'
import { type InjectedProvider, type VerifiedSafeState, readSafeState } from './safeStackValidation.js'
import { getUserFacingErrorMessage } from './userFacingErrors.js'
import { SUPPORTED_SAFE_VERSIONS } from './safeDeployments.js'

export type ConnectedAccountInformation = {
	readonly address: bigint
	readonly chainId: bigint
} & (
	| { readonly kind: 'eoa' }
	| { readonly kind: 'safe', readonly state: VerifiedSafeState }
	| { readonly kind: 'contract', readonly safeReadError: string }
	| { readonly kind: 'unavailable', readonly inspectionError: string }
)

export async function inspectConnectedAccount(
	provider: InjectedProvider,
	address: bigint,
	chainId: bigint,
): Promise<ConnectedAccountInformation> {
	let code: `0x${ string }`
	try {
		code = ensureHex(funtypes.String.parse(await provider.request({
			method: 'eth_getCode',
			params: [addressString(address), 'latest'],
		})), 'eth_getCode result')
	} catch (inspectionError) {
		return {
			address,
			chainId,
			kind: 'unavailable',
			inspectionError: getUserFacingErrorMessage(inspectionError),
		}
	}
	if (code === '0x') return { address, chainId, kind: 'eoa' }
	try {
		const state = await readSafeState(provider, { chainId, safeAddress: address })
		if (!SUPPORTED_SAFE_VERSIONS.some((version) => version === state.version)) {
			throw new Error(`Gnosis Safe version ${ state.version } is not supported.`)
		}
		return {
			address,
			chainId,
			kind: 'safe',
			state,
		}
	} catch (safeReadError) {
		return {
			address,
			chainId,
			kind: 'contract',
			safeReadError: getUserFacingErrorMessage(safeReadError),
		}
	}
}

export type StackAccountCompatibility = {
	readonly status: 'match' | 'mismatch'
	readonly message: string
}

type StackIdentity = Pick<SafeTransactionStack, 'chainId' | 'safeAddress' | 'safeVersion' | 'baseNonce' | 'threshold'> & {
	readonly transactions: readonly {
		readonly safeTx: {
			readonly message: {
				readonly nonce: bigint
			}
		}
	}[]
}

export function getStackAccountCompatibility(
	accountInformation: ConnectedAccountInformation | undefined,
	stack: StackIdentity,
	currentStackSafeState: VerifiedSafeState | undefined,
): StackAccountCompatibility | undefined {
	if (accountInformation === undefined) return undefined
	if (accountInformation.kind === 'unavailable') return undefined
	if (accountInformation.kind === 'contract') {
		return {
			status: 'mismatch',
			message: 'The connected account is a contract but is not recognized as a supported Gnosis Safe.',
		}
	}
	if (accountInformation.kind === 'eoa') {
		if (currentStackSafeState === undefined) return undefined
		if (currentStackSafeState.owners.some((owner) => owner === accountInformation.address)) {
			return {
				status: 'match',
				message: 'The connected EOA is a current owner of this Gnosis Safe.',
			}
		}
		return {
			status: 'mismatch',
			message: 'The connected EOA is not a current owner of the Gnosis Safe in this stack.',
		}
	}
	if (accountInformation.chainId !== stack.chainId || accountInformation.address !== stack.safeAddress) {
		return {
			status: 'mismatch',
			message: `This stack is for Gnosis Safe ${ addressString(stack.safeAddress) } on chain ${ stack.chainId.toString() }, but the connected wallet exposes Gnosis Safe ${ addressString(accountInformation.address) } on chain ${ accountInformation.chainId.toString() }.`,
		}
	}
	const stackContainsCurrentNonce = stack.transactions.some(({ safeTx }) => safeTx.message.nonce === accountInformation.state.nonce)
	const stateDifferences = [
		accountInformation.state.version === stack.safeVersion ? undefined : `version ${ accountInformation.state.version } instead of ${ stack.safeVersion }`,
		stackContainsCurrentNonce ? undefined : `no pending transaction at current nonce ${ accountInformation.state.nonce.toString() }`,
		accountInformation.state.threshold === stack.threshold ? undefined : `threshold ${ accountInformation.state.threshold.toString() } instead of ${ stack.threshold.toString() }`,
	].filter((difference): difference is string => difference !== undefined)
	if (stateDifferences.length !== 0) {
		return {
			status: 'mismatch',
			message: `The stack identifies the connected Gnosis Safe, but its recorded state does not match: ${ stateDifferences.join(', ') }.`,
		}
	}
	return {
		status: 'match',
		message: 'This stack matches the Gnosis Safe exposed by the connected wallet.',
	}
}

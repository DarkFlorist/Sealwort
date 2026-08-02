import { addressString } from './ethereum.js'
import { EthereumAddress } from './safeStackProtocol.js'
import type { InjectedProvider } from './safeStackValidation.js'

// EIP-5792 standardizes capability discovery; these versioned semantics remain
// experimental until an equivalent connected Safe execution capability has its own ERC.
export const GNOSIS_SAFE_EXECUTION_CAPABILITY = 'gnosisSafeExecution'
export const GNOSIS_SAFE_EXECUTION_CAPABILITY_VERSION = '1.0.0'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readActiveSigner(capabilities: unknown) {
	if (!isRecord(capabilities)) return undefined
	const capability = capabilities[GNOSIS_SAFE_EXECUTION_CAPABILITY]
	if (
		!isRecord(capability)
		|| capability.supported !== true
		|| capability.version !== GNOSIS_SAFE_EXECUTION_CAPABILITY_VERSION
		|| capability.submissionMethod !== 'eth_sendTransaction'
	) return undefined
	const parsedSigner = EthereumAddress.safeParse(capability.activeSigner)
	return parsedSigner.success ? parsedSigner.value : undefined
}

export async function getConnectedSafeWalletSigner(
	provider: InjectedProvider,
	safeAddress: bigint,
	chainId: bigint,
) {
	try {
		const result = await provider.request({
			method: 'wallet_getCapabilities',
			params: [addressString(safeAddress), [`0x${ chainId.toString(16) }`]],
		})
		if (!isRecord(result)) return undefined
		return readActiveSigner(result[`0x${ chainId.toString(16) }`]) ?? readActiveSigner(result['0x0'])
	} catch {
		return undefined
	}
}

export function getConnectedSafeWalletDuplicateSignerMessage(
	transactionSigners: readonly bigint[],
	activeSigner: bigint | undefined,
) {
	if (activeSigner === undefined || !transactionSigners.includes(activeSigner)) return undefined
	return `The connected Safe wallet’s active signer ${ addressString(activeSigner) } already signed this transaction. Select another active signer in the wallet, then refresh Sealwort.`
}

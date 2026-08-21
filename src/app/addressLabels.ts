import { getNativeAssetIdentity, getRegisteredAddressLabel, NATIVE_TOKEN_SENTINEL } from './addressRegistry.js'
import { checksummedAddress } from './ethereum.js'

export function getAddressLabel(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	if (connectedAccount === address) return 'connected wallet'
	if (address === NATIVE_TOKEN_SENTINEL) return getNativeAssetIdentity(chainId).label
	return getRegisteredAddressLabel(chainId, address)
}

export function identifiedAddress(address: bigint, chainId: bigint, connectedAccount?: bigint) {
	const formatted = checksummedAddress(address)
	const label = getAddressLabel(address, chainId, connectedAccount)
	return label === undefined ? formatted : `${ formatted } (${ label })`
}

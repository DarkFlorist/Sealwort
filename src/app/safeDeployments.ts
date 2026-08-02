import { bytesFromHex, bytesToHex, keccak256, type Hex } from './ethereum.js'

// Runtime hashes come from the released SafeProxy artifacts in
// @gnosis.pm/safe-contracts 1.3.0 and @safe-global/safe-contracts 1.4.1-2.
const SUPPORTED_PROXY_RUNTIME_HASHES = new Set([
	'0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000',
	'0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c',
])

// Released singleton addresses and runtime hashes from
// @safe-global/safe-deployments 1.37.60. zkSync deployments use different proxy
// semantics and are intentionally excluded.
const SUPPORTED_SINGLETONS_BY_VERSION: Readonly<Record<string, ReadonlyMap<bigint, Hex>>> = {
	'1.3.0': new Map([
		[0xd9db270c1b5e3bd161e8c8503c55ceabee709552n, '0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e'],
		[0x69f4d1788e39c87893c980c06edf4b7f686e2938n, '0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e'],
		[0x3e5c63644e683549055b9be8653de26e0b4cd36en, '0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f'],
		[0xfb1bffc9d739b8d520daf37df666da4c687191ean, '0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f'],
	]),
	'1.4.1': new Map([
		[0x41675c099f32341bf84bfc5382af534df5c7461an, '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4'],
		[0x29fcb43b46531bca003ddc8fcb67ffe91900c762n, '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff'],
	]),
}

export const SUPPORTED_SAFE_VERSIONS = Object.freeze(Object.keys(SUPPORTED_SINGLETONS_BY_VERSION))

function decodeSingletonStorage(storageWord: Hex) {
	const bytes = bytesFromHex(storageWord)
	if (bytes.length !== 32 || bytes.slice(0, 12).some((byte) => byte !== 0)) {
		throw new Error('The Gnosis Safe singleton storage slot is malformed.')
	}
	return BigInt(bytesToHex(bytes.slice(12)))
}

export type SupportedSafeSingleton = {
	readonly address: bigint
	readonly runtimeHash: Hex
}

export function getSupportedSafeSingleton(singletonStorage: Hex, version: string): SupportedSafeSingleton {
	const supportedSingletons = SUPPORTED_SINGLETONS_BY_VERSION[version]
	if (supportedSingletons === undefined) throw new Error(`Gnosis Safe version ${ version } is not supported.`)
	const address = decodeSingletonStorage(singletonStorage)
	const runtimeHash = supportedSingletons.get(address)
	if (runtimeHash === undefined) {
		throw new Error(`The Gnosis Safe proxy points to an unrecognized ${ version } singleton implementation.`)
	}
	return { address, runtimeHash }
}

export function assertSupportedSafeDeployment(proxyCode: Hex, singletonCode: Hex, singleton: SupportedSafeSingleton) {
	const proxyRuntimeHash = bytesToHex(keccak256(bytesFromHex(proxyCode)))
	if (!SUPPORTED_PROXY_RUNTIME_HASHES.has(proxyRuntimeHash)) {
		throw new Error('The contract does not use a supported official Gnosis Safe proxy runtime.')
	}
	if (singletonCode === '0x' || bytesToHex(keccak256(bytesFromHex(singletonCode))) !== singleton.runtimeHash) {
		throw new Error('The Gnosis Safe singleton does not contain the expected official runtime code.')
	}
}

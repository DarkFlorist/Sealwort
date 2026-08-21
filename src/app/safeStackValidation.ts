import * as funtypes from 'funtypes'
import { readChainId } from './chainDiscovery.js'
import { addressString, decodeSafeOwners, decodeSafeUint, decodeSafeVersion, encodeSafeReadCall, ensureHex } from './ethereum.js'
import type { InjectedProvider, ProviderRequest } from './provider.js'
import { assertInterceptorSafeTransactionPolicy, assertUniqueSafeTransactionStacks, encodeSafeTransactionHashCall, getSafeTxHash, recoverSafeSignatureOwner } from './safeProtocol.js'
import { assertSupportedSafeDeployment, getSupportedSafeSingleton, SUPPORTED_SAFE_VERSIONS } from './safeDeployments.js'
import {
	SAFE_STACK_EXPORT_NAME,
	SUPPORTED_SAFE_STACK_FORMAT_VERSIONS,
	EthereumAddress,
	SafeStackExport,
	type SafeTransactionStack,
} from './safeStackProtocol.js'

export type VerifiedSafeState = {
	readonly version: string
	readonly nonce: bigint
	readonly owners: readonly bigint[]
	readonly threshold: bigint
}

const EthereumAccounts = funtypes.ReadonlyArray(EthereumAddress)
const ETHEREUM_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u

function parseBlockTag(value: unknown) {
	const blockTag = funtypes.String.parse(value)
	if (!ETHEREUM_QUANTITY_PATTERN.test(blockTag)) throw new Error('The wallet returned an invalid block number.')
	return blockTag
}

export function parseSafeStackText(text: string) {
	let json: unknown
	try {
		json = JSON.parse(text)
	} catch {
		throw new Error('The imported Gnosis Safe Stack is not valid JSON.')
	}
	if (typeof json === 'object' && json !== null && 'name' in json && json.name === SAFE_STACK_EXPORT_NAME && 'version' in json && typeof json.version === 'string') {
		if (!SUPPORTED_SAFE_STACK_FORMAT_VERSIONS.some((version) => version === json.version)) {
			throw new Error(`Gnosis Safe Stack format version ${ json.version } is not supported. Supported versions: ${ SUPPORTED_SAFE_STACK_FORMAT_VERSIONS.join(', ') }.`)
		}
	}
	try {
		return SafeStackExport.parse(json)
	} catch {
		throw new Error('This is not a valid Interceptor Gnosis Safe Stack export.')
	}
}

export type SafeSigningAccountMode = 'owner' | 'connected-safe-wallet'

export function getSafeSigningAccountMode(safeAddress: bigint, safeOwners: readonly bigint[], account: bigint): SafeSigningAccountMode {
	if (account === safeAddress) return 'connected-safe-wallet'
	if (!safeOwners.some((owner) => owner === account)) throw new Error(`${ addressString(account) } is not an owner of this Gnosis Safe.`)
	return 'owner'
}

export function assertReturnedSafeOwner(
	mode: SafeSigningAccountMode,
	safeOwners: readonly bigint[],
	requestedAccount: bigint,
	recoveredOwner: bigint,
) {
	if (mode === 'connected-safe-wallet') {
		if (!safeOwners.some((owner) => owner === recoveredOwner)) throw new Error('The returned signature was not created by a current owner of this Gnosis Safe.')
		return
	}
	if (recoveredOwner !== requestedAccount) throw new Error('The returned signature does not match the connected account.')
}

export function hasSafeSignatureFromCurrentRoute(
	signers: readonly bigint[],
	visibleAccount: bigint | undefined,
	routedSigner: bigint | undefined,
) {
	return signers.some((signer) => signer === visibleAccount || signer === routedSigner)
}

export async function assertProviderEoaOwner(provider: InjectedProvider, owner: bigint, blockTag = 'latest') {
	const ownerCode = ensureHex(funtypes.String.parse(await provider.request({
		method: 'eth_getCode',
		params: [addressString(owner), blockTag],
	})), 'eth_getCode result')
	if (ownerCode !== '0x') throw new Error(`${ addressString(owner) } is a contract owner. This Gnosis Safe workflow currently supports EOA owners only.`)
}

export async function getFreshSigningAccount(provider: InjectedProvider, expectedAccount: bigint) {
	const accounts = EthereumAccounts.parse(await provider.request({ method: 'eth_accounts' }))
	const freshAccount = accounts[0]
	if (freshAccount === undefined) throw new Error('The wallet no longer provides an active account.')
	if (freshAccount !== expectedAccount) throw new Error('The active wallet account changed. Review the proposal again before signing.')
	return freshAccount
}

export async function readSafeState(
	provider: InjectedProvider,
	stack: Pick<SafeTransactionStack, 'chainId' | 'safeAddress'>,
	blockTag = 'latest',
): Promise<VerifiedSafeState> {
	const safeAddress = addressString(stack.safeAddress)
	const code = ensureHex(funtypes.String.parse(await provider.request({
		method: 'eth_getCode',
		params: [safeAddress, blockTag],
	})), 'eth_getCode result')
	if (code === '0x') throw new Error(`No Gnosis Safe contract is deployed at ${ safeAddress } on chain ${ stack.chainId.toString() }.`)
	const singletonStoragePromise = provider.request({
		method: 'eth_getStorageAt',
		params: [safeAddress, '0x0', blockTag],
	})
	const call = async (data: string) => ensureHex(funtypes.String.parse(await provider.request({
		method: 'eth_call',
		params: [{ to: safeAddress, data }, blockTag],
	})), 'eth_call result')
	const [singletonStorageResult, versionResult, nonceResult, ownersResult, thresholdResult] = await Promise.all([
		singletonStoragePromise,
		call(encodeSafeReadCall('VERSION')),
		call(encodeSafeReadCall('nonce')),
		call(encodeSafeReadCall('getOwners')),
		call(encodeSafeReadCall('getThreshold')),
	])
	const version = decodeSafeVersion(versionResult)
	const singleton = getSupportedSafeSingleton(
		ensureHex(funtypes.String.parse(singletonStorageResult), 'Gnosis Safe singleton storage'),
		version,
	)
	const singletonCode = ensureHex(funtypes.String.parse(await provider.request({
		method: 'eth_getCode',
		params: [addressString(singleton.address), blockTag],
	})), 'Gnosis Safe singleton eth_getCode result')
	assertSupportedSafeDeployment(code, singletonCode, singleton)
	return {
		version,
		nonce: decodeSafeUint(nonceResult, 'Gnosis Safe nonce'),
		owners: decodeSafeOwners(ownersResult),
		threshold: decodeSafeUint(thresholdResult, 'Gnosis Safe threshold'),
	}
}

export async function validateStackFile(stackExport: SafeStackExport) {
	if (stackExport.stacks.length === 0) throw new Error('The Gnosis Safe stack export does not contain any proposals.')
	assertUniqueSafeTransactionStacks(stackExport.stacks)
	for (const stack of stackExport.stacks) {
		if (stack.transactions.length === 0) throw new Error('A Gnosis Safe stack does not contain any transactions.')
		for (const [index, transaction] of stack.transactions.entries()) {
			assertInterceptorSafeTransactionPolicy(transaction.safeTx)
			if (transaction.safeTx.domain.chainId !== stack.chainId) throw new Error('A transaction chain ID does not match its Gnosis Safe stack.')
			if (transaction.safeTx.domain.verifyingContract !== stack.safeAddress) throw new Error('A transaction verifying contract does not match its Gnosis Safe stack.')
			if (transaction.safeTx.message.nonce !== stack.baseNonce + BigInt(index)) throw new Error('Gnosis Safe transaction nonces are not contiguous.')
			if (BigInt(getSafeTxHash(transaction.safeTx)) !== transaction.safeTxHash) throw new Error('A transaction hash does not match its Gnosis Safe transaction data.')
			const recoveredOwners = await Promise.all(transaction.signatures.map(async (signature) => ({
				claimedOwner: signature.signer,
				recoveredOwner: await recoverSafeSignatureOwner(transaction.safeTxHash, signature.signature),
			})))
			if (recoveredOwners.some(({ claimedOwner, recoveredOwner }) => claimedOwner !== recoveredOwner)) {
				throw new Error('A stored signature does not match its claimed Gnosis Safe owner.')
			}
			if (new Set(transaction.signatures.map(({ signer }) => signer)).size !== transaction.signatures.length) {
				throw new Error('A transaction contains duplicate owner signatures.')
			}
		}
	}
}

type SafeNonceValidator = (safeState: VerifiedSafeState, stack: SafeTransactionStack) => void

async function validateSafeStackWithNonceValidator(
	provider: InjectedProvider,
	stackExport: SafeStackExport,
	validateNonce: SafeNonceValidator,
) {
	await validateStackFile(stackExport)
	const walletChainId = await readChainId(provider, 'stack-verification')
	const blockTag = parseBlockTag(await provider.request({ method: 'eth_blockNumber' }))
	const verifiedStates: VerifiedSafeState[] = []
	const verifiedEoaOwners = new Set<bigint>()
	for (const stack of stackExport.stacks) {
		if (walletChainId !== stack.chainId) throw new Error(`Switch the wallet to chain ${ stack.chainId.toString() } to verify this Gnosis Safe stack.`)
		const safeState = await readSafeState(provider, stack, blockTag)
		if (!SUPPORTED_SAFE_VERSIONS.some((version) => version === safeState.version)) {
			throw new Error(`Gnosis Safe version ${ safeState.version } is not supported.`)
		}
		if (safeState.version !== stack.safeVersion) {
			throw new Error(`Gnosis Safe version is now ${ safeState.version }, but this stack records ${ stack.safeVersion }.`)
		}
		validateNonce(safeState, stack)
		if (safeState.threshold !== stack.threshold) {
			throw new Error(`The Gnosis Safe threshold is now ${ safeState.threshold.toString() }, but this stack records ${ stack.threshold.toString() }.`)
		}
		for (const transaction of stack.transactions) {
			const contractHash = decodeSafeUint(ensureHex(funtypes.String.parse(await provider.request({
				method: 'eth_call',
				params: [{
					to: addressString(stack.safeAddress),
					data: encodeSafeTransactionHashCall(transaction.safeTx),
				}, blockTag],
			})), 'Gnosis Safe getTransactionHash result'), 'Gnosis Safe transaction hash')
			if (contractHash !== transaction.safeTxHash) {
				throw new Error('The Gnosis Safe contract returned a different transaction hash than the imported transaction data.')
			}
			if (transaction.safeTx.message.nonce < safeState.nonce) continue
			for (const signature of transaction.signatures) {
				if (!safeState.owners.some((owner) => owner === signature.signer)) {
					throw new Error(`${ addressString(signature.signer) } signed this stack but is not a current Gnosis Safe owner.`)
				}
				if (!verifiedEoaOwners.has(signature.signer)) {
					await assertProviderEoaOwner(provider, signature.signer, blockTag)
					verifiedEoaOwners.add(signature.signer)
				}
			}
		}
		verifiedStates.push(safeState)
	}
	const walletChainIdAfterValidation = await readChainId(provider, 'stack-verification')
	if (walletChainIdAfterValidation !== walletChainId) throw new Error('The wallet network changed while the Gnosis Safe stack was being verified. Verify it again.')
	return verifiedStates
}

export async function validateSafeStackAgainstProvider(provider: InjectedProvider, stackExport: SafeStackExport) {
	return await validateSafeStackWithNonceValidator(provider, stackExport, (safeState, stack) => {
		if (safeState.nonce !== stack.baseNonce) {
			throw new Error(`The Gnosis Safe nonce is now ${ safeState.nonce.toString() }; this stack starts at ${ stack.baseNonce.toString() }.`)
		}
	})
}

export async function validateSafeStackAtCurrentNonce(provider: InjectedProvider, stackExport: SafeStackExport) {
	return await validateSafeStackWithNonceValidator(provider, stackExport, (safeState, stack) => {
		const endNonce = stack.baseNonce + BigInt(stack.transactions.length)
		if (safeState.nonce < stack.baseNonce) {
			throw new Error(`The Gnosis Safe nonce is ${ safeState.nonce.toString() }; this stack starts at ${ stack.baseNonce.toString() }.`)
		}
		if (safeState.nonce >= endNonce) {
			const finalStackNonce = endNonce - 1n
			throw new Error(
				`This stack is stale: the Gnosis Safe has advanced to nonce ${ safeState.nonce.toString() }, `
				+ `but the stack only contains nonce${ stack.transactions.length === 1 ? '' : 's' } `
				+ `${ stack.baseNonce.toString() }${ stack.transactions.length === 1 ? '' : ` through ${ finalStackNonce.toString() }` }. `
				+ 'Ask the proposer for a fresh Interceptor Gnosis Safe stack.',
			)
		}
	})
}

import { createContract } from 'micro-eth-signer/advanced/abi.js'
import { ERC721_INTERFACE_ID } from './abis/erc721Interface.js'
import { TOKEN_METADATA_ABI } from './abis/tokenMetadata.js'
import { addressString, bytesFromHex, bytesToHex, ensureHex } from './ethereum.js'
import type { InjectedProvider } from './provider.js'

const TokenMetadataContract = createContract(TOKEN_METADATA_ABI)

export class ContractMetadataUnavailableError extends Error {
	readonly name = 'ContractMetadataUnavailableError'
}

export function isContractMetadataUnavailableError(error: unknown): error is ContractMetadataUnavailableError {
	return error instanceof ContractMetadataUnavailableError
}

function contractCallErrorMessage(error: unknown): string | undefined {
	if (error instanceof Error && error.message.trim().length > 0) return error.message
	if (typeof error !== 'object' || error === null) return undefined
	const record = error as Readonly<Record<string, unknown>>
	if (typeof record.message === 'string' && record.message.trim().length > 0) return record.message
	if (typeof record.data === 'object' && record.data !== null) {
		const data = record.data as Readonly<Record<string, unknown>>
		if (typeof data.message === 'string' && data.message.trim().length > 0) return data.message
	}
	return undefined
}

function isContractCallRevert(error: unknown) {
	const message = contractCallErrorMessage(error)
	return message !== undefined && /(?:call exception|execution reverted|invalid opcode|missing revert data)/iu.test(message)
}

async function readContract(provider: InjectedProvider, contractAddress: bigint, data: Uint8Array, label: string) {
	let result: unknown
	try {
		result = await provider.request({
			method: 'eth_call',
			params: [{ to: addressString(contractAddress), data: bytesToHex(data) }, 'latest'],
		})
	} catch (contractCallError) {
		if (!isContractCallRevert(contractCallError)) throw contractCallError
		throw new ContractMetadataUnavailableError(`${ label } is unavailable because the contract call reverted.`, { cause: contractCallError })
	}
	if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(result)) throw new ContractMetadataUnavailableError(`${ label } is not valid ABI-encoded bytes.`)
	return bytesFromHex(ensureHex(result, label))
}

function requireAbiWord(response: Uint8Array, label: string) {
	if (response.length !== 32) throw new ContractMetadataUnavailableError(`${ label } is not one ABI word.`)
}

function requireZeroPrefix(response: Uint8Array, prefixLength: number, label: string) {
	for (let index = 0; index < prefixLength; index += 1) {
		if (response[index] !== 0) throw new ContractMetadataUnavailableError(`${ label } is not canonically ABI encoded.`)
	}
}

export async function readTokenBalance(provider: InjectedProvider, tokenAddress: bigint, owner: bigint, symbol = 'Token') {
	const label = `${ symbol } balanceOf result`
	const response = await readContract(provider, tokenAddress, TokenMetadataContract.balanceOf.encodeInput(addressString(owner)), label)
	requireAbiWord(response, label)
	return TokenMetadataContract.balanceOf.decodeOutput(response)
}

export async function readTokenDecimals(provider: InjectedProvider, tokenAddress: bigint) {
	const response = await readContract(provider, tokenAddress, TokenMetadataContract.decimals.encodeInput(), 'Token decimals result')
	requireAbiWord(response, 'Token decimals result')
	requireZeroPrefix(response, 31, 'Token decimals result')
	return Number(TokenMetadataContract.decimals.decodeOutput(response))
}

export async function readIsErc721(provider: InjectedProvider, tokenAddress: bigint) {
	const response = await readContract(provider, tokenAddress, TokenMetadataContract.supportsInterface.encodeInput(ERC721_INTERFACE_ID), 'ERC-721 interface result')
	requireAbiWord(response, 'ERC-721 interface result')
	requireZeroPrefix(response, 31, 'ERC-721 interface result')
	if (response[31] !== 0 && response[31] !== 1) throw new ContractMetadataUnavailableError('ERC-721 interface result is not a canonical ABI boolean.')
	return TokenMetadataContract.supportsInterface.decodeOutput(response)
}

export async function readVaultAsset(provider: InjectedProvider, vaultAddress: bigint) {
	const response = await readContract(provider, vaultAddress, TokenMetadataContract.asset.encodeInput(), 'Vault asset result')
	requireAbiWord(response, 'Vault asset result')
	requireZeroPrefix(response, 12, 'Vault asset result')
	return BigInt(TokenMetadataContract.asset.decodeOutput(response))
}

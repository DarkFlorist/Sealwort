import { ERC721, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { bytesFromHex, functionSelector } from '../ethereum.js'

const ERC721_INTERFACE_FUNCTIONS = new Set([
	'approve',
	'balanceOf',
	'getApproved',
	'isApprovedForAll',
	'ownerOf',
	'safeTransferFrom',
	'setApprovalForAll',
	'transferFrom',
])

export const ERC721_INTERFACE_ABI: ContractABI = ERC721.filter((entry) =>
	entry.type === 'function' && ERC721_INTERFACE_FUNCTIONS.has(entry.name),
)

function deriveInterfaceId(abi: ContractABI) {
	const interfaceId = new Uint8Array(4)
	for (const entry of abi) {
		if (entry.type !== 'function' || entry.name === undefined) continue
		const signature = `${ entry.name }(${ (entry.inputs ?? []).map(({ type }) => type).join(',') })`
		const selector = bytesFromHex(functionSelector(signature))
		for (let index = 0; index < interfaceId.length; index += 1) interfaceId[index] = (interfaceId[index] ?? 0) ^ (selector[index] ?? 0)
	}
	return interfaceId
}

export const ERC721_INTERFACE_ID = deriveInterfaceId(ERC721_INTERFACE_ABI)

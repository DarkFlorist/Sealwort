import { ERC1155, ERC20, ERC721, WETH, type ContractABI } from 'micro-eth-signer/advanced/abi.js'
import { CUSTOM_PAYMENT_ABI } from './customPayment.js'
import { ERC2612_ABI } from './erc2612.js'
import { ERC4626_ABI } from './erc4626.js'
import { ERC7540_ABI } from './erc7540.js'

export const TRANSACTION_ABIS: readonly ContractABI[] = [ERC20, ERC721, ERC1155, WETH, ERC2612_ABI, ERC4626_ABI, ERC7540_ABI, CUSTOM_PAYMENT_ABI]

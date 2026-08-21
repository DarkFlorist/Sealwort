import { useSignal } from '@preact/signals'
import { DEFAULT_ETHEREUM_RPC_URL } from '../rpcSettings.js'

export function RpcSettings({ rpcUrl, disabled, onSave }: {
	readonly rpcUrl: string
	readonly disabled: boolean
	readonly onSave: (rpcUrl: string) => boolean
}) {
	const draftUrl = useSignal(rpcUrl)
	const message = useSignal<string | undefined>(undefined)
	const validationError = useSignal<string | undefined>(undefined)

	const save = (value: string) => {
		try {
			const persisted = onSave(value)
			draftUrl.value = value.trim()
			validationError.value = undefined
			message.value = persisted
				? 'RPC endpoint saved.'
				: 'RPC endpoint applied for this session, but browser storage is unavailable.'
		} catch (error) {
			message.value = undefined
			validationError.value = error instanceof Error ? error.message : 'Could not update the Ethereum RPC URL.'
		}
	}

	return <details class = 'rpc-settings'>
		<summary>RPC settings</summary>
		<form onSubmit = { (event) => {
			event.preventDefault()
			save(draftUrl.value)
		} }>
			<label for = 'ethereum-rpc-url'>Ethereum Mainnet RPC URL</label>
			<input
				id = 'ethereum-rpc-url'
				type = 'url'
				inputMode = 'url'
				spellcheck = { false }
				required
				disabled = { disabled }
				value = { draftUrl.value }
				onInput = { (event) => {
					draftUrl.value = event.currentTarget.value
					message.value = undefined
					validationError.value = undefined
				} }
			/>
			<p class = 'rpc-settings-note'>Used only when wallet is not connected</p>
			<div class = 'rpc-settings-actions'>
				<button type = 'submit' disabled = { disabled }>Save</button>
				<button type = 'button' class = 'secondary' disabled = { disabled || draftUrl.value === DEFAULT_ETHEREUM_RPC_URL } onClick = { () => { save(DEFAULT_ETHEREUM_RPC_URL) } }>Use default</button>
			</div>
			{ validationError.value === undefined ? <></> : <p class = 'rpc-settings-error' role = 'alert'>{ validationError.value }</p> }
			{ message.value === undefined ? <></> : <p class = 'rpc-settings-message' role = 'status'>{ message.value }</p> }
		</form>
	</details>
}

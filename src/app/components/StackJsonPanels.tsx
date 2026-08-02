import type { RefObject } from 'preact'

function DisclosureButton({ expanded, controls, label, onToggle }: {
	readonly expanded: boolean
	readonly controls: string
	readonly label: string
	readonly onToggle: () => void
}) {
	const action = expanded ? 'Collapse' : 'Expand'
	return <button
		class = 'stack-input-disclosure'
		type = 'button'
		aria-controls = { controls }
		aria-expanded = { expanded }
		aria-label = { `${ action } ${ label }` }
		title = { `${ action } ${ label }` }
		onClick = { onToggle }
	>
		<span class = { `disclosure-chevron${ expanded ? ' expanded' : '' }` } aria-hidden = 'true'></span>
	</button>
}

export function StackJsonInput({ textareaRef, value, expanded, disabled, onValueChange, onToggle, onFileChange }: {
	readonly textareaRef: RefObject<HTMLTextAreaElement>
	readonly value: string
	readonly expanded: boolean
	readonly disabled: boolean
	readonly onValueChange: (value: string) => void
	readonly onToggle: () => void
	readonly onFileChange: (file: File | undefined) => Promise<void>
}) {
	return <section class = 'panel'><div class = 'import-grid'>
		<div class = 'stack-input-heading'>
			<label for = 'safe-stack-input'>Gnosis Safe Stack JSON</label>
			<DisclosureButton expanded = { expanded } controls = 'safe-stack-input' label = 'stack input' onToggle = { onToggle }/>
		</div>
		<textarea
			ref = { textareaRef }
			id = 'safe-stack-input'
			class = { `stack-input${ expanded ? ' expanded' : '' }` }
			disabled = { disabled }
			placeholder = 'Paste an Interceptor Gnosis Safe Stack JSON export'
			value = { value }
			onInput = { (event) => { onValueChange(event.currentTarget.value) } }
			spellcheck = { false }
		/>
		<div class = 'toolbar'><label class = { `file-label${ disabled ? ' disabled' : '' }` }>
			Choose JSON file
			<input class = 'file-input' type = 'file' accept = 'application/json,.json' disabled = { disabled } onChange = { (event) => {
				const input = event.currentTarget
				void onFileChange(input.files?.[0]).finally(() => { input.value = '' })
			} }/>
		</label></div>
	</div></section>
}

export function UpdatedStackPanel({ textareaRef, value, expanded, onToggle }: {
	readonly textareaRef: RefObject<HTMLTextAreaElement>
	readonly value: string
	readonly expanded: boolean
	readonly onToggle: () => void
}) {
	return <section class = 'panel updated-stack' aria-live = 'polite'>
		<p class = 'eyebrow'>Signed export</p>
		<div class = 'stack-input-heading'>
			<h2>Updated Gnosis Safe Stack JSON</h2>
			<DisclosureButton expanded = { expanded } controls = 'updated-safe-stack-json' label = 'updated stack' onToggle = { onToggle }/>
		</div>
		<p class = 'muted'>Share this updated stack with the other Gnosis Safe signers so they can review and sign it.</p>
		<textarea ref = { textareaRef } id = 'updated-safe-stack-json' class = { `stack-input updated-stack-json${ expanded ? ' expanded' : '' }` } aria-label = 'Updated Gnosis Safe Stack JSON' readOnly value = { value } wrap = 'soft' spellcheck = { false }/>
	</section>
}

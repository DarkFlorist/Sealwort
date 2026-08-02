import type { ComponentChildren } from 'preact'

export function Spinner({ size = '1em' }: { readonly size?: string }) {
	return <svg
		aria-hidden = 'true'
		class = 'spinner'
		style = { { height: size, width: size } }
		viewBox = '0 0 100 100'
		xmlns = 'http://www.w3.org/2000/svg'
	>
		<circle cx = '50' cy = '50' r = '45'/>
	</svg>
}

export function LoadingIndicator({ children, size }: {
	readonly children: ComponentChildren
	readonly size?: string
}) {
	return <span class = 'loading-indicator'>
		<Spinner { ...size === undefined ? {} : { size } }/>
		<span>{ children }</span>
	</span>
}

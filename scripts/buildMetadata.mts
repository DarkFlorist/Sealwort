export function normalizeRepositoryUrl(value: string) {
	const trimmedValue = value.trim()
	const scpMatch = /^[^/@:]+@([^:]+):(.+)$/u.exec(trimmedValue)
	let repositoryUrl: URL
	try {
		if (scpMatch !== null) {
			repositoryUrl = new URL(`https://${ scpMatch[1] }/${ scpMatch[2] }`)
		} else {
			const parsedUrl = new URL(trimmedValue)
			repositoryUrl = parsedUrl.protocol === 'ssh:'
				? new URL(`https://${ parsedUrl.hostname }${ parsedUrl.pathname }`)
				: parsedUrl
		}
	} catch {
		throw new Error(`Build repository URL is invalid: ${ trimmedValue }`)
	}
	if (repositoryUrl.protocol !== 'https:' && repositoryUrl.protocol !== 'http:') {
		throw new Error(`Build repository URL must use HTTP, HTTPS, or SSH: ${ trimmedValue }`)
	}
	repositoryUrl.hash = ''
	repositoryUrl.search = ''
	repositoryUrl.pathname = repositoryUrl.pathname.replace(/\/+$/u, '').replace(/\.git$/u, '')
	return repositoryUrl.href.replace(/\/$/u, '')
}

import { copyFile, mkdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dir, '..')
const sourceDirectory = path.join(repositoryRoot, 'src')
const outputDirectory = path.join(sourceDirectory, 'dist')
const outputJavascriptDirectory = path.join(outputDirectory, 'js')
const outputStylesDirectory = path.join(outputDirectory, 'styles')
const outputAssetsDirectory = path.join(outputDirectory, 'assets')

function readGitValue(arguments_: readonly string[]) {
	try {
		return execFileSync('git', arguments_, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
	} catch {
		return undefined
	}
}

const release = process.env.SEALWORT_RELEASE?.trim() || readGitValue(['describe', '--tags', '--exact-match'])
const commitHash = process.env.SEALWORT_COMMIT_HASH?.trim() || process.env.GITHUB_SHA?.trim() || readGitValue(['rev-parse', 'HEAD'])
if (commitHash === undefined || commitHash.length === 0) {
	throw new Error('Build commit information is unavailable. Set SEALWORT_COMMIT_HASH when building outside a Git checkout.')
}

await rm(outputDirectory, { recursive: true, force: true })
await Promise.all([
	mkdir(outputJavascriptDirectory, { recursive: true }),
	mkdir(outputStylesDirectory, { recursive: true }),
	mkdir(outputAssetsDirectory, { recursive: true }),
])

const result = await Bun.build({
	entrypoints: [path.join(sourceDirectory, 'app', 'bootstrap.tsx')],
	outdir: outputJavascriptDirectory,
	target: 'browser',
	format: 'esm',
	minify: true,
	sourcemap: 'linked',
	naming: 'main.js',
	define: {
		SEALWORT_RELEASE: JSON.stringify(release ?? ''),
		SEALWORT_COMMIT_HASH: JSON.stringify(commitHash),
	},
})

if (!result.success) {
	for (const log of result.logs) console.error(log)
	throw new Error('Failed to build the Interceptor Safe co-signer application.')
}

await Promise.all([
	copyFile(path.join(sourceDirectory, 'index.html'), path.join(outputDirectory, 'index.html')),
	copyFile(path.join(sourceDirectory, 'styles', 'styles.css'), path.join(outputStylesDirectory, 'styles.css')),
	copyFile(path.join(sourceDirectory, 'assets', 'sealwort-icon.png'), path.join(outputAssetsDirectory, 'sealwort-icon.png')),
	copyFile(path.join(sourceDirectory, 'assets', 'sealwort-botanical.svg'), path.join(outputAssetsDirectory, 'sealwort-botanical.svg')),
	copyFile(path.join(sourceDirectory, '_headers'), path.join(outputDirectory, '_headers')),
])

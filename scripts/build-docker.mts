import path from 'node:path'
import { readBuildMetadata } from './buildMetadata.mjs'

const imageTag = process.argv[2]
if (imageTag === undefined || process.argv.length !== 3) {
	console.error(`Usage: ${ process.argv[1] ?? 'scripts/build-docker.mts' } IMAGE_TAG`)
	process.exit(2)
}

const repositoryRoot = path.resolve(import.meta.dir, '..')
const { release, commitHash, repositoryUrl } = await readBuildMetadata(repositoryRoot)
const docker = Bun.spawn([
	'docker',
	'build',
	'--build-arg', `SEALWORT_RELEASE=${ release ?? '' }`,
	'--build-arg', `SEALWORT_COMMIT_HASH=${ commitHash ?? '' }`,
	'--build-arg', `SEALWORT_REPOSITORY_URL=${ repositoryUrl ?? '' }`,
	'--file', 'Dockerfile',
	'--tag', imageTag,
	'.',
], {
	cwd: repositoryRoot,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})
process.exit(await docker.exited)

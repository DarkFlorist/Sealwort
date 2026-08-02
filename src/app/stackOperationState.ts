export function isCurrentStackOperation<T>(
	currentRevision: number,
	operationRevision: number,
	currentStack: T | undefined,
	operationStack: T | undefined,
) {
	return currentRevision === operationRevision && currentStack === operationStack
}

export function runBackgroundTask(task: Promise<unknown>, onRejected: (error: unknown) => void) {
	void task.catch(onRejected)
}

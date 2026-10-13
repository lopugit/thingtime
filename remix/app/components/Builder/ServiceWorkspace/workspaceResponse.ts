export async function readWorkspaceResponse(response: Response) {
	let result: any;
	try {
		result = await response.json();
	} catch {
		throw Object.assign(new Error(`The workspace service is temporarily unavailable (HTTP ${response.status}). Please try again.`), {
			status: response.status
		});
	}
	if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.error || 'Workspace request failed'), { status: response.status });
	return result;
}

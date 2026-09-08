import type { ThingtimeNodePermission, ThingtimeNodePermissions } from '~/utils/electronBridge';

type PermissionSnapshot = {
	permissions: ThingtimeNodePermission[];
	permissionsCheckedAt: number | null;
	permissionCheckError: string | null;
};

export function permissionSnapshot(
	previous: PermissionSnapshot,
	result: PromiseSettledResult<ThingtimeNodePermissions | undefined>,
	checkedAt: number
): PermissionSnapshot {
	const permissions = result.status === 'fulfilled' ? result.value?.permissions : undefined;
	const complete =
		permissions?.some((permission) => permission.kind === 'accessibility') &&
		permissions.some((permission) => permission.kind === 'screenRecording' || permission.kind === 'screen-recording');
	if (!complete || !permissions) {
		return {
			permissions: previous.permissions,
			permissionsCheckedAt: previous.permissionsCheckedAt,
			permissionCheckError: 'Could not check macOS access. Check that the node is running, then try Check access again.'
		};
	}
	return { permissions, permissionsCheckedAt: checkedAt, permissionCheckError: null };
}

export function permissionStatusLabel(status: string, stale: boolean): string {
	const label = status === 'authorized' ? 'Allowed' : status === 'denied' ? 'Not allowed by macOS' : 'Not confirmed';
	return stale ? `${label} (last known)` : label;
}

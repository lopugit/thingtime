import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';
import React from 'react';
import { Menu, MenuButton, MenuList, MenuItem, MenuDivider, IconButton, Portal } from '@chakra-ui/react';
import { MoreHorizontal, Pencil, Copy, Trash2, RotateCcw } from 'lucide-react';
import { serviceTitle, type ServiceRecord } from '~/schemas/serviceWorkspace';
export function ServiceRecordMenu({
	record,
	edit,
	duplicate,
	remove,
	disabled
}: {
	record: ServiceRecord;
	edit: () => void;
	duplicate: () => void;
	remove: () => void;
	disabled?: boolean;
}) {
	return (
		<Menu placement="bottom-end" isLazy>
			<MenuButton
				as={IconButton}
				size="sm"
				variant="ghost"
				icon={<MoreHorizontal size={20} />}
				aria-label={`Options for ${serviceTitle(record)}`}
				isDisabled={disabled}
			/>
			<Portal>
				<MenuList zIndex={DRAWER_POPUP_Z} minWidth="180px">
					<MenuItem icon={<Pencil size={15} />} onClick={edit}>
						Edit
					</MenuItem>
					{record.kind !== 'member' && record.kind !== 'link' && (
						<MenuItem icon={<Copy size={15} />} onClick={duplicate}>
							Duplicate
						</MenuItem>
					)}
					<MenuDivider />
					<MenuItem
						icon={record.values.archived ? <RotateCcw size={15} /> : <Trash2 size={15} />}
						color={record.values.archived ? undefined : 'red.600'}
						onClick={remove}
					>
						{record.values.archived ? 'Restore' : 'Delete'}
					</MenuItem>
				</MenuList>
			</Portal>
		</Menu>
	);
}

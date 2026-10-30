import React, { memo } from 'react';

import { Box, Button, Flex, Menu, MenuButton, MenuList, Portal, Text } from '@chakra-ui/react';
import { AppWindow, LockKeyhole, MoreHorizontal } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceRunningApp } from './deviceTypes';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton, DevicePolicyMenuItem } from './DeviceStateGrid';
import { DeviceStatusPill } from './DeviceCard';

export type DeviceApplicationsProps = {
	deviceId: string;
	applications: DeviceRunningApp[];
	activeAppBundleId?: string | null;
	locked?: boolean | null;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceApplications = memo(
	({ deviceId, applications, activeAppBundleId = null, locked = false, controlFor, onAction }: DeviceApplicationsProps) => {
		if (!applications.length) {
			return (
				<Box
					border="1px dashed var(--tt-border-strong, #d4d4d8)"
					borderRadius="var(--tt-radius-md, 12px)"
					color="var(--tt-muted, #71717a)"
					fontSize="12px"
					padding={4}
					textAlign="center"
				>
					No running applications are reported.
				</Box>
			);
		}

		const ordered = [...applications].sort((left, right) => {
			const leftActive = left.bundleId === activeAppBundleId || left.isActive;
			const rightActive = right.bundleId === activeAppBundleId || right.isActive;
			return Number(rightActive) - Number(leftActive) || left.name.localeCompare(right.name);
		});

		return (
			<Box border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" overflow="hidden">
				<Flex alignItems="center" borderBottom="1px solid var(--tt-border, #ececef)" justifyContent="space-between" paddingX={3} paddingY={2}>
					<Text fontSize="11px" fontWeight={700} textTransform="uppercase">
						Applications
					</Text>
					{controlFor?.('hide-other-apps') ? (
						<Menu placement="bottom-end">
							<MenuButton aria-label="Application actions" as={Button} minWidth={8} size="xs" variant="ghost">
								<MoreHorizontal aria-hidden size={15} />
							</MenuButton>
							<Portal>
								<MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>
									<DevicePolicyMenuItem
										action="hide-other-apps"
										controlFor={controlFor}
										deviceId={deviceId}
										input={{}}
										label="Hide other apps"
										onAction={onAction}
									/>
								</MenuList>
							</Portal>
						</Menu>
					) : null}
				</Flex>
				{locked ? (
					<Flex
						alignItems="center"
						background="rgba(217, 119, 6, 0.08)"
						color="var(--tt-warning, #b45309)"
						fontSize="11px"
						gap={2}
						paddingX={3}
						paddingY={2}
					>
						<LockKeyhole aria-hidden size={13} />
						App actions remain unavailable unless their capability explicitly allows locked use.
					</Flex>
				) : null}
				{ordered.map((application, index) => {
					const isActive = application.bundleId === activeAppBundleId || application.isActive;
					const isHidden = application.isHidden === true;
					const launchControl = controlFor?.('launch-app', application.bundleId);
					const quitControl = controlFor?.('quit-app', application.bundleId);
					const forceQuitControl = controlFor?.('force-quit-app', application.bundleId);
					const blockedMessage =
						(!launchControl?.policy.allowed && launchControl?.policy.message) ||
						(!quitControl?.policy.allowed && quitControl?.policy.message) ||
						(!forceQuitControl?.policy.allowed && forceQuitControl?.policy.message) ||
						null;
					return (
						<Box
							borderTop={index > 0 || locked ? '1px solid var(--tt-border, #ececef)' : undefined}
							key={application.bundleId}
							paddingX={3}
							paddingY={2.5}
						>
							<Flex alignItems="center" gap={2.5} minWidth={0}>
								<Flex
									alignItems="center"
									background="var(--tt-surface-alt, #f2f2f5)"
									borderRadius="9px"
									color="var(--tt-muted, #71717a)"
									flexShrink={0}
									height="32px"
									justifyContent="center"
									width="32px"
								>
									<AppWindow aria-hidden size={16} />
								</Flex>
								<Box flex="1" minWidth={0}>
									<Flex alignItems="center" gap={1.5} minWidth={0}>
										<Text fontSize="12px" fontWeight={700} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
											{application.name || application.bundleId}
										</Text>
										{isActive ? <DeviceStatusPill label="active" tone="positive" /> : null}
										{isHidden ? <DeviceStatusPill label="hidden" tone="neutral" /> : null}
									</Flex>
									<Text color="var(--tt-muted, #71717a)" fontSize="10px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
										{application.bundleId}
										{typeof application.windowCount === 'number'
											? ` · ${application.windowCount} window${application.windowCount === 1 ? '' : 's'}`
											: ''}
									</Text>
								</Box>
								<Flex flexShrink={0} gap={1}>
									<DevicePolicyButton
										action="launch-app"
										controlFor={controlFor}
										deviceId={deviceId}
										input={{ appId: application.bundleId }}
										label={isActive ? 'Focus' : 'Open'}
										onAction={onAction}
										targetId={application.bundleId}
										variant="ghost"
									/>
									<Menu placement="bottom-end">
										<MenuButton
											aria-label={`More actions for ${application.name || application.bundleId}`}
											as={Button}
											minWidth={8}
											size="xs"
											variant="ghost"
										>
											<MoreHorizontal aria-hidden size={15} />
										</MenuButton>
										<Portal>
											<MenuList fontSize="12px" zIndex={DRAWER_POPUP_Z}>
												<DevicePolicyMenuItem
													action="launch-app"
													controlFor={controlFor}
													deviceId={deviceId}
													input={{ appId: application.bundleId }}
													label={isActive ? 'Focus app' : 'Open app'}
													onAction={onAction}
													targetId={application.bundleId}
												/>
												<DevicePolicyMenuItem
													action={isHidden ? 'unhide-app' : 'hide-app'}
													controlFor={controlFor}
													deviceId={deviceId}
													input={{ appId: application.bundleId }}
													label={isHidden ? 'Show app' : 'Hide app'}
													onAction={onAction}
													targetId={application.bundleId}
												/>
												<DevicePolicyMenuItem
													action="quit-app"
													color="var(--tt-danger, #dc2626)"
													controlFor={controlFor}
													deviceId={deviceId}
													input={{ appId: application.bundleId }}
													label="Quit app"
													onAction={onAction}
													targetId={application.bundleId}
												/>
												<DevicePolicyMenuItem
													action="force-quit-app"
													color="var(--tt-danger, #dc2626)"
													controlFor={controlFor}
													deviceId={deviceId}
													input={{ appId: application.bundleId }}
													label="Force quit…"
													onAction={onAction}
													targetId={application.bundleId}
												/>
											</MenuList>
										</Portal>
									</Menu>
								</Flex>
							</Flex>
							{blockedMessage ? (
								<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginLeft="42px" marginTop={1}>
									{blockedMessage}
								</Text>
							) : null}
						</Box>
					);
				})}
			</Box>
		);
	}
);
DeviceApplications.displayName = 'DeviceApplications';

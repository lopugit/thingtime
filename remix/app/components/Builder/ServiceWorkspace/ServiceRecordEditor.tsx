import { DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import React from 'react';
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton } from '@chakra-ui/react';
import { SERVICE_FIELDS, SERVICE_SINGULAR, serviceTitle, type ServiceKind, type ServiceRecord } from '~/schemas/serviceWorkspace';
import { ServiceAddressSearch } from './ServiceMaps';
import { workspaceRequest, type WorkspaceSnapshot } from './client';

export type ServiceDraft = { kind: ServiceKind; record?: ServiceRecord; defaults?: Record<string, any> };
export function ServiceRecordEditor({
	draft,
	data,
	close,
	saved,
	report
}: {
	draft: ServiceDraft;
	data: WorkspaceSnapshot;
	close: () => void;
	saved: (id: string, outcome: { kind: ServiceKind; values: Record<string, any>; created: boolean }) => Promise<void>;
	report: (error: unknown) => void;
}) {
	const [values, setValues] = React.useState<Record<string, any>>(() => ({
		...Object.fromEntries(SERVICE_FIELDS[draft.kind].filter((f) => f.options).map((f) => [f.key, f.options![0]])),
		...draft.defaults,
		...draft.record?.values
	}));
	const recordId = React.useRef(draft.record?.id || crypto.randomUUID());
	const [saving, setSaving] = React.useState(false);
	const [error, setError] = React.useState('');
	const busy = React.useRef(false);
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy.current) return;
		// Native date/time pickers and autofill can update the form before React's change event.
		const submittedValues = { ...values, ...Object.fromEntries(new FormData(event.currentTarget).entries()) };
		busy.current = true;
		setSaving(true);
		setError('');
		try {
			const response = await workspaceRequest(data.rootId, {
				operation: 'save',
				kind: draft.kind,
				id: recordId.current,
				values: submittedValues,
				...(draft.record ? { expectedUpdatedAt: draft.record.updatedAt } : {})
			});
			await saved(response.id, { kind: draft.kind, values: submittedValues, created: !draft.record });
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Could not save');
			report(failure);
		} finally {
			busy.current = false;
			setSaving(false);
		}
	}
	return (
		<Modal
			isOpen
			onClose={() => {
				if (!saving) close();
			}}
			size="xl"
			scrollBehavior="inside"
			closeOnOverlayClick={false}
		>
			<ModalOverlay zIndex={DRAWER_MODAL_Z} />
			<ModalContent containerProps={{ zIndex: DRAWER_MODAL_Z + 1 }} mx={3} maxH="calc(100dvh - 48px)" my={6} className="service-workspace sw-modal">
				<ModalHeader>
					{draft.record ? 'Edit' : 'Add'} {SERVICE_SINGULAR[draft.kind]}
				</ModalHeader>
				<ModalCloseButton isDisabled={saving} />
				<ModalBody pb={6}>
					<form className="sw-form" onSubmit={submit}>
						{draft.kind === 'address' && (
							<ServiceAddressSearch
								rootId={data.rootId}
								selected={(address, placeId) => setValues((v) => ({ ...v, address, placeId }))}
								report={report}
							/>
						)}
						{SERVICE_FIELDS[draft.kind].map((field) => {
							let options = field.ref ? data.records.filter((r) => r.kind === field.ref && !r.values.archived) : [];
							if (field.key === 'subjobId' && values.visitId) {
								const job = data.records.find((r) => r.id === values.visitId)?.values.jobId;
								options = options.filter((r) => r.values.jobId === job);
							}
							if (field.key === 'batteryId' || field.key === 'vehicleId')
								options = options.filter((r) => r.values.category === (field.key === 'batteryId' ? 'Battery' : 'Vehicle'));
							const change = (value: string) =>
								setValues((v) => ({
									...v,
									[field.key]: value,
									...(field.key === 'address' ? { placeId: '' } : {}),
									...(field.key === 'jobId' && draft.kind === 'visit' && !v.title
										? { title: data.records.find((record) => record.id === value)?.values.title || '' }
										: {}),
									...(field.key === 'visitId' ? { subjobId: '' } : {})
								}));
							const common = {
								id: `sw-field-${field.key}`,
								name: field.key,
								required: field.required,
								disabled: saving || (field.key === 'username' && !!draft.record),
								value: values[field.key] ?? '',
								onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => change(e.target.value)
							};
							return (
								<label key={field.key} className={field.type === 'textarea' ? 'sw-wide' : ''} htmlFor={common.id}>
									<span>
										{field.label}
										{field.required ? ' *' : ''}
									</span>
									{field.ref || field.options ? (
										<select {...common}>
											<option value="">Choose…</option>
											{field.options?.map((value) => (
												<option key={value}>{value}</option>
											))}
											{field.ref === 'member'
												? data.team.map((member) => (
														<option key={member.id} value={member.id}>
															{member.name} · {member.role}
														</option>
												  ))
												: options.map((r) => (
														<option key={r.id} value={r.id}>
															{serviceTitle(r)}
															{r.kind === 'visit' ? ` · ${r.values.date}` : ''}
														</option>
												  ))}
										</select>
									) : field.type === 'textarea' ? (
										<textarea {...common} rows={4} maxLength={10000} />
									) : (
										<input
											{...common}
											onInput={(e) => change(e.currentTarget.value)}
											type={field.type || 'text'}
											min={field.min}
											max={field.max}
											step={field.type === 'number' ? 'any' : undefined}
											maxLength={500}
										/>
									)}
								</label>
							);
						})}
						{draft.kind === 'member' && (
							<p className="sw-muted sw-wide">
								Admins manage team access. Employees and Lopu users manage operations. Customers and B2B users see only the selected customer account
								and its linked properties and visits. Use an existing Thingtime username.
							</p>
						)}
						{error && (
							<p role="alert" className="sw-error sw-wide">
								{error}
							</p>
						)}
						<div className="sw-buttons sw-wide">
							<button type="submit" className="sw-primary" disabled={saving}>
								{saving ? 'Saving…' : 'Save'}
							</button>
							<button type="button" disabled={saving} onClick={close}>
								Cancel
							</button>
						</div>
					</form>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}

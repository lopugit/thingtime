import React from 'react';
import { MapPin, Users, UserRound } from 'lucide-react';
import type { ServiceJobContextData } from '~/schemas/serviceWorkspaceContext';

export function ServiceJobContext({ context, job = false }: { context?: ServiceJobContextData; job?: boolean }) {
	if (!context) return null;
	return (
		<span className="sw-job-context">
			<span className="sw-context-row">
				<MapPin size={14} aria-hidden="true" />
				<span>
					<span className="sw-sr">Property: </span>
					{context.property}
				</span>
			</span>
			<span className="sw-context-row">
				<Users size={14} aria-hidden="true" />
				<span>Customers: {context.customers.join(', ') || 'No linked customer'}</span>
			</span>
			<span className="sw-context-row">
				<UserRound size={14} aria-hidden="true" />
				<span>
					{job ? 'Visit crew' : 'Assigned crew'}: {context.crew.join(', ') || (context.assigned ? 'Assigned' : 'Unassigned')}
				</span>
			</span>
		</span>
	);
}

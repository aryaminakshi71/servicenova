import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
	fieldDashboardOnboardingStates,
	fieldDriftAlertAcknowledgements,
	fieldIncidentTimeline,
} from '../../../drizzle/schema';
import type {
	DashboardOnboardingState,
	DriftAlertAcknowledgement,
	FieldDashboardStateStore,
	IncidentTimelineEvent,
} from '../field-dashboard-state';
import { withDbSpan } from './db-tracing';

type DrizzleDb = {
	select?: (...args: unknown[]) => unknown;
	insert: (table: unknown) => {
		values: (value: unknown) => {
			onConflictDoUpdate?: (config: unknown) => Promise<unknown>;
			execute?: () => Promise<unknown>;
		};
	};
	delete: (table: unknown) => {
		where: (filter: unknown) => Promise<unknown>;
	};
};

function normalizeTenantId(value: string | null | undefined) {
	return value?.trim() || 'default';
}

function toIso(value: unknown) {
	if (typeof value === 'string') {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return new Date().toISOString();
}

function toOnboardingState(
	row: Record<string, unknown>,
	fallbackUserId: string,
): DashboardOnboardingState {
	return {
		selectedJob: Boolean(row.selectedJob ?? row.selected_job ?? false),
		intelligenceRun: Boolean(
			row.intelligenceRun ?? row.intelligence_run ?? false,
		),
		dispatchOptimized: Boolean(
			row.dispatchOptimized ?? row.dispatch_optimized ?? false,
		),
		automationCycle: Boolean(
			row.automationCycle ?? row.automation_cycle ?? false,
		),
		dismissed: Boolean(row.dismissed ?? false),
		updatedAt: toIso(row.updatedAt ?? row.updated_at),
		updatedBy: String(row.updatedBy ?? row.updated_by ?? fallbackUserId),
	};
}

function toDriftAcknowledgement(
	row: Record<string, unknown>,
	fallbackAlertId: string,
): DriftAlertAcknowledgement {
	return {
		alertId: String(row.alertId ?? row.alert_id ?? fallbackAlertId),
		owner: String(row.owner ?? ''),
		acknowledgedBy: String(row.acknowledgedBy ?? row.acknowledged_by ?? ''),
		acknowledgedAt: toIso(row.acknowledgedAt ?? row.acknowledged_at),
		slaDueAt: toIso(row.slaDueAt ?? row.sla_due_at),
		note: (row.note ?? null) as string | null,
	};
}

function toIncidentEvent(row: Record<string, unknown>): IncidentTimelineEvent {
	const context = row.context;

	return {
		id: String(row.id),
		type: String(row.type),
		severity: String(row.severity) as IncidentTimelineEvent['severity'],
		message: String(row.message),
		timestamp: toIso(row.occurredAt ?? row.occurred_at ?? row.timestamp),
		actor: String(row.actor),
		context:
			typeof context === 'object' && context !== null
				? (context as Record<string, unknown>)
				: {},
	};
}

export class DrizzleFieldDashboardStateRepository
	implements FieldDashboardStateStore
{
	constructor(private readonly db: DrizzleDb) {}

	async getOnboarding(input: { tenantId: string; userId: string }) {
		const select = this.db.select;
		if (!select) {
			return null;
		}

		const tenantId = normalizeTenantId(input.tenantId);
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
				};
			};
		};

		return withDbSpan(
			'field_dashboard.onboarding.get',
			{ tenantId, entity: 'field_dashboard_onboarding_states' },
			async () => {
				const rows = await dbAny
					.select()
					.from(fieldDashboardOnboardingStates)
					.where(
						and(
							eq(fieldDashboardOnboardingStates.tenantId, tenantId),
							eq(fieldDashboardOnboardingStates.userId, input.userId),
						),
					);

				if (rows.length === 0) {
					return null;
				}

				return toOnboardingState(rows[0], input.userId);
			},
		);
	}

	async upsertOnboarding(input: {
		tenantId: string;
		userId: string;
		state: DashboardOnboardingState;
	}) {
		const tenantId = normalizeTenantId(input.tenantId);

		await withDbSpan(
			'field_dashboard.onboarding.upsert',
			{ tenantId, entity: 'field_dashboard_onboarding_states' },
			async () => {
				const query = this.db.insert(fieldDashboardOnboardingStates).values({
					tenantId,
					userId: input.userId,
					selectedJob: input.state.selectedJob,
					intelligenceRun: input.state.intelligenceRun,
					dispatchOptimized: input.state.dispatchOptimized,
					automationCycle: input.state.automationCycle,
					dismissed: input.state.dismissed,
					updatedAt: input.state.updatedAt,
					updatedBy: input.state.updatedBy,
				});

				if (query.onConflictDoUpdate) {
					await query.onConflictDoUpdate({
						target: [
							fieldDashboardOnboardingStates.tenantId,
							fieldDashboardOnboardingStates.userId,
						],
						set: {
							selectedJob: input.state.selectedJob,
							intelligenceRun: input.state.intelligenceRun,
							dispatchOptimized: input.state.dispatchOptimized,
							automationCycle: input.state.automationCycle,
							dismissed: input.state.dismissed,
							updatedAt: input.state.updatedAt,
							updatedBy: input.state.updatedBy,
						},
					});
					return;
				}

				if (query.execute) {
					await query.execute();
				}
			},
		);
	}

	async getDriftAcknowledgement(input: { tenantId: string; alertId: string }) {
		const select = this.db.select;
		if (!select) {
			return null;
		}

		const tenantId = normalizeTenantId(input.tenantId);
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
				};
			};
		};

		return withDbSpan(
			'field_dashboard.drift_ack.get',
			{ tenantId, entity: 'field_drift_alert_acknowledgements' },
			async () => {
				const rows = await dbAny
					.select()
					.from(fieldDriftAlertAcknowledgements)
					.where(
						and(
							eq(fieldDriftAlertAcknowledgements.tenantId, tenantId),
							eq(fieldDriftAlertAcknowledgements.alertId, input.alertId),
						),
					);

				if (rows.length === 0) {
					return null;
				}

				return toDriftAcknowledgement(rows[0], input.alertId);
			},
		);
	}

	async upsertDriftAcknowledgement(input: {
		tenantId: string;
		acknowledgement: DriftAlertAcknowledgement;
	}) {
		const tenantId = normalizeTenantId(input.tenantId);
		const acknowledgement = input.acknowledgement;

		await withDbSpan(
			'field_dashboard.drift_ack.upsert',
			{ tenantId, entity: 'field_drift_alert_acknowledgements' },
			async () => {
				const query = this.db.insert(fieldDriftAlertAcknowledgements).values({
					tenantId,
					alertId: acknowledgement.alertId,
					owner: acknowledgement.owner,
					acknowledgedBy: acknowledgement.acknowledgedBy,
					acknowledgedAt: acknowledgement.acknowledgedAt,
					slaDueAt: acknowledgement.slaDueAt,
					note: acknowledgement.note,
				});

				if (query.onConflictDoUpdate) {
					await query.onConflictDoUpdate({
						target: [
							fieldDriftAlertAcknowledgements.tenantId,
							fieldDriftAlertAcknowledgements.alertId,
						],
						set: {
							owner: acknowledgement.owner,
							acknowledgedBy: acknowledgement.acknowledgedBy,
							acknowledgedAt: acknowledgement.acknowledgedAt,
							slaDueAt: acknowledgement.slaDueAt,
							note: acknowledgement.note,
						},
					});
					return;
				}

				if (query.execute) {
					await query.execute();
				}
			},
		);
	}

	async listIncidentTimeline(input: { tenantId: string; limit: number }) {
		const select = this.db.select;
		if (!select) {
			return [];
		}

		const tenantId = normalizeTenantId(input.tenantId);
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => {
						orderBy: (
							...order: unknown[]
						) => Promise<Array<Record<string, unknown>>>;
					};
				};
			};
		};

		return withDbSpan(
			'field_dashboard.incident.list',
			{ tenantId, entity: 'field_incident_timeline' },
			async () => {
				const rows = await dbAny
					.select()
					.from(fieldIncidentTimeline)
					.where(eq(fieldIncidentTimeline.tenantId, tenantId))
					.orderBy(
						desc(fieldIncidentTimeline.occurredAt),
						desc(fieldIncidentTimeline.id),
					);

				return rows
					.slice(0, Math.max(1, input.limit))
					.map((row) => toIncidentEvent(row));
			},
		);
	}

	async appendIncident(input: {
		tenantId: string;
		event: IncidentTimelineEvent;
		maxPerTenant: number;
	}) {
		const tenantId = normalizeTenantId(input.tenantId);
		const maxPerTenant = Math.max(1, input.maxPerTenant);
		const select = this.db.select;

		await withDbSpan(
			'field_dashboard.incident.append',
			{ tenantId, entity: 'field_incident_timeline' },
			async () => {
				const insert = this.db.insert(fieldIncidentTimeline).values({
					id: input.event.id,
					tenantId,
					type: input.event.type,
					severity: input.event.severity,
					message: input.event.message,
					occurredAt: input.event.timestamp,
					actor: input.event.actor,
					context: input.event.context,
				});

				if (insert.execute) {
					await insert.execute();
				}

				if (!select) {
					return;
				}

				const dbAny = this.db as unknown as {
					select: () => {
						from: (table: unknown) => {
							where: (filter: unknown) => {
								orderBy: (
									...order: unknown[]
								) => Promise<Array<Record<string, unknown>>>;
							};
						};
					};
				};

				const rows = await dbAny
					.select()
					.from(fieldIncidentTimeline)
					.where(eq(fieldIncidentTimeline.tenantId, tenantId))
					.orderBy(
						desc(fieldIncidentTimeline.occurredAt),
						desc(fieldIncidentTimeline.id),
					);

				const staleIds = rows
					.slice(maxPerTenant)
					.map((row) => String(row.id))
					.filter((id) => id.length > 0);

				if (staleIds.length > 0) {
					await this.db
						.delete(fieldIncidentTimeline)
						.where(
							and(
								eq(fieldIncidentTimeline.tenantId, tenantId),
								inArray(fieldIncidentTimeline.id, staleIds),
							),
						);
				}
			},
		);
	}

	async resetForTests() {
		await withDbSpan(
			'field_dashboard.reset_for_tests',
			{ entity: 'field_dashboard' },
			async () => {
				await this.db.delete(fieldDashboardOnboardingStates).where(sql`true`);
				await this.db.delete(fieldDriftAlertAcknowledgements).where(sql`true`);
				await this.db.delete(fieldIncidentTimeline).where(sql`true`);
			},
		);
	}
}

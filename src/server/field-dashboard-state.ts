import { nowIso, randomUuid } from "./test-controls";

export type DashboardOnboardingState = {
	selectedJob: boolean;
	intelligenceRun: boolean;
	dispatchOptimized: boolean;
	automationCycle: boolean;
	dismissed: boolean;
	updatedAt: string;
	updatedBy: string;
};

export type DashboardOnboardingUpdate = {
	selectedJob?: boolean;
	intelligenceRun?: boolean;
	dispatchOptimized?: boolean;
	automationCycle?: boolean;
	dismissed?: boolean;
	actor?: string;
};

export type DriftAlertAcknowledgement = {
	alertId: string;
	owner: string;
	acknowledgedBy: string;
	acknowledgedAt: string;
	slaDueAt: string;
	note: string | null;
};

export type IncidentTimelineSeverity = "info" | "warning" | "critical";

export type IncidentTimelineEvent = {
	id: string;
	type: string;
	severity: IncidentTimelineSeverity;
	message: string;
	timestamp: string;
	actor: string;
	context: Record<string, unknown>;
};

export type IncidentTimelineEventInput = Omit<
	IncidentTimelineEvent,
	"id" | "timestamp"
> & {
	timestamp?: string;
};

export interface FieldDashboardStateStore {
	getOnboarding(input: {
		tenantId: string;
		userId: string;
	}): Promise<DashboardOnboardingState | null>;
	upsertOnboarding(input: {
		tenantId: string;
		userId: string;
		state: DashboardOnboardingState;
	}): Promise<void>;
	getDriftAcknowledgement(input: {
		tenantId: string;
		alertId: string;
	}): Promise<DriftAlertAcknowledgement | null>;
	upsertDriftAcknowledgement(input: {
		tenantId: string;
		acknowledgement: DriftAlertAcknowledgement;
	}): Promise<void>;
	listIncidentTimeline(input: {
		tenantId: string;
		limit: number;
	}): Promise<IncidentTimelineEvent[]>;
	appendIncident(input: {
		tenantId: string;
		event: IncidentTimelineEvent;
		maxPerTenant: number;
	}): Promise<void>;
	resetForTests(): Promise<void>;
}

function tenantUserKey(tenantId: string, userId: string) {
	return `${tenantId}::${userId}`;
}

function createDefaultOnboardingState(
	userId: string,
): DashboardOnboardingState {
	return {
		selectedJob: false,
		intelligenceRun: false,
		dispatchOptimized: false,
		automationCycle: false,
		dismissed: false,
		updatedAt: nowIso(),
		updatedBy: userId,
	};
}

function createInMemoryFieldDashboardStateStore(): FieldDashboardStateStore {
	const onboardingStateByTenantUser = new Map<
		string,
		DashboardOnboardingState
	>();
	const driftAlertAcknowledgementsByTenant = new Map<
		string,
		Map<string, DriftAlertAcknowledgement>
	>();
	const incidentTimelineByTenant = new Map<string, IncidentTimelineEvent[]>();

	return {
		async getOnboarding(input) {
			return (
				onboardingStateByTenantUser.get(
					tenantUserKey(input.tenantId, input.userId),
				) ?? null
			);
		},
		async upsertOnboarding(input) {
			onboardingStateByTenantUser.set(
				tenantUserKey(input.tenantId, input.userId),
				input.state,
			);
		},
		async getDriftAcknowledgement(input) {
			const scoped = driftAlertAcknowledgementsByTenant.get(input.tenantId);
			if (!scoped) {
				return null;
			}

			return scoped.get(input.alertId) ?? null;
		},
		async upsertDriftAcknowledgement(input) {
			const scoped =
				driftAlertAcknowledgementsByTenant.get(input.tenantId) ??
				new Map<string, DriftAlertAcknowledgement>();
			scoped.set(input.acknowledgement.alertId, input.acknowledgement);
			driftAlertAcknowledgementsByTenant.set(input.tenantId, scoped);
		},
		async listIncidentTimeline(input) {
			const scoped = incidentTimelineByTenant.get(input.tenantId) ?? [];
			return scoped.slice(0, Math.max(1, input.limit));
		},
		async appendIncident(input) {
			const scoped = incidentTimelineByTenant.get(input.tenantId) ?? [];
			scoped.unshift(input.event);
			if (scoped.length > input.maxPerTenant) {
				scoped.length = input.maxPerTenant;
			}
			incidentTimelineByTenant.set(input.tenantId, scoped);
		},
		async resetForTests() {
			onboardingStateByTenantUser.clear();
			driftAlertAcknowledgementsByTenant.clear();
			incidentTimelineByTenant.clear();
		},
	};
}

const isTestRuntime =
	process.env.NODE_ENV === "test" || process.env.VITEST === "true";

let fieldDashboardStateStore: FieldDashboardStateStore =
	createInMemoryFieldDashboardStateStore();
let fallbackStore: FieldDashboardStateStore =
	createInMemoryFieldDashboardStateStore();

function logStoreFailure(operation: string, error: unknown) {
	if (!isTestRuntime) {
		console.warn(
			`[field-dashboard-state] ${operation} failed; using fallback store (${String(
				error,
			)})`,
		);
	}
}

async function safeRead<T>(
	operation: string,
	fallbackValue: T,
	read: (store: FieldDashboardStateStore) => Promise<T>,
) {
	try {
		return await read(fieldDashboardStateStore);
	} catch (error) {
		logStoreFailure(operation, error);
		try {
			return await read(fallbackStore);
		} catch (fallbackError) {
			logStoreFailure(`${operation}:fallback`, fallbackError);
			return fallbackValue;
		}
	}
}

async function safeWrite(
	operation: string,
	write: (store: FieldDashboardStateStore) => Promise<void>,
) {
	try {
		await write(fieldDashboardStateStore);
	} catch (error) {
		logStoreFailure(operation, error);
		try {
			await write(fallbackStore);
		} catch (fallbackError) {
			logStoreFailure(`${operation}:fallback`, fallbackError);
		}
	}
}

export function configureFieldDashboardStateStore(
	store: FieldDashboardStateStore,
) {
	fieldDashboardStateStore = store;
	fallbackStore = createInMemoryFieldDashboardStateStore();
}

export function resetInMemoryFieldDashboardStateStore() {
	fieldDashboardStateStore = createInMemoryFieldDashboardStateStore();
	fallbackStore = createInMemoryFieldDashboardStateStore();
}

export function resetFieldDashboardStateForTests() {
	resetInMemoryFieldDashboardStateStore();
}

export async function getDashboardOnboardingState(
	tenantId: string,
	userId: string,
): Promise<DashboardOnboardingState> {
	const existing = await safeRead<DashboardOnboardingState | null>(
		"get_onboarding",
		null,
		(store) => store.getOnboarding({ tenantId, userId }),
	);

	if (existing) {
		return existing;
	}

	const created = createDefaultOnboardingState(userId);
	await safeWrite("upsert_onboarding_on_read", (store) =>
		store.upsertOnboarding({
			tenantId,
			userId,
			state: created,
		}),
	);
	return created;
}

export async function updateDashboardOnboardingState(
	tenantId: string,
	userId: string,
	input: DashboardOnboardingUpdate,
): Promise<DashboardOnboardingState> {
	const current = await getDashboardOnboardingState(tenantId, userId);
	const actor = input.actor ?? userId;
	const updated: DashboardOnboardingState = {
		...current,
		selectedJob: input.selectedJob ?? current.selectedJob,
		intelligenceRun: input.intelligenceRun ?? current.intelligenceRun,
		dispatchOptimized: input.dispatchOptimized ?? current.dispatchOptimized,
		automationCycle: input.automationCycle ?? current.automationCycle,
		dismissed: input.dismissed ?? current.dismissed,
		updatedAt: nowIso(),
		updatedBy: actor,
	};

	await safeWrite("upsert_onboarding", (store) =>
		store.upsertOnboarding({
			tenantId,
			userId,
			state: updated,
		}),
	);
	return updated;
}

export async function getDriftAlertAcknowledgement(
	tenantId: string,
	alertId: string,
): Promise<DriftAlertAcknowledgement | null> {
	return safeRead<DriftAlertAcknowledgement | null>(
		"get_drift_acknowledgement",
		null,
		(store) => store.getDriftAcknowledgement({ tenantId, alertId }),
	);
}

export async function upsertDriftAlertAcknowledgement(
	tenantId: string,
	acknowledgement: DriftAlertAcknowledgement,
) {
	await safeWrite("upsert_drift_acknowledgement", (store) =>
		store.upsertDriftAcknowledgement({ tenantId, acknowledgement }),
	);
}

export async function listIncidentTimelineEvents(
	tenantId: string,
	limit = 50,
): Promise<IncidentTimelineEvent[]> {
	return safeRead<IncidentTimelineEvent[]>(
		"list_incident_timeline",
		[],
		(store) =>
			store.listIncidentTimeline({
				tenantId,
				limit: Math.max(1, limit),
			}),
	);
}

export async function appendIncidentTimelineEvent(
	tenantId: string,
	input: IncidentTimelineEventInput,
	maxPerTenant = 500,
): Promise<IncidentTimelineEvent> {
	const event: IncidentTimelineEvent = {
		id: `incident-${randomUuid()}`,
		type: input.type,
		severity: input.severity,
		message: input.message,
		timestamp: input.timestamp ?? nowIso(),
		actor: input.actor,
		context: input.context,
	};

	await safeWrite("append_incident", (store) =>
		store.appendIncident({
			tenantId,
			event,
			maxPerTenant,
		}),
	);

	return event;
}

export type PersistedTechnician = {
	id: string;
	name: string;
	status: 'available' | 'busy' | 'offline';
	homeBase: string;
	location: { lat: number; lng: number };
	skills: string[];
	shiftStart: string;
	shiftEnd: string;
	activeJobCount: number;
	maxConcurrentJobs: number;
};

export type PersistedServiceJob = {
	id: string;
	title: string;
	version: number;
	locationLabel: string;
	location: { lat: number; lng: number };
	status: 'open' | 'assigned' | 'in_progress' | 'closed';
	technicianId: string | null;
	requiredSkills: string[];
	priority: 'low' | 'normal' | 'high' | 'urgent';
	slaDueAt: string;
	estimatedMinutes: number;
	completionNotes: string | null;
	firstTimeFix: boolean | null;
	customerId: string | null;
};

export type PersistedQueueItem = {
	id: string;
	jobId: string;
	reason: string;
	queuedAt: string;
};

export type PersistedCoreSnapshot = {
	technicians: PersistedTechnician[];
	jobs: PersistedServiceJob[];
	queue: PersistedQueueItem[];
	breaches: PersistedSlaBreach[];
};

export type PersistedRoutePlan = {
	id: string;
	technicianId: string;
	date: string;
	routeSummary: string;
	totalTravelMinutes: number;
	totalDistanceKm: number;
	delayRisk: 'low' | 'medium' | 'high';
	triggeredBy: 'manual' | 'traffic' | 'assignment';
};

export type PersistedChecklistItem = {
	id: string;
	label: string;
	required: boolean;
	done: boolean;
};

export type PersistedProofOfService = {
	jobId: string;
	proofUrl: string;
	note?: string;
	uploadedAt: string;
};

export type PersistedSlaBreach = {
	id: string;
	jobId: string;
	priority: 'low' | 'normal' | 'high' | 'urgent';
	minutesOverdue: number;
	escalated: boolean;
	breachedAt: string;
};

export type PersistedEscalation = {
	id: string;
	jobId: string;
	severity: 'moderate' | 'critical';
	rule: string;
	triggeredAt: string;
};

export type PersistedAudit = {
	id: string;
	eventType:
		| 'job_assigned'
		| 'job_reassigned'
		| 'job_unassigned'
		| 'disruption_handled'
		| 'job_status_transition'
		| 'job_completed'
		| 'manual_override'
		| 'shift_updated'
		| 'route_replanned';
	actor: string;
	details: Record<string, unknown>;
	createdAt: string;
};

export type PersistedMaintenanceRisk = {
	assetId: string;
	riskScore: number;
	riskBand: 'low' | 'medium' | 'high';
	factors: Record<string, number>;
	generatedAt: string;
};

export type PersistedManualOverride = {
	jobId: string;
	actor: string;
	reason: string;
	changes: Record<string, unknown>;
	createdAt: string;
};

export type PersistedWorkOrderIntelligenceRun = {
	id: string;
	jobId: string;
	statusAtPrediction: 'open' | 'assigned' | 'in_progress' | 'closed';
	predictedDurationMinutes: number;
	confidence: number;
	probableDiagnoses: Array<{
		label: string;
		confidence: number;
		rationale: string;
	}>;
	recommendedParts: string[];
	recommendedActions: string[];
	symptoms: string[];
	notes: string | null;
	generatedAt: string;
	actualDurationMinutes: number | null;
	durationErrorMinutes: number | null;
};

export type PersistedTechnicianAssistBriefing = {
	id: string;
	jobId: string;
	statusAtGeneration: 'open' | 'assigned' | 'in_progress' | 'closed';
	recommendedSteps: string[];
	smartFormFields: string[];
	voiceNotePrompts: string[];
	riskFlags: string[];
	generatedAt: string;
};

export interface FieldOpsPersistence {
	loadCoreSnapshot():
		| PersistedCoreSnapshot
		| Promise<PersistedCoreSnapshot | null>
		| null;
	persistCoreSnapshot(snapshot: PersistedCoreSnapshot): void | Promise<void>;
	upsertTechnicians(items: PersistedTechnician[]): void | Promise<void>;
	upsertJobs(items: PersistedServiceJob[]): void | Promise<void>;
	replaceUnassignedQueue(items: PersistedQueueItem[]): void | Promise<void>;
	upsertRoutePlan(item: PersistedRoutePlan): void | Promise<void>;
	replaceChecklist(
		jobId: string,
		items: PersistedChecklistItem[],
	): void | Promise<void>;
	addProofOfService(item: PersistedProofOfService): void | Promise<void>;
	replaceSlaBreaches(items: PersistedSlaBreach[]): void | Promise<void>;
	addEscalation(item: PersistedEscalation): void | Promise<void>;
	addAudit(item: PersistedAudit): void | Promise<void>;
	addMaintenanceRisk(item: PersistedMaintenanceRisk): void | Promise<void>;
	addManualOverride(item: PersistedManualOverride): void | Promise<void>;
	addWorkOrderIntelligenceRun(
		item: PersistedWorkOrderIntelligenceRun,
	): void | Promise<void>;
	updateWorkOrderIntelligenceOutcome(
		id: string,
		outcome: { actualDurationMinutes: number; durationErrorMinutes: number },
	): void | Promise<void>;
	addTechnicianAssistBriefing(
		item: PersistedTechnicianAssistBriefing,
	): void | Promise<void>;
	listWorkOrderIntelligenceRuns(
		limit?: number,
	):
		| PersistedWorkOrderIntelligenceRun[]
		| Promise<PersistedWorkOrderIntelligenceRun[]>;
	listTechnicianAssistBriefings(
		limit?: number,
	):
		| PersistedTechnicianAssistBriefing[]
		| Promise<PersistedTechnicianAssistBriefing[]>;
}

export class NoopFieldOpsPersistence implements FieldOpsPersistence {
	loadCoreSnapshot() {
		return null;
	}
	persistCoreSnapshot() {}
	upsertTechnicians() {}
	upsertJobs() {}
	replaceUnassignedQueue() {}
	upsertRoutePlan() {}
	replaceChecklist() {}
	addProofOfService() {}
	replaceSlaBreaches() {}
	addEscalation() {}
	addAudit() {}
	addMaintenanceRisk() {}
	addManualOverride() {}
	addWorkOrderIntelligenceRun() {}
	updateWorkOrderIntelligenceOutcome() {}
	addTechnicianAssistBriefing() {}
	listWorkOrderIntelligenceRuns() {
		return [];
	}
	listTechnicianAssistBriefings() {
		return [];
	}
}

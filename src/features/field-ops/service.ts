import {
	type Coordinates,
	defaultMapProvider,
	type MapProvider,
} from './map-provider';
import {
	type FieldOpsPersistence,
	NoopFieldOpsPersistence,
	type PersistedAudit,
	type PersistedCoreSnapshot,
	type PersistedEscalation,
	type PersistedMaintenanceRisk,
	type PersistedManualOverride,
	type PersistedProofOfService,
	type PersistedRoutePlan,
	type PersistedSlaBreach,
	type PersistedTechnicianAssistBriefing,
	type PersistedWorkOrderIntelligenceRun,
} from './persistence';
import { currentTenantId } from './tenant-context';

export type TechnicianStatus = 'available' | 'busy' | 'offline';
export type ServiceJobStatus = 'open' | 'assigned' | 'in_progress' | 'closed';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export const JOB_STATUS_TRANSITIONS: Readonly<
	Record<ServiceJobStatus, readonly ServiceJobStatus[]>
> = {
	open: ['assigned'],
	assigned: ['assigned', 'open', 'in_progress'],
	in_progress: ['closed'],
	closed: [],
} as const;

export const JOB_LIFECYCLE_ERROR_CODES = {
	jobNotFound: 'JOB_NOT_FOUND',
	jobAlreadyClosed: 'JOB_ALREADY_CLOSED',
	jobAlreadyInProgress: 'JOB_ALREADY_IN_PROGRESS',
	invalidTransition: 'JOB_INVALID_STATUS_TRANSITION',
	versionConflict: 'JOB_VERSION_CONFLICT',
	checklistIncomplete: 'JOB_CHECKLIST_INCOMPLETE',
	missingAssignedTechnician: 'JOB_MISSING_ASSIGNED_TECHNICIAN',
	noEligibleTechnicians: 'JOB_NO_ELIGIBLE_TECHNICIANS',
	technicianNotAssignable: 'JOB_TECHNICIAN_NOT_ASSIGNABLE',
	jobNotAssigned: 'JOB_NOT_ASSIGNED',
} as const;

export type JobLifecycleErrorCode =
	(typeof JOB_LIFECYCLE_ERROR_CODES)[keyof typeof JOB_LIFECYCLE_ERROR_CODES];

export type ShiftWindow = {
	start: string;
	end: string;
};

export type Technician = {
	id: string;
	name: string;
	status: TechnicianStatus;
	homeBase: string;
	skills: string[];
	shift: ShiftWindow;
	location: Coordinates;
	activeJobCount: number;
	maxConcurrentJobs: number;
};

export type ChecklistItem = {
	id: string;
	label: string;
	required: boolean;
	done: boolean;
};

export type ProofOfService = {
	proofUrl: string;
	note?: string;
	uploadedAt: string;
};

export type ServiceJob = {
	id: string;
	title: string;
	version: number;
	customerId: string | null;
	locationLabel: string;
	location: Coordinates;
	status: ServiceJobStatus;
	technicianId: string | null;
	requiredSkills: string[];
	priority: JobPriority;
	slaDueAt: string;
	estimatedMinutes: number;
	checklist: ChecklistItem[];
	proofOfService: ProofOfService | null;
	completionNotes: string | null;
	firstTimeFix: boolean | null;
};

export type RouteStop = {
	jobId: string;
	locationLabel: string;
	etaMinutes: number;
	distanceKm: number;
};

export type RoutePlan = {
	id: string;
	technicianId: string;
	date: string;
	triggeredBy: 'manual' | 'traffic' | 'assignment';
	stops: RouteStop[];
	totalTravelMinutes: number;
	totalDistanceKm: number;
	delayRisk: 'low' | 'medium' | 'high';
	updatedAt: string;
};

export type AssignmentScoreBreakdown = {
	distance: number;
	skill: number;
	load: number;
	total: number;
};

export type AssignmentCandidate = {
	technicianId: string;
	technicianName: string;
	score: AssignmentScoreBreakdown;
};

export type AssignmentResult = {
	assigned: boolean;
	code?: JobLifecycleErrorCode;
	jobId: string;
	technicianId: string | null;
	assignmentId: string;
	reason?: string;
	candidates: AssignmentCandidate[];
};

type VersionConflictResult = {
	conflict: true;
	code: typeof JOB_LIFECYCLE_ERROR_CODES.versionConflict;
	reason: string;
	currentVersion: number;
};

type LifecycleFailure = {
	code: JobLifecycleErrorCode;
	reason: string;
	currentVersion?: number;
};

export type CompleteJobResult =
	| {
			completed: true;
			job: ServiceJob;
	  }
	| ({
			completed: false;
	  } & LifecycleFailure);

export type StartJobResult =
	| {
			started: true;
			job: ServiceJob;
	  }
	| ({
			started: false;
	  } & LifecycleFailure);

export type UnassignJobResult =
	| {
			unassigned: true;
			jobId: string;
	  }
	| ({
			unassigned: false;
	  } & LifecycleFailure);

export type UnassignedQueueItem = {
	id: string;
	jobId: string;
	reason: string;
	queuedAt: string;
};

export type SlaBreach = {
	id: string;
	jobId: string;
	priority: JobPriority;
	minutesOverdue: number;
	breachedAt: string;
	escalated: boolean;
};

export type EscalationEvent = {
	id: string;
	jobId: string;
	severity: 'moderate' | 'critical';
	triggeredAt: string;
	rule: string;
};

export type AuditEvent = {
	id: string;
	type:
		| 'job_assigned'
		| 'job_reassigned'
		| 'job_unassigned'
		| 'disruption_handled'
		| 'job_status_transition'
		| 'job_completed'
		| 'manual_override'
		| 'shift_updated'
		| 'route_replanned';
	timestamp: string;
	actor: string;
	details: Record<string, unknown>;
};

export type DispatchBoard = {
	modules: readonly string[];
	activeJobs: number;
	availableTechnicians: number;
	technicians: Technician[];
	jobs: ServiceJob[];
	unassignedQueue: UnassignedQueueItem[];
	slaBreaches: SlaBreach[];
};

export type OperationalKpis = {
	utilizationRate: number;
	firstTimeFixRate: number;
	averageTravelMinutes: number;
	openJobs: number;
	overdueJobs: number;
};

export type MaintenanceRiskInput = {
	assetId: string;
	assetAgeMonths: number;
	incidentsLast90Days: number;
	avgRepairMinutes: number;
	usageIntensity: 'low' | 'medium' | 'high';
};

export type MaintenanceRiskResult = {
	assetId: string;
	riskScore: number;
	riskBand: 'low' | 'medium' | 'high';
	factors: Record<string, number>;
	generatedAt: string;
};

export type WorkOrderDiagnosis = {
	label: string;
	confidence: number;
	rationale: string;
};

export type WorkOrderIntelligence = {
	runId?: string;
	jobId: string;
	status: ServiceJobStatus;
	predictedDurationMinutes: number;
	confidence: number;
	probableDiagnoses: WorkOrderDiagnosis[];
	recommendedParts: string[];
	recommendedActions: string[];
	generatedAt: string;
};

export type TechnicianAssistBriefing = {
	jobId: string;
	status: ServiceJobStatus;
	recommendedSteps: string[];
	smartFormFields: string[];
	voiceNotePrompts: string[];
	riskFlags: string[];
	generatedAt: string;
};

export type WorkOrderIntelligenceRun = WorkOrderIntelligence & {
	id: string;
	symptoms: string[];
	notes: string | null;
	actualDurationMinutes: number | null;
	durationErrorMinutes: number | null;
};

export type TechnicianAssistBriefingRun = TechnicianAssistBriefing & {
	id: string;
};

export type WorkOrderIntelligenceAccuracy = {
	sampleCount: number;
	meanAbsoluteErrorMinutes: number;
	medianAbsoluteErrorMinutes: number;
	within15MinutesRate: number;
};

export type DispatchDisruptionType =
	| 'technician_unavailable'
	| 'traffic_incident'
	| 'weather_alert';

export type DispatchDisruptionResult = {
	processedAt: string;
	type: DispatchDisruptionType;
	impactedJobIds: string[];
	reassignedJobIds: string[];
	queuedJobIds: string[];
	blockedJobIds: string[];
	notes: string[];
};

export type DispatchOptimizationItem = {
	jobId: string;
	fromTechnicianId: string | null;
	toTechnicianId: string;
	score: number;
};

export type DispatchOptimizationResult = {
	optimizedAt: string;
	totalCandidateJobs: number;
	reassignedCount: number;
	queuedCount: number;
	assignments: DispatchOptimizationItem[];
	unassignedJobIds: string[];
};

export type IntelligenceQualitySegment = {
	segment: string;
	sampleCount: number;
	meanAbsoluteErrorMinutes: number;
	within15MinutesRate: number;
};

export type IntelligenceQualityReport = {
	generatedAt: string;
	windowHours: number;
	overall: WorkOrderIntelligenceAccuracy;
	byPriority: IntelligenceQualitySegment[];
	bySkill: IntelligenceQualitySegment[];
};

export type IntelligenceDriftAlert = {
	id: string;
	severity: 'low' | 'medium' | 'high';
	scope: 'overall' | 'priority' | 'skill';
	segment: string;
	sampleCount: number;
	message: string;
	triggeredAt: string;
	metrics: {
		meanAbsoluteErrorMinutes: number;
		within15MinutesRate: number;
	};
};

type FieldOpsState = {
	technicians: Technician[];
	jobs: ServiceJob[];
	unassignedQueue: UnassignedQueueItem[];
	routePlans: RoutePlan[];
	slaBreaches: SlaBreach[];
	escalations: EscalationEvent[];
	auditTrail: AuditEvent[];
	workOrderIntelligenceRuns: WorkOrderIntelligenceRun[];
	technicianAssistBriefings: TechnicianAssistBriefingRun[];
	mapProvider: MapProvider;
	persistence: FieldOpsPersistence;
};

const fieldOpsModules = [
	'dispatch',
	'technician-assist',
	'route-optimization',
	'maintenance-insights',
	'ops-analytics',
] as const;

const defaultChecklist = [
	{
		id: 'site-safety',
		label: 'Perform site safety check',
		required: true,
		done: false,
	},
	{
		id: 'verify-asset',
		label: 'Verify asset serial number',
		required: true,
		done: false,
	},
	{
		id: 'capture-photos',
		label: 'Capture before/after photos',
		required: false,
		done: false,
	},
] satisfies ChecklistItem[];

function cloneChecklist() {
	return defaultChecklist.map((item) => ({ ...item }));
}

function initialState(
	mapProvider: MapProvider = defaultMapProvider,
	persistence: FieldOpsPersistence = new NoopFieldOpsPersistence(),
): FieldOpsState {
	return {
		technicians: [
			{
				id: 'tech-a1',
				name: 'Jordan Lee',
				status: 'available',
				homeBase: 'North Hub',
				skills: ['hvac', 'electrical'],
				shift: { start: '08:00', end: '17:00' },
				location: { lat: 37.787, lng: -122.403 },
				activeJobCount: 0,
				maxConcurrentJobs: 3,
			},
			{
				id: 'tech-b2',
				name: 'Casey Patel',
				status: 'busy',
				homeBase: 'South Hub',
				skills: ['plumbing', 'hvac'],
				shift: { start: '07:00', end: '15:00' },
				location: { lat: 37.765, lng: -122.424 },
				activeJobCount: 1,
				maxConcurrentJobs: 2,
			},
			{
				id: 'tech-c3',
				name: 'Riley Gomez',
				status: 'busy',
				homeBase: 'East Hub',
				skills: ['electrical', 'network'],
				shift: { start: '09:00', end: '18:00' },
				location: { lat: 37.778, lng: -122.391 },
				activeJobCount: 1,
				maxConcurrentJobs: 2,
			},
			{
				id: 'tech-d4',
				name: 'Morgan Diaz',
				status: 'offline',
				homeBase: 'West Hub',
				skills: ['plumbing'],
				shift: { start: '10:00', end: '19:00' },
				location: { lat: 37.781, lng: -122.447 },
				activeJobCount: 0,
				maxConcurrentJobs: 2,
			},
		],
		jobs: [
			{
				id: 'job-100',
				title: 'HVAC compressor fault',
				version: 1,
				customerId: 'cust-101',
				locationLabel: '101 Market St',
				location: { lat: 37.793, lng: -122.396 },
				status: 'open',
				technicianId: null,
				requiredSkills: ['hvac'],
				priority: 'high',
				slaDueAt: new Date(Date.now() + 1000 * 60 * 90).toISOString(),
				estimatedMinutes: 80,
				checklist: cloneChecklist(),
				proofOfService: null,
				completionNotes: null,
				firstTimeFix: null,
			},
			{
				id: 'job-101',
				title: 'Breaker panel inspection',
				version: 1,
				customerId: 'cust-205',
				locationLabel: '55 Howard St',
				location: { lat: 37.789, lng: -122.394 },
				status: 'assigned',
				technicianId: 'tech-c3',
				requiredSkills: ['electrical'],
				priority: 'normal',
				slaDueAt: new Date(Date.now() + 1000 * 60 * 180).toISOString(),
				estimatedMinutes: 60,
				checklist: cloneChecklist(),
				proofOfService: null,
				completionNotes: null,
				firstTimeFix: null,
			},
			{
				id: 'job-102',
				title: 'Pipe pressure imbalance',
				version: 1,
				customerId: 'cust-307',
				locationLabel: '23 Mission St',
				location: { lat: 37.791, lng: -122.4 },
				status: 'open',
				technicianId: null,
				requiredSkills: ['plumbing'],
				priority: 'urgent',
				slaDueAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
				estimatedMinutes: 70,
				checklist: cloneChecklist(),
				proofOfService: null,
				completionNotes: null,
				firstTimeFix: null,
			},
		],
		unassignedQueue: [],
		routePlans: [],
		slaBreaches: [],
		escalations: [],
		auditTrail: [],
		workOrderIntelligenceRuns: [],
		technicianAssistBriefings: [],
		mapProvider,
		persistence,
	};
}

let configuredMapProvider: MapProvider = defaultMapProvider;
let configuredPersistence: FieldOpsPersistence = new NoopFieldOpsPersistence();
const tenantStates = new Map<string, FieldOpsState>();

function normalizeTenantId(tenantId: string | null | undefined) {
	return tenantId?.trim() || 'default';
}

function stateRef(tenantId = currentTenantId()): FieldOpsState {
	const normalizedTenantId = normalizeTenantId(tenantId);
	const existing = tenantStates.get(normalizedTenantId);

	if (existing) {
		return existing;
	}

	const created = initialState(configuredMapProvider, configuredPersistence);
	tenantStates.set(normalizedTenantId, created);
	return created;
}

function nowIso() {
	return new Date().toISOString();
}

function randomId(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

function fireAndForget(task: () => void | Promise<void>) {
	try {
		const result = task();

		if (result && typeof (result as Promise<void>).then === 'function') {
			void (result as Promise<void>).catch(() => {});
		}
	} catch {
		// Persistence must never block runtime state transitions.
	}
}

function toPersistedSlaBreaches(): PersistedSlaBreach[] {
	return stateRef().slaBreaches.map((breach) => ({
		id: breach.id,
		jobId: breach.jobId,
		priority: breach.priority,
		minutesOverdue: breach.minutesOverdue,
		breachedAt: breach.breachedAt,
		escalated: breach.escalated,
	}));
}

function syncCoreEntities() {
	const snapshot: PersistedCoreSnapshot = {
		technicians: stateRef().technicians.map((technician) => ({
			id: technician.id,
			name: technician.name,
			status: technician.status,
			homeBase: technician.homeBase,
			location: technician.location,
			skills: technician.skills,
			shiftStart: technician.shift.start,
			shiftEnd: technician.shift.end,
			activeJobCount: technician.activeJobCount,
			maxConcurrentJobs: technician.maxConcurrentJobs,
		})),
		jobs: stateRef().jobs.map((job) => ({
			id: job.id,
			title: job.title,
			version: job.version,
			locationLabel: job.locationLabel,
			location: job.location,
			status: job.status,
			technicianId: job.technicianId,
			requiredSkills: job.requiredSkills,
			priority: job.priority,
			slaDueAt: job.slaDueAt,
			estimatedMinutes: job.estimatedMinutes,
			completionNotes: job.completionNotes,
			firstTimeFix: job.firstTimeFix,
			customerId: job.customerId,
		})),
		queue: stateRef().unassignedQueue.map((item) => ({
			id: item.id,
			jobId: item.jobId,
			reason: item.reason,
			queuedAt: item.queuedAt,
		})),
		breaches: toPersistedSlaBreaches(),
	};

	fireAndForget(() => stateRef().persistence.persistCoreSnapshot(snapshot));

	fireAndForget(() =>
		stateRef().persistence.upsertTechnicians(
			stateRef().technicians.map((technician) => ({
				id: technician.id,
				name: technician.name,
				status: technician.status,
				homeBase: technician.homeBase,
				location: technician.location,
				skills: technician.skills,
				shiftStart: technician.shift.start,
				shiftEnd: technician.shift.end,
				activeJobCount: technician.activeJobCount,
				maxConcurrentJobs: technician.maxConcurrentJobs,
			})),
		),
	);

	fireAndForget(() =>
		stateRef().persistence.upsertJobs(
			stateRef().jobs.map((job) => ({
				id: job.id,
				title: job.title,
				version: job.version,
				locationLabel: job.locationLabel,
				location: job.location,
				status: job.status,
				technicianId: job.technicianId,
				requiredSkills: job.requiredSkills,
				priority: job.priority,
				slaDueAt: job.slaDueAt,
				estimatedMinutes: job.estimatedMinutes,
				completionNotes: job.completionNotes,
				firstTimeFix: job.firstTimeFix,
				customerId: job.customerId,
			})),
		),
	);

	fireAndForget(() =>
		stateRef().persistence.replaceUnassignedQueue(
			stateRef().unassignedQueue.map((item) => ({
				id: item.id,
				jobId: item.jobId,
				reason: item.reason,
				queuedAt: item.queuedAt,
			})),
		),
	);

	fireAndForget(() =>
		stateRef().persistence.replaceSlaBreaches(toPersistedSlaBreaches()),
	);
}

function clamp(value: number, min = 0, max = 1) {
	return Math.min(max, Math.max(min, value));
}

function toMinuteOfDay(time: string) {
	const [hours, minutes] = time
		.split(':')
		.map((value) => Number.parseInt(value, 10));
	return hours * 60 + minutes;
}

function isWithinShift(shift: ShiftWindow, at: Date) {
	const currentMinute = at.getHours() * 60 + at.getMinutes();
	const shiftStart = toMinuteOfDay(shift.start);
	const shiftEnd = toMinuteOfDay(shift.end);

	if (shiftStart <= shiftEnd) {
		return currentMinute >= shiftStart && currentMinute <= shiftEnd;
	}

	return currentMinute >= shiftStart || currentMinute <= shiftEnd;
}

function findJob(jobId: string) {
	return stateRef().jobs.find((job) => job.id === jobId);
}

function findTechnician(technicianId: string) {
	return stateRef().technicians.find(
		(technician) => technician.id === technicianId,
	);
}

function pushAudit(
	type: AuditEvent['type'],
	actor: string,
	details: Record<string, unknown>,
) {
	const entry = {
		id: randomId('audit'),
		type,
		actor,
		details,
		timestamp: nowIso(),
	};

	stateRef().auditTrail.unshift(entry);

	const payload: PersistedAudit = {
		id: entry.id,
		eventType: entry.type,
		actor: entry.actor,
		details: entry.details,
		createdAt: entry.timestamp,
	};

	fireAndForget(() => stateRef().persistence.addAudit(payload));
}

function updateQueue(jobId: string, reason: string) {
	const existing = stateRef().unassignedQueue.find(
		(item) => item.jobId === jobId,
	);

	if (existing) {
		existing.reason = reason;
		return existing;
	}

	const queued = {
		id: randomId('queue'),
		jobId,
		reason,
		queuedAt: nowIso(),
	};

	stateRef().unassignedQueue.unshift(queued);
	return queued;
}

function dequeue(jobId: string) {
	stateRef().unassignedQueue = stateRef().unassignedQueue.filter(
		(entry) => entry.jobId !== jobId,
	);
}

function adjustTechnicianLoad(technicianId: string | null, delta: number) {
	if (!technicianId) {
		return;
	}

	const technician = findTechnician(technicianId);

	if (!technician) {
		return;
	}

	technician.activeJobCount = Math.max(0, technician.activeJobCount + delta);

	if (technician.status !== 'offline') {
		technician.status = technician.activeJobCount > 0 ? 'busy' : 'available';
	}
}

function scoreTechnician(
	job: ServiceJob,
	technician: Technician,
	at: Date,
): AssignmentScoreBreakdown | null {
	if (technician.status === 'offline') {
		return null;
	}

	if (!isWithinShift(technician.shift, at)) {
		return null;
	}

	if (technician.activeJobCount >= technician.maxConcurrentJobs) {
		return null;
	}

	const eta = stateRef().mapProvider.estimateEta({
		from: technician.location,
		to: job.location,
		departureAt: at,
	});

	const distanceScore = clamp(1 - eta.distanceKm / 35);
	const matchingSkills = job.requiredSkills.filter((skill) =>
		technician.skills.includes(skill),
	).length;
	const skillScore =
		job.requiredSkills.length === 0
			? 1
			: clamp(matchingSkills / job.requiredSkills.length);
	const loadScore = clamp(
		1 - technician.activeJobCount / technician.maxConcurrentJobs,
	);

	const total = clamp(
		distanceScore * 0.45 + skillScore * 0.35 + loadScore * 0.2,
	);

	return {
		distance: Number(distanceScore.toFixed(3)),
		skill: Number(skillScore.toFixed(3)),
		load: Number(loadScore.toFixed(3)),
		total: Number(total.toFixed(3)),
	};
}

function scoreTechnicianWithLoad(
	job: ServiceJob,
	technician: Technician,
	simulatedLoad: number,
	at: Date,
): AssignmentScoreBreakdown | null {
	if (technician.status === 'offline') {
		return null;
	}

	if (!isWithinShift(technician.shift, at)) {
		return null;
	}

	if (simulatedLoad >= technician.maxConcurrentJobs) {
		return null;
	}

	const eta = stateRef().mapProvider.estimateEta({
		from: technician.location,
		to: job.location,
		departureAt: at,
	});

	const distanceScore = clamp(1 - eta.distanceKm / 35);
	const matchingSkills = job.requiredSkills.filter((skill) =>
		technician.skills.includes(skill),
	).length;
	const skillScore =
		job.requiredSkills.length === 0
			? 1
			: clamp(matchingSkills / job.requiredSkills.length);
	const loadScore = clamp(1 - simulatedLoad / technician.maxConcurrentJobs);

	const total = clamp(
		distanceScore * 0.45 + skillScore * 0.35 + loadScore * 0.2,
	);

	return {
		distance: Number(distanceScore.toFixed(3)),
		skill: Number(skillScore.toFixed(3)),
		load: Number(loadScore.toFixed(3)),
		total: Number(total.toFixed(3)),
	};
}

function slaUrgencyScore(job: ServiceJob, at: Date) {
	const dueAt = new Date(job.slaDueAt).getTime();
	const deltaMinutes = (dueAt - at.getTime()) / (1000 * 60);

	if (deltaMinutes <= 0) {
		return 1;
	}

	return clamp(1 - deltaMinutes / 240, 0, 1);
}

function routePriorityWeight(priority: JobPriority) {
	if (priority === 'urgent') {
		return 4;
	}

	if (priority === 'high') {
		return 3;
	}

	if (priority === 'normal') {
		return 2;
	}

	return 1;
}

function currentDelayRisk(totalTravelMinutes: number, stopCount: number) {
	const normalized = totalTravelMinutes + stopCount * 8;

	if (normalized >= 140) {
		return 'high' as const;
	}

	if (normalized >= 80) {
		return 'medium' as const;
	}

	return 'low' as const;
}

type SkillIntelligenceProfile = {
	diagnoses: string[];
	parts: string[];
	actions: string[];
};

type SymptomSignal = {
	keywords: string[];
	diagnosis: string;
	part?: string;
	action?: string;
	durationDeltaMinutes: number;
};

const skillIntelligenceProfiles: Record<string, SkillIntelligenceProfile> = {
	hvac: {
		diagnoses: ['Compressor efficiency drop', 'Refrigerant pressure imbalance'],
		parts: ['compressor capacitor', 'contactor relay', 'refrigerant seal kit'],
		actions: [
			'Run static and running pressure checks',
			'Inspect condenser airflow and coil cleanliness',
		],
	},
	electrical: {
		diagnoses: ['Breaker thermal fatigue', 'Upstream wiring resistance fault'],
		parts: ['breaker module', 'wire harness set', 'grounding strap'],
		actions: [
			'Measure load across all phases',
			'Inspect panel terminations for heat damage',
		],
	},
	plumbing: {
		diagnoses: [
			'Regulator drift causing pressure imbalance',
			'Localized line restriction',
		],
		parts: [
			'pressure regulator',
			'control valve cartridge',
			'pipe coupling set',
		],
		actions: [
			'Perform upstream/downstream pressure differential test',
			'Inspect valve and strainer blockages',
		],
	},
	network: {
		diagnoses: ['Intermittent port failure', 'Power injector instability'],
		parts: ['managed switch module', 'PoE injector', 'Cat6 patch harness'],
		actions: [
			'Validate link quality and packet loss',
			'Check power rail stability under load',
		],
	},
};

const symptomSignals: SymptomSignal[] = [
	{
		keywords: ['fault', 'failure', 'trip'],
		diagnosis: 'Intermittent component failure',
		action: 'Capture fault code and compare against recent incidents',
		durationDeltaMinutes: 10,
	},
	{
		keywords: ['pressure', 'imbalance', 'flow'],
		diagnosis: 'Pressure regulation anomaly',
		part: 'pressure sensor assembly',
		action: 'Validate sensor readings against calibrated gauge',
		durationDeltaMinutes: 18,
	},
	{
		keywords: ['leak', 'drip'],
		diagnosis: 'Seal or joint integrity loss',
		part: 'seal replacement kit',
		action: 'Perform leak isolation and targeted seal replacement',
		durationDeltaMinutes: 20,
	},
	{
		keywords: ['overheat', 'hot', 'burn'],
		diagnosis: 'Thermal overload progression',
		part: 'cooling fan module',
		action: 'Inspect airflow path and thermal cutout behavior',
		durationDeltaMinutes: 25,
	},
	{
		keywords: ['noise', 'vibration', 'rattle'],
		diagnosis: 'Mechanical wear or mounting instability',
		part: 'mounting bracket set',
		action: 'Check rotating assemblies and fastener torque',
		durationDeltaMinutes: 12,
	},
];

const smartFormFieldBySkill: Record<string, string[]> = {
	hvac: ['supplyAirTempC', 'returnAirTempC', 'compressorAmpDraw'],
	electrical: ['lineVoltage', 'breakerAmps', 'groundContinuity'],
	plumbing: ['inletPressurePsi', 'outletPressurePsi', 'flowRateLpm'],
	network: ['packetLossPercent', 'linkLatencyMs', 'portPowerDrawW'],
};

function canTransitionStatus(from: ServiceJobStatus, to: ServiceJobStatus) {
	return JOB_STATUS_TRANSITIONS[from].includes(to);
}

function transitionFailure(
	from: ServiceJobStatus,
	to: ServiceJobStatus,
): LifecycleFailure {
	return {
		code: JOB_LIFECYCLE_ERROR_CODES.invalidTransition,
		reason: `Invalid status transition from ${from} to ${to}`,
	};
}

function recordWorkOrderIntelligenceRun(
	job: ServiceJob,
	input: { symptoms?: string[]; notes?: string },
	output: Omit<WorkOrderIntelligence, 'jobId' | 'status' | 'generatedAt'> & {
		generatedAt?: string;
	},
): WorkOrderIntelligence {
	const generatedAt = output.generatedAt ?? nowIso();
	const run: WorkOrderIntelligenceRun = {
		id: randomId('woi'),
		jobId: job.id,
		status: job.status,
		predictedDurationMinutes: output.predictedDurationMinutes,
		confidence: output.confidence,
		probableDiagnoses: output.probableDiagnoses,
		recommendedParts: output.recommendedParts,
		recommendedActions: output.recommendedActions,
		symptoms: input.symptoms ?? [],
		notes: input.notes ?? null,
		generatedAt,
		actualDurationMinutes: null,
		durationErrorMinutes: null,
	};

	stateRef().workOrderIntelligenceRuns.unshift(run);
	if (stateRef().workOrderIntelligenceRuns.length > 1000) {
		stateRef().workOrderIntelligenceRuns.length = 1000;
	}

	const persisted: PersistedWorkOrderIntelligenceRun = {
		id: run.id,
		jobId: run.jobId,
		statusAtPrediction: run.status,
		predictedDurationMinutes: run.predictedDurationMinutes,
		confidence: run.confidence,
		probableDiagnoses: run.probableDiagnoses,
		recommendedParts: run.recommendedParts,
		recommendedActions: run.recommendedActions,
		symptoms: run.symptoms,
		notes: run.notes,
		generatedAt: run.generatedAt,
		actualDurationMinutes: run.actualDurationMinutes,
		durationErrorMinutes: run.durationErrorMinutes,
	};
	fireAndForget(() =>
		stateRef().persistence.addWorkOrderIntelligenceRun(persisted),
	);

	return {
		runId: run.id,
		jobId: run.jobId,
		status: run.status,
		predictedDurationMinutes: run.predictedDurationMinutes,
		confidence: run.confidence,
		probableDiagnoses: run.probableDiagnoses,
		recommendedParts: run.recommendedParts,
		recommendedActions: run.recommendedActions,
		generatedAt: run.generatedAt,
	};
}

function recordTechnicianAssistBriefingRun(
	job: ServiceJob,
	output: Omit<TechnicianAssistBriefing, 'jobId' | 'status' | 'generatedAt'> & {
		generatedAt?: string;
	},
): TechnicianAssistBriefing {
	const generatedAt = output.generatedAt ?? nowIso();
	const run: TechnicianAssistBriefingRun = {
		id: randomId('assist'),
		jobId: job.id,
		status: job.status,
		recommendedSteps: output.recommendedSteps,
		smartFormFields: output.smartFormFields,
		voiceNotePrompts: output.voiceNotePrompts,
		riskFlags: output.riskFlags,
		generatedAt,
	};

	stateRef().technicianAssistBriefings.unshift(run);
	if (stateRef().technicianAssistBriefings.length > 1000) {
		stateRef().technicianAssistBriefings.length = 1000;
	}

	const persisted: PersistedTechnicianAssistBriefing = {
		id: run.id,
		jobId: run.jobId,
		statusAtGeneration: run.status,
		recommendedSteps: run.recommendedSteps,
		smartFormFields: run.smartFormFields,
		voiceNotePrompts: run.voiceNotePrompts,
		riskFlags: run.riskFlags,
		generatedAt: run.generatedAt,
	};
	fireAndForget(() =>
		stateRef().persistence.addTechnicianAssistBriefing(persisted),
	);

	return {
		jobId: run.jobId,
		status: run.status,
		recommendedSteps: run.recommendedSteps,
		smartFormFields: run.smartFormFields,
		voiceNotePrompts: run.voiceNotePrompts,
		riskFlags: run.riskFlags,
		generatedAt: run.generatedAt,
	};
}

export function listAssignmentCandidates(
	jobId: string,
	at = new Date(),
): AssignmentCandidate[] {
	const job = findJob(jobId);

	if (!job) {
		return [];
	}

	return stateRef()
		.technicians.map((technician) => {
			const score = scoreTechnician(job, technician, at);

			if (!score) {
				return null;
			}

			return {
				technicianId: technician.id,
				technicianName: technician.name,
				score,
			};
		})
		.filter((item): item is AssignmentCandidate => item !== null)
		.sort((a, b) => b.score.total - a.score.total);
}

export function assignJob(input: {
	jobId: string;
	technicianId?: string;
	actor?: string;
	reason?: string;
	expectedVersion?: number;
}): AssignmentResult | VersionConflictResult {
	const actor = input.actor ?? 'system';
	const at = new Date();
	const job = findJob(input.jobId);

	if (!job) {
		return {
			assigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobNotFound,
			jobId: input.jobId,
			technicianId: null,
			assignmentId: randomId('assignment'),
			reason: 'Job not found',
			candidates: [],
		};
	}

	if (job.status === 'closed') {
		return {
			assigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobAlreadyClosed,
			jobId: input.jobId,
			technicianId: null,
			assignmentId: randomId('assignment'),
			reason: 'Job already closed',
			candidates: [],
		};
	}

	if (job.status === 'in_progress') {
		return {
			assigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.invalidTransition,
			jobId: input.jobId,
			technicianId: job.technicianId,
			assignmentId: randomId('assignment'),
			reason: `Invalid status transition from ${job.status} to assigned`,
			candidates: [],
		};
	}

	if (
		typeof input.expectedVersion === 'number' &&
		input.expectedVersion !== job.version
	) {
		return {
			conflict: true,
			code: JOB_LIFECYCLE_ERROR_CODES.versionConflict,
			reason: 'Version conflict while assigning job',
			currentVersion: job.version,
		};
	}

	const candidates = listAssignmentCandidates(job.id, at);

	let chosenTechnicianId = input.technicianId;

	if (!chosenTechnicianId) {
		chosenTechnicianId = candidates[0]?.technicianId;
	}

	if (!chosenTechnicianId) {
		updateQueue(job.id, 'No eligible technicians available');
		syncCoreEntities();

		return {
			assigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.noEligibleTechnicians,
			jobId: job.id,
			technicianId: null,
			assignmentId: randomId('assignment'),
			reason: 'No eligible technicians available',
			candidates,
		};
	}

	const chosen = findTechnician(chosenTechnicianId);
	const score = chosen ? scoreTechnician(job, chosen, at) : null;

	if (!chosen || !score || score.total < 0.25) {
		updateQueue(job.id, 'Selected technician is not currently assignable');
		syncCoreEntities();

		return {
			assigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.technicianNotAssignable,
			jobId: job.id,
			technicianId: null,
			assignmentId: randomId('assignment'),
			reason: 'Selected technician is not currently assignable',
			candidates,
		};
	}

	const previousTechnicianId = job.technicianId;

	if (previousTechnicianId && previousTechnicianId !== chosen.id) {
		adjustTechnicianLoad(previousTechnicianId, -1);
	}

	if (!previousTechnicianId || previousTechnicianId !== chosen.id) {
		adjustTechnicianLoad(chosen.id, 1);
	}

	job.technicianId = chosen.id;
	job.status = 'assigned';
	job.version += 1;

	dequeue(job.id);

	pushAudit(
		previousTechnicianId && previousTechnicianId !== chosen.id
			? 'job_reassigned'
			: 'job_assigned',
		actor,
		{
			jobId: job.id,
			technicianId: chosen.id,
			reason: input.reason ?? null,
		},
	);

	const assignmentId = randomId('assignment');

	generateRoutePlan({
		technicianId: chosen.id,
		date: at.toISOString().slice(0, 10),
		triggeredBy: 'assignment',
	});
	syncCoreEntities();

	return {
		assigned: true,
		jobId: job.id,
		technicianId: chosen.id,
		assignmentId,
		candidates,
	};
}

export function reassignJob(input: {
	jobId: string;
	toTechnicianId: string;
	actor?: string;
	reason?: string;
	expectedVersion?: number;
}) {
	return assignJob({
		jobId: input.jobId,
		technicianId: input.toTechnicianId,
		actor: input.actor,
		reason: input.reason ?? 'reassignment',
		expectedVersion: input.expectedVersion,
	});
}

export function optimizeDispatchAssignments(input?: {
	actor?: string;
	includeAssigned?: boolean;
	reason?: string;
}): DispatchOptimizationResult {
	const actor = input?.actor ?? 'dispatcher';
	const includeAssigned = input?.includeAssigned ?? false;
	const at = new Date();
	const candidates = stateRef()
		.jobs.filter((job) => {
			if (job.status === 'closed' || job.status === 'in_progress') {
				return false;
			}

			if (includeAssigned) {
				return true;
			}

			return job.status === 'open' || !job.technicianId;
		})
		.map((job) => ({ ...job }));

	const simulatedLoad = new Map(
		stateRef().technicians.map((technician) => [
			technician.id,
			technician.activeJobCount,
		]),
	);
	const pendingJobs = new Set(candidates.map((job) => job.id));
	const plan: DispatchOptimizationItem[] = [];
	const unassignedJobIds: string[] = [];

	while (pendingJobs.size > 0) {
		let best: {
			jobId: string;
			technicianId: string;
			fromTechnicianId: string | null;
			weightedScore: number;
			rawScore: number;
		} | null = null;

		for (const jobId of pendingJobs) {
			const job = candidates.find((item) => item.id === jobId);

			if (!job) {
				continue;
			}

			const urgency =
				slaUrgencyScore(job, at) * 0.55 +
				(routePriorityWeight(job.priority) / 4) * 0.45;

			for (const technician of stateRef().technicians) {
				const load =
					simulatedLoad.get(technician.id) ?? technician.activeJobCount;
				const score = scoreTechnicianWithLoad(job, technician, load, at);

				if (!score) {
					continue;
				}

				const weightedScore = score.total * 0.65 + urgency * 0.35;

				if (!best || weightedScore > best.weightedScore) {
					best = {
						jobId: job.id,
						technicianId: technician.id,
						fromTechnicianId: job.technicianId,
						weightedScore,
						rawScore: score.total,
					};
				}
			}
		}

		if (!best) {
			for (const jobId of pendingJobs) {
				unassignedJobIds.push(jobId);
			}
			break;
		}

		plan.push({
			jobId: best.jobId,
			fromTechnicianId: best.fromTechnicianId,
			toTechnicianId: best.technicianId,
			score: Number(best.weightedScore.toFixed(3)),
		});

		simulatedLoad.set(
			best.technicianId,
			(simulatedLoad.get(best.technicianId) ?? 0) + 1,
		);
		pendingJobs.delete(best.jobId);
	}

	let reassignedCount = 0;
	let queuedCount = 0;

	for (const item of plan) {
		const result = assignJob({
			jobId: item.jobId,
			technicianId: item.toTechnicianId,
			actor,
			reason: input?.reason ?? 'dispatch optimization',
		});

		if ('assigned' in result && result.assigned) {
			if (
				item.fromTechnicianId &&
				item.fromTechnicianId !== item.toTechnicianId
			) {
				reassignedCount += 1;
			}
			continue;
		}

		queuedCount += 1;
		if (!unassignedJobIds.includes(item.jobId)) {
			unassignedJobIds.push(item.jobId);
		}
	}

	pushAudit('manual_override', actor, {
		category: 'dispatch_optimization',
		includeAssigned,
		plannedAssignments: plan.length,
		reassignedCount,
		queuedCount,
	});

	return {
		optimizedAt: nowIso(),
		totalCandidateJobs: candidates.length,
		reassignedCount,
		queuedCount,
		assignments: plan,
		unassignedJobIds,
	};
}

export function handleDispatchDisruption(input: {
	type: DispatchDisruptionType;
	technicianId?: string;
	affectedJobIds?: string[];
	reason: string;
	actor?: string;
}): DispatchDisruptionResult {
	const actor = input.actor ?? 'dispatcher';
	const impacted = new Set<string>(input.affectedJobIds ?? []);
	const reassignedJobIds: string[] = [];
	const queuedJobIds: string[] = [];
	const blockedJobIds: string[] = [];
	const notes: string[] = [];

	if (input.type === 'technician_unavailable' && input.technicianId) {
		const technician = findTechnician(input.technicianId);
		if (technician) {
			technician.status = 'offline';
			notes.push(`Technician ${technician.id} marked offline`);
		} else {
			notes.push(`Technician ${input.technicianId} not found`);
		}

		for (const job of stateRef().jobs) {
			if (job.technicianId === input.technicianId && job.status !== 'closed') {
				impacted.add(job.id);
			}
		}
	}

	for (const jobId of impacted) {
		const job = findJob(jobId);

		if (!job) {
			notes.push(`Job ${jobId} not found`);
			continue;
		}

		if (job.status === 'closed') {
			continue;
		}

		if (job.status === 'in_progress') {
			blockedJobIds.push(job.id);
			notes.push(
				`Job ${job.id} is in progress and requires manual intervention`,
			);
			continue;
		}

		if (job.technicianId) {
			adjustTechnicianLoad(job.technicianId, -1);
		}

		job.technicianId = null;
		job.status = 'open';
		job.version += 1;
		updateQueue(job.id, `Disruption: ${input.reason}`);

		const reassigned = assignJob({
			jobId: job.id,
			actor,
			reason: `Auto-reassign after disruption: ${input.reason}`,
		});

		if ('assigned' in reassigned && reassigned.assigned) {
			reassignedJobIds.push(job.id);
		} else {
			queuedJobIds.push(job.id);
		}
	}

	pushAudit('disruption_handled', actor, {
		type: input.type,
		reason: input.reason,
		technicianId: input.technicianId ?? null,
		impactedJobIds: Array.from(impacted),
		reassignedJobIds,
		queuedJobIds,
		blockedJobIds,
	});
	syncCoreEntities();

	return {
		processedAt: nowIso(),
		type: input.type,
		impactedJobIds: Array.from(impacted),
		reassignedJobIds,
		queuedJobIds,
		blockedJobIds,
		notes,
	};
}

export function unassignJob(input: {
	jobId: string;
	actor?: string;
	reason?: string;
	expectedVersion?: number;
}): UnassignJobResult {
	const job = findJob(input.jobId);

	if (!job || !job.technicianId) {
		return {
			unassigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobNotAssigned,
			reason: 'Job is not currently assigned',
		};
	}

	if (job.status !== 'assigned') {
		return {
			unassigned: false,
			...transitionFailure(job.status, 'open'),
		};
	}

	if (
		typeof input.expectedVersion === 'number' &&
		input.expectedVersion !== job.version
	) {
		return {
			unassigned: false,
			code: JOB_LIFECYCLE_ERROR_CODES.versionConflict,
			reason: 'Version conflict while unassigning job',
			currentVersion: job.version,
		};
	}

	const previousTechnicianId = job.technicianId;

	job.technicianId = null;
	job.status = 'open';
	job.version += 1;
	adjustTechnicianLoad(previousTechnicianId, -1);
	updateQueue(job.id, input.reason ?? 'Manually unassigned');

	pushAudit('job_unassigned', input.actor ?? 'dispatcher', {
		jobId: job.id,
		technicianId: previousTechnicianId,
		reason: input.reason ?? null,
	});
	syncCoreEntities();

	return {
		unassigned: true,
		jobId: job.id,
	};
}

export function startJob(input: {
	jobId: string;
	actor?: string;
	expectedVersion?: number;
}): StartJobResult {
	const job = findJob(input.jobId);

	if (!job) {
		return {
			started: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobNotFound,
			reason: 'Job not found',
		};
	}

	if (job.status === 'closed') {
		return {
			started: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobAlreadyClosed,
			reason: 'Job already closed',
		};
	}

	if (
		typeof input.expectedVersion === 'number' &&
		input.expectedVersion !== job.version
	) {
		return {
			started: false,
			code: JOB_LIFECYCLE_ERROR_CODES.versionConflict,
			reason: 'Version conflict while starting job',
			currentVersion: job.version,
		};
	}

	if (job.status === 'in_progress') {
		return {
			started: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobAlreadyInProgress,
			reason: 'Job already in progress',
		};
	}

	if (!canTransitionStatus(job.status, 'in_progress')) {
		return {
			started: false,
			...transitionFailure(job.status, 'in_progress'),
		};
	}

	if (!job.technicianId) {
		return {
			started: false,
			code: JOB_LIFECYCLE_ERROR_CODES.missingAssignedTechnician,
			reason: 'Job must have an assigned technician before start',
		};
	}

	job.status = 'in_progress';
	job.version += 1;

	pushAudit('job_status_transition', input.actor ?? 'technician', {
		jobId: job.id,
		change: 'status_transition',
		from: 'assigned',
		to: 'in_progress',
	});
	syncCoreEntities();

	return {
		started: true,
		job,
	};
}

export function updateTechnicianShift(input: {
	technicianId: string;
	start: string;
	end: string;
	actor?: string;
}) {
	const technician = findTechnician(input.technicianId);

	if (!technician) {
		return {
			updated: false,
			reason: 'Technician not found',
		};
	}

	technician.shift = { start: input.start, end: input.end };

	pushAudit('shift_updated', input.actor ?? 'dispatcher', {
		technicianId: technician.id,
		shift: technician.shift,
	});
	syncCoreEntities();

	return {
		updated: true,
		technician,
	};
}

export function generateRoutePlan(input: {
	technicianId: string;
	date: string;
	triggeredBy?: RoutePlan['triggeredBy'];
	trafficLevel?: 'low' | 'normal' | 'high';
}) {
	const technician = findTechnician(input.technicianId);

	if (!technician) {
		return null;
	}

	const assignedJobs = stateRef()
		.jobs.filter(
			(job) =>
				job.technicianId === technician.id &&
				(job.status === 'assigned' || job.status === 'in_progress'),
		)
		.sort(
			(a, b) =>
				routePriorityWeight(b.priority) - routePriorityWeight(a.priority),
		);

	const stops: RouteStop[] = [];
	let totalTravelMinutes = 0;
	let totalDistanceKm = 0;
	let currentPosition = technician.location;

	for (const job of assignedJobs) {
		const eta = stateRef().mapProvider.estimateEta({
			from: currentPosition,
			to: job.location,
			departureAt: new Date(),
			trafficLevel: input.trafficLevel,
		});

		totalTravelMinutes += eta.etaMinutes;
		totalDistanceKm += eta.distanceKm;
		currentPosition = job.location;

		stops.push({
			jobId: job.id,
			locationLabel: job.locationLabel,
			etaMinutes: eta.etaMinutes,
			distanceKm: eta.distanceKm,
		});
	}

	const plan: RoutePlan = {
		id: randomId('route'),
		technicianId: technician.id,
		date: input.date,
		triggeredBy: input.triggeredBy ?? 'manual',
		stops,
		totalTravelMinutes,
		totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
		delayRisk: currentDelayRisk(totalTravelMinutes, stops.length),
		updatedAt: nowIso(),
	};

	stateRef().routePlans = stateRef().routePlans.filter(
		(item) =>
			!(item.technicianId === technician.id && item.date === input.date),
	);
	stateRef().routePlans.unshift(plan);
	const routeSummary = plan.stops
		.map((stop) => `${stop.jobId}@${stop.locationLabel}(${stop.etaMinutes}m)`)
		.join(' -> ');

	const persistedPlan: PersistedRoutePlan = {
		id: plan.id,
		technicianId: plan.technicianId,
		date: plan.date,
		routeSummary,
		totalTravelMinutes: plan.totalTravelMinutes,
		totalDistanceKm: plan.totalDistanceKm,
		delayRisk: plan.delayRisk,
		triggeredBy: plan.triggeredBy,
	};

	fireAndForget(() => stateRef().persistence.upsertRoutePlan(persistedPlan));

	if (plan.triggeredBy === 'traffic') {
		pushAudit('route_replanned', 'system', {
			technicianId: technician.id,
			date: input.date,
			delayRisk: plan.delayRisk,
		});
	}

	return plan;
}

export function triggerTrafficAwareReplanning(input: {
	date: string;
	technicianId?: string;
	trafficLevel?: 'low' | 'normal' | 'high';
}) {
	const technicians = input.technicianId
		? stateRef().technicians.filter(
				(technician) => technician.id === input.technicianId,
			)
		: stateRef().technicians.filter(
				(technician) => technician.activeJobCount > 0,
			);

	const plans = technicians
		.map((technician) =>
			generateRoutePlan({
				technicianId: technician.id,
				date: input.date,
				triggeredBy: 'traffic',
				trafficLevel: input.trafficLevel ?? 'high',
			}),
		)
		.filter((plan): plan is RoutePlan => plan !== null);

	return {
		replanned: plans.length,
		plans,
	};
}

export function getRoutePlans(date?: string) {
	if (!date) {
		return stateRef().routePlans;
	}

	return stateRef().routePlans.filter((plan) => plan.date === date);
}

export function getJobChecklist(jobId: string) {
	const job = findJob(jobId);
	return job?.checklist ?? null;
}

export function updateJobChecklist(input: {
	jobId: string;
	items: Array<{ id: string; done: boolean }>;
}) {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	const updatesById = new Map(input.items.map((item) => [item.id, item.done]));

	for (const item of job.checklist) {
		if (updatesById.has(item.id)) {
			item.done = updatesById.get(item.id) ?? item.done;
		}
	}

	fireAndForget(() =>
		stateRef().persistence.replaceChecklist(
			job.id,
			job.checklist.map((item) => ({
				id: item.id,
				label: item.label,
				required: item.required,
				done: item.done,
			})),
		),
	);

	return job.checklist;
}

export function addProofOfService(input: {
	jobId: string;
	proofUrl: string;
	note?: string;
}) {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	job.proofOfService = {
		proofUrl: input.proofUrl,
		note: input.note,
		uploadedAt: nowIso(),
	};
	const persistedProof: PersistedProofOfService = {
		jobId: job.id,
		proofUrl: job.proofOfService.proofUrl,
		note: job.proofOfService.note,
		uploadedAt: job.proofOfService.uploadedAt,
	};

	fireAndForget(() => stateRef().persistence.addProofOfService(persistedProof));

	return job.proofOfService;
}

export function completeJob(input: {
	jobId: string;
	completionNotes?: string;
	firstTimeFix?: boolean;
	actor?: string;
	expectedVersion?: number;
}): CompleteJobResult {
	const job = findJob(input.jobId);

	if (!job) {
		return {
			completed: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobNotFound,
			reason: 'Job not found',
		};
	}

	if (job.status === 'closed') {
		return {
			completed: false,
			code: JOB_LIFECYCLE_ERROR_CODES.jobAlreadyClosed,
			reason: 'Job already closed',
		};
	}

	if (!canTransitionStatus(job.status, 'closed')) {
		return {
			completed: false,
			...transitionFailure(job.status, 'closed'),
		};
	}

	if (!job.technicianId) {
		return {
			completed: false,
			code: JOB_LIFECYCLE_ERROR_CODES.missingAssignedTechnician,
			reason: 'Job must have an assigned technician before completion',
		};
	}

	if (
		typeof input.expectedVersion === 'number' &&
		input.expectedVersion !== job.version
	) {
		return {
			completed: false,
			code: JOB_LIFECYCLE_ERROR_CODES.versionConflict,
			reason: 'Version conflict while completing job',
		};
	}

	const hasRequiredChecklist = job.checklist.every(
		(item) => !item.required || item.done,
	);

	if (!hasRequiredChecklist) {
		return {
			completed: false,
			code: JOB_LIFECYCLE_ERROR_CODES.checklistIncomplete,
			reason: 'Required checklist items are incomplete',
		};
	}

	job.status = 'closed';
	job.version += 1;
	job.completionNotes = input.completionNotes ?? null;
	job.firstTimeFix = input.firstTimeFix ?? null;
	const completedAt = nowIso();

	adjustTechnicianLoad(job.technicianId, -1);

	stateRef().slaBreaches = stateRef().slaBreaches.filter(
		(breach) => breach.jobId !== job.id,
	);

	const latestStartTransition = stateRef().auditTrail.find(
		(entry) =>
			entry.type === 'job_status_transition' &&
			entry.details.jobId === job.id &&
			entry.details.to === 'in_progress',
	);
	const actualDurationMinutes = latestStartTransition
		? Math.max(
				1,
				Math.round(
					(new Date(completedAt).getTime() -
						new Date(latestStartTransition.timestamp).getTime()) /
						(1000 * 60),
				),
			)
		: null;

	if (actualDurationMinutes !== null) {
		for (const run of stateRef().workOrderIntelligenceRuns) {
			if (run.jobId !== job.id || run.actualDurationMinutes !== null) {
				continue;
			}

			const durationErrorMinutes = Math.abs(
				run.predictedDurationMinutes - actualDurationMinutes,
			);
			run.actualDurationMinutes = actualDurationMinutes;
			run.durationErrorMinutes = durationErrorMinutes;

			fireAndForget(() =>
				stateRef().persistence.updateWorkOrderIntelligenceOutcome(run.id, {
					actualDurationMinutes,
					durationErrorMinutes,
				}),
			);
		}
	}

	pushAudit('job_completed', input.actor ?? 'technician', {
		jobId: job.id,
		firstTimeFix: input.firstTimeFix ?? null,
	});
	syncCoreEntities();

	return {
		completed: true,
		job,
	};
}

function shouldEscalate(priority: JobPriority, minutesOverdue: number) {
	if (priority === 'urgent') {
		return true;
	}

	if (priority === 'high') {
		return minutesOverdue >= 15;
	}

	return minutesOverdue >= 45;
}

export function evaluateSlaBreaches(now = new Date()) {
	const nextBreaches: SlaBreach[] = [];

	for (const job of stateRef().jobs) {
		if (job.status === 'closed') {
			continue;
		}

		const dueAt = new Date(job.slaDueAt);

		if (dueAt > now) {
			continue;
		}

		const minutesOverdue = Math.max(
			1,
			Math.round((now.getTime() - dueAt.getTime()) / (1000 * 60)),
		);
		const escalated = shouldEscalate(job.priority, minutesOverdue);

		const breach: SlaBreach = {
			id: randomId('sla'),
			jobId: job.id,
			priority: job.priority,
			minutesOverdue,
			breachedAt: nowIso(),
			escalated,
		};

		nextBreaches.push(breach);

		if (escalated) {
			const existingEscalation = stateRef().escalations.find(
				(event) => event.jobId === job.id,
			);

			if (!existingEscalation) {
				const escalation: EscalationEvent = {
					id: randomId('esc'),
					jobId: job.id,
					severity: job.priority === 'urgent' ? 'critical' : 'moderate',
					triggeredAt: nowIso(),
					rule: `SLA overdue ${minutesOverdue}m`,
				};
				stateRef().escalations.unshift(escalation);

				const persistedEscalation: PersistedEscalation = {
					id: escalation.id,
					jobId: escalation.jobId,
					severity: escalation.severity,
					rule: escalation.rule,
					triggeredAt: escalation.triggeredAt,
				};
				fireAndForget(() =>
					stateRef().persistence.addEscalation(persistedEscalation),
				);
			}
		}
	}

	stateRef().slaBreaches = nextBreaches;
	fireAndForget(() =>
		stateRef().persistence.replaceSlaBreaches(toPersistedSlaBreaches()),
	);
	return stateRef().slaBreaches;
}

export function getOperationalKpis(now = new Date()): OperationalKpis {
	const activeTechnicians = stateRef().technicians.filter(
		(technician) => technician.status !== 'offline',
	);
	const loadedTechnicians = activeTechnicians.filter(
		(technician) => technician.activeJobCount > 0,
	);
	const completedJobs = stateRef().jobs.filter(
		(job) => job.status === 'closed',
	);
	const completedWithFtf = completedJobs.filter(
		(job) => job.firstTimeFix !== null,
	);

	evaluateSlaBreaches(now);

	const totalTravelMinutes = stateRef().routePlans.reduce(
		(sum, plan) => sum + plan.totalTravelMinutes,
		0,
	);

	return {
		utilizationRate:
			activeTechnicians.length === 0
				? 0
				: Number(
						(loadedTechnicians.length / activeTechnicians.length).toFixed(3),
					),
		firstTimeFixRate:
			completedWithFtf.length === 0
				? 0
				: Number(
						(
							completedWithFtf.filter((job) => job.firstTimeFix === true)
								.length / completedWithFtf.length
						).toFixed(3),
					),
		averageTravelMinutes:
			stateRef().routePlans.length === 0
				? 0
				: Number(
						(totalTravelMinutes / stateRef().routePlans.length).toFixed(1),
					),
		openJobs: stateRef().jobs.filter((job) => job.status !== 'closed').length,
		overdueJobs: stateRef().slaBreaches.length,
	};
}

export function getWorkOrderIntelligenceHistory(input?: {
	jobId?: string;
	limit?: number;
}) {
	const limit = Math.min(500, Math.max(1, input?.limit ?? 50));
	const filtered = input?.jobId
		? stateRef().workOrderIntelligenceRuns.filter(
				(run) => run.jobId === input.jobId,
			)
		: stateRef().workOrderIntelligenceRuns;

	return filtered.slice(0, limit);
}

export function getTechnicianAssistHistory(input?: {
	jobId?: string;
	limit?: number;
}) {
	const limit = Math.min(500, Math.max(1, input?.limit ?? 50));
	const filtered = input?.jobId
		? stateRef().technicianAssistBriefings.filter(
				(run) => run.jobId === input.jobId,
			)
		: stateRef().technicianAssistBriefings;

	return filtered.slice(0, limit);
}

function accuracyFromRuns(
	runs: WorkOrderIntelligenceRun[],
): WorkOrderIntelligenceAccuracy {
	const scoredRuns = runs.filter((run) => run.durationErrorMinutes !== null);

	if (scoredRuns.length === 0) {
		return {
			sampleCount: 0,
			meanAbsoluteErrorMinutes: 0,
			medianAbsoluteErrorMinutes: 0,
			within15MinutesRate: 0,
		};
	}

	const errors = scoredRuns
		.map((run) => run.durationErrorMinutes ?? 0)
		.sort((a, b) => a - b);
	const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
	const middle = Math.floor(errors.length / 2);
	const median =
		errors.length % 2 === 0
			? (errors[middle - 1] + errors[middle]) / 2
			: errors[middle];
	const within15 = errors.filter((value) => value <= 15).length / errors.length;

	return {
		sampleCount: errors.length,
		meanAbsoluteErrorMinutes: Number(mean.toFixed(2)),
		medianAbsoluteErrorMinutes: Number(median.toFixed(2)),
		within15MinutesRate: Number(within15.toFixed(3)),
	};
}

export function getWorkOrderIntelligenceAccuracy(input?: {
	jobId?: string;
}): WorkOrderIntelligenceAccuracy {
	const scopedRuns = input?.jobId
		? stateRef().workOrderIntelligenceRuns.filter(
				(run) => run.jobId === input.jobId,
			)
		: stateRef().workOrderIntelligenceRuns;

	return accuracyFromRuns(scopedRuns);
}

function segmentQuality(
	segment: string,
	runs: WorkOrderIntelligenceRun[],
): IntelligenceQualitySegment {
	const accuracy = accuracyFromRuns(runs);

	return {
		segment,
		sampleCount: accuracy.sampleCount,
		meanAbsoluteErrorMinutes: accuracy.meanAbsoluteErrorMinutes,
		within15MinutesRate: accuracy.within15MinutesRate,
	};
}

export function getWorkOrderIntelligenceQualityReport(input?: {
	windowHours?: number;
}): IntelligenceQualityReport {
	const windowHours = Math.min(720, Math.max(1, input?.windowHours ?? 24));
	const thresholdMs = Date.now() - windowHours * 60 * 60 * 1000;
	const scopedRuns = stateRef().workOrderIntelligenceRuns.filter(
		(run) => new Date(run.generatedAt).getTime() >= thresholdMs,
	);

	const byPriorityMap = new Map<string, WorkOrderIntelligenceRun[]>();
	const bySkillMap = new Map<string, WorkOrderIntelligenceRun[]>();

	for (const run of scopedRuns) {
		const job = findJob(run.jobId);
		const priority = job?.priority ?? 'unknown';
		const skill = job?.requiredSkills[0] ?? 'unknown';

		const byPriority = byPriorityMap.get(priority) ?? [];
		byPriority.push(run);
		byPriorityMap.set(priority, byPriority);

		const bySkill = bySkillMap.get(skill) ?? [];
		bySkill.push(run);
		bySkillMap.set(skill, bySkill);
	}

	return {
		generatedAt: nowIso(),
		windowHours,
		overall: accuracyFromRuns(scopedRuns),
		byPriority: Array.from(byPriorityMap.entries())
			.map(([segment, runs]) => segmentQuality(segment, runs))
			.sort((a, b) => b.sampleCount - a.sampleCount),
		bySkill: Array.from(bySkillMap.entries())
			.map(([segment, runs]) => segmentQuality(segment, runs))
			.sort((a, b) => b.sampleCount - a.sampleCount),
	};
}

export function getWorkOrderIntelligenceDriftAlerts(input?: {
	windowHours?: number;
	minSampleCount?: number;
	maxMaeMinutes?: number;
	minWithin15Rate?: number;
}): IntelligenceDriftAlert[] {
	const report = getWorkOrderIntelligenceQualityReport({
		windowHours: input?.windowHours,
	});
	const minSampleCount = Math.max(1, input?.minSampleCount ?? 3);
	const maxMaeMinutes = input?.maxMaeMinutes ?? 35;
	const minWithin15Rate = input?.minWithin15Rate ?? 0.55;
	const alerts: IntelligenceDriftAlert[] = [];

	function evaluateSegment(
		scope: IntelligenceDriftAlert['scope'],
		segment: string,
		data: IntelligenceQualitySegment,
	) {
		if (data.sampleCount < minSampleCount) {
			return;
		}

		const maeExceeded = data.meanAbsoluteErrorMinutes > maxMaeMinutes;
		const within15Breached = data.within15MinutesRate < minWithin15Rate;

		if (!maeExceeded && !within15Breached) {
			return;
		}

		const severity: IntelligenceDriftAlert['severity'] =
			data.meanAbsoluteErrorMinutes > maxMaeMinutes * 1.35 ||
			data.within15MinutesRate < minWithin15Rate * 0.7
				? 'high'
				: data.meanAbsoluteErrorMinutes > maxMaeMinutes * 1.15 ||
						data.within15MinutesRate < minWithin15Rate * 0.85
					? 'medium'
					: 'low';

		const reasons: string[] = [];
		if (maeExceeded) {
			reasons.push(`MAE ${data.meanAbsoluteErrorMinutes}m > ${maxMaeMinutes}m`);
		}
		if (within15Breached) {
			reasons.push(
				`Within15 ${Math.round(data.within15MinutesRate * 100)}% < ${Math.round(minWithin15Rate * 100)}%`,
			);
		}
		const segmentId = segment
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');

		alerts.push({
			id: `drift-alert-${scope}-${segmentId || 'all'}`,
			severity,
			scope,
			segment,
			sampleCount: data.sampleCount,
			message: `Intelligence drift detected in ${scope}:${segment} (${reasons.join(', ')})`,
			triggeredAt: nowIso(),
			metrics: {
				meanAbsoluteErrorMinutes: data.meanAbsoluteErrorMinutes,
				within15MinutesRate: data.within15MinutesRate,
			},
		});
	}

	evaluateSegment('overall', 'all', {
		segment: 'all',
		sampleCount: report.overall.sampleCount,
		meanAbsoluteErrorMinutes: report.overall.meanAbsoluteErrorMinutes,
		within15MinutesRate: report.overall.within15MinutesRate,
	});

	for (const segment of report.byPriority) {
		evaluateSegment('priority', segment.segment, segment);
	}

	for (const segment of report.bySkill) {
		evaluateSegment('skill', segment.segment, segment);
	}

	return alerts.sort((a, b) => {
		const rank = { high: 3, medium: 2, low: 1 };
		return rank[b.severity] - rank[a.severity];
	});
}

export function assessMaintenanceRisk(
	input: MaintenanceRiskInput,
): MaintenanceRiskResult {
	const ageFactor = clamp(input.assetAgeMonths / 120);
	const incidentFactor = clamp(input.incidentsLast90Days / 12);
	const repairFactor = clamp(input.avgRepairMinutes / 240);
	const usageFactor =
		input.usageIntensity === 'high'
			? 1
			: input.usageIntensity === 'medium'
				? 0.65
				: 0.35;

	const riskScore = clamp(
		ageFactor * 0.25 +
			incidentFactor * 0.4 +
			repairFactor * 0.2 +
			usageFactor * 0.15,
	);

	const result: MaintenanceRiskResult = {
		assetId: input.assetId,
		riskScore: Number(riskScore.toFixed(3)),
		riskBand: riskScore >= 0.7 ? 'high' : riskScore >= 0.4 ? 'medium' : 'low',
		factors: {
			ageFactor: Number(ageFactor.toFixed(3)),
			incidentFactor: Number(incidentFactor.toFixed(3)),
			repairFactor: Number(repairFactor.toFixed(3)),
			usageFactor: Number(usageFactor.toFixed(3)),
		},
		generatedAt: nowIso(),
	};

	const persistedRisk: PersistedMaintenanceRisk = {
		assetId: result.assetId,
		riskScore: result.riskScore,
		riskBand: result.riskBand,
		factors: result.factors,
		generatedAt: result.generatedAt,
	};
	fireAndForget(() => stateRef().persistence.addMaintenanceRisk(persistedRisk));

	return result;
}

export function generateWorkOrderIntelligence(input: {
	jobId: string;
	symptoms?: string[];
	notes?: string;
}): WorkOrderIntelligence | null {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	const symptoms = input.symptoms ?? [];
	const haystack =
		`${job.title} ${symptoms.join(' ')} ${input.notes ?? ''}`.toLowerCase();
	const diagnosisScores = new Map<string, number>();
	const diagnosisRationale = new Map<string, Set<string>>();
	const recommendedParts = new Set<string>();
	const recommendedActions = new Set<string>();
	let durationDeltaMinutes = 0;

	for (const skill of job.requiredSkills) {
		const profile = skillIntelligenceProfiles[skill];

		if (!profile) {
			continue;
		}

		for (const diagnosis of profile.diagnoses) {
			diagnosisScores.set(
				diagnosis,
				(diagnosisScores.get(diagnosis) ?? 0) + 0.38,
			);
			const rationale = diagnosisRationale.get(diagnosis) ?? new Set<string>();
			rationale.add(`Mapped from ${skill} job skill requirements`);
			diagnosisRationale.set(diagnosis, rationale);
		}

		for (const part of profile.parts) {
			recommendedParts.add(part);
		}

		for (const action of profile.actions) {
			recommendedActions.add(action);
		}
	}

	for (const signal of symptomSignals) {
		if (!signal.keywords.some((keyword) => haystack.includes(keyword))) {
			continue;
		}

		diagnosisScores.set(
			signal.diagnosis,
			(diagnosisScores.get(signal.diagnosis) ?? 0) + 0.32,
		);
		const rationale =
			diagnosisRationale.get(signal.diagnosis) ?? new Set<string>();
		rationale.add(`Detected symptom keywords: ${signal.keywords.join(', ')}`);
		diagnosisRationale.set(signal.diagnosis, rationale);

		if (signal.part) {
			recommendedParts.add(signal.part);
		}

		if (signal.action) {
			recommendedActions.add(signal.action);
		}

		durationDeltaMinutes += signal.durationDeltaMinutes;
	}

	if (diagnosisScores.size === 0) {
		diagnosisScores.set('General field diagnostics required', 0.45);
		diagnosisRationale.set(
			'General field diagnostics required',
			new Set([
				'No direct symptom/skill pattern match; schedule broad diagnostic checks',
			]),
		);
	}

	const complexityMultiplier = clamp(
		1 +
			job.requiredSkills.length * 0.08 +
			symptoms.length * 0.03 +
			(input.notes ? 0.04 : 0),
		1,
		1.35,
	);
	const priorityAdjustment =
		job.priority === 'urgent'
			? 12
			: job.priority === 'high'
				? 8
				: job.priority === 'normal'
					? 4
					: 0;
	const predictedDurationMinutes = Math.max(
		15,
		Math.round(
			job.estimatedMinutes * complexityMultiplier +
				durationDeltaMinutes +
				priorityAdjustment,
		),
	);

	const probableDiagnoses = Array.from(diagnosisScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([label, score]) => ({
			label,
			confidence: Number(clamp(score, 0.2, 0.95).toFixed(3)),
			rationale: Array.from(diagnosisRationale.get(label) ?? []).join('; '),
		}));

	const confidence = Number(
		clamp(
			0.52 +
				job.requiredSkills.length * 0.06 +
				probableDiagnoses.length * 0.04 +
				Math.min(0.16, symptoms.length * 0.04) +
				(input.notes ? 0.03 : 0),
			0.35,
			0.95,
		).toFixed(3),
	);

	return recordWorkOrderIntelligenceRun(job, input, {
		predictedDurationMinutes,
		confidence,
		probableDiagnoses,
		recommendedParts: Array.from(recommendedParts).slice(0, 6),
		recommendedActions: Array.from(recommendedActions).slice(0, 6),
		generatedAt: nowIso(),
	});
}

export function storeExternalWorkOrderIntelligence(input: {
	jobId: string;
	symptoms?: string[];
	notes?: string;
	result: Omit<WorkOrderIntelligence, 'jobId' | 'status'>;
}) {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	return recordWorkOrderIntelligenceRun(
		job,
		{ symptoms: input.symptoms, notes: input.notes },
		input.result,
	);
}

export function generateTechnicianAssistBriefing(input: {
	jobId: string;
	noteContext?: string;
}): TechnicianAssistBriefing | null {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	const recommendedSteps: string[] = [];
	const riskFlags: string[] = [];
	const smartFieldSet = new Set<string>();

	const pendingRequiredChecklist = job.checklist.filter(
		(item) => item.required && !item.done,
	);
	for (const item of pendingRequiredChecklist) {
		recommendedSteps.push(`Complete required checklist item: ${item.label}`);
	}

	if (job.priority === 'urgent' || job.priority === 'high') {
		recommendedSteps.push(
			'Capture customer impact severity and expected business downtime',
		);
		riskFlags.push('Priority requires fast triage and escalation readiness');
	}

	if (!job.proofOfService) {
		recommendedSteps.push(
			'Capture proof-of-service media before closing the job',
		);
	}

	if (job.status === 'assigned') {
		recommendedSteps.push(
			'Record arrival timestamp and pre-work safety confirmation',
		);
	} else if (job.status === 'in_progress') {
		recommendedSteps.push(
			'Log intermediate findings every major diagnostic milestone',
		);
	} else if (job.status === 'open') {
		recommendedSteps.push(
			'Confirm assignment and technician ETA before field dispatch',
		);
	}

	const dueAt = new Date(job.slaDueAt);
	const minutesToDue = Math.round((dueAt.getTime() - Date.now()) / (1000 * 60));
	if (minutesToDue <= 30) {
		riskFlags.push('SLA breach risk within 30 minutes');
	}

	for (const skill of job.requiredSkills) {
		for (const field of smartFormFieldBySkill[skill] ?? []) {
			smartFieldSet.add(field);
		}
	}

	if (smartFieldSet.size === 0) {
		smartFieldSet.add('diagnosticSummary');
		smartFieldSet.add('rootCauseHypothesis');
		smartFieldSet.add('customerApprovalConfirmation');
	}

	const contextPrompt = input.noteContext
		? `Include this context in the opening voice note: ${input.noteContext}`
		: 'Open with site conditions, customer impact, and suspected root cause';

	return recordTechnicianAssistBriefingRun(job, {
		recommendedSteps,
		smartFormFields: Array.from(smartFieldSet),
		voiceNotePrompts: [
			contextPrompt,
			'State what was tested, what passed, and what failed',
			'Summarize resolution status and required follow-up actions',
		],
		riskFlags,
		generatedAt: nowIso(),
	});
}

export function storeExternalTechnicianAssistBriefing(input: {
	jobId: string;
	result: Omit<TechnicianAssistBriefing, 'jobId' | 'status'>;
}) {
	const job = findJob(input.jobId);

	if (!job) {
		return null;
	}

	return recordTechnicianAssistBriefingRun(job, input.result);
}

export function recordManualOverride(input: {
	jobId: string;
	actor: string;
	reason: string;
	changes?: Record<string, unknown>;
}) {
	const job = findJob(input.jobId);

	if (!job) {
		return {
			recorded: false,
			reason: 'Job not found',
		};
	}

	pushAudit('manual_override', input.actor, {
		jobId: job.id,
		reason: input.reason,
		changes: input.changes ?? {},
	});
	const persistedOverride: PersistedManualOverride = {
		jobId: job.id,
		actor: input.actor,
		reason: input.reason,
		changes: input.changes ?? {},
		createdAt: nowIso(),
	};
	fireAndForget(() =>
		stateRef().persistence.addManualOverride(persistedOverride),
	);

	return {
		recorded: true,
	};
}

export function getDispatchBoard(now = new Date()): DispatchBoard {
	evaluateSlaBreaches(now);

	return {
		modules: fieldOpsModules,
		activeJobs: stateRef().jobs.filter((job) => job.status !== 'closed').length,
		availableTechnicians: stateRef().technicians.filter(
			(technician) => technician.status === 'available',
		).length,
		technicians: stateRef().technicians,
		jobs: stateRef().jobs,
		unassignedQueue: stateRef().unassignedQueue,
		slaBreaches: stateRef().slaBreaches,
	};
}

export function getAuditTrail(limit = 50) {
	return stateRef().auditTrail.slice(0, Math.max(1, limit));
}

export function getUnassignedQueue() {
	return stateRef().unassignedQueue;
}

export function getEscalations() {
	return stateRef().escalations;
}

export function listJobs() {
	return stateRef().jobs;
}

export function getJobById(jobId: string) {
	return findJob(jobId) ?? null;
}

export function listTechnicians() {
	return stateRef().technicians;
}

export function configureFieldOpsPersistence(
	persistence: FieldOpsPersistence,
	options?: { syncOnConfigure?: boolean },
) {
	configuredPersistence = persistence;
	const state = stateRef();
	state.persistence = persistence;

	if (options?.syncOnConfigure ?? true) {
		syncCoreEntities();
	}
}

export function hydrateFieldOpsStateFromPersistence(
	snapshot: PersistedCoreSnapshot | null,
) {
	if (!snapshot) {
		return false;
	}

	const state = stateRef();
	const checklistByJob = new Map(
		state.jobs.map((job) => [job.id, job.checklist]),
	);

	state.technicians = snapshot.technicians.map((technician) => ({
		id: technician.id,
		name: technician.name,
		status: technician.status,
		homeBase: technician.homeBase,
		location: technician.location,
		skills: technician.skills,
		shift: { start: technician.shiftStart, end: technician.shiftEnd },
		activeJobCount: technician.activeJobCount,
		maxConcurrentJobs: technician.maxConcurrentJobs,
	}));

	state.jobs = snapshot.jobs.map((job) => ({
		id: job.id,
		title: job.title,
		version: job.version,
		customerId: job.customerId,
		locationLabel: job.locationLabel,
		location: job.location,
		status: job.status,
		technicianId: job.technicianId,
		requiredSkills: job.requiredSkills,
		priority: job.priority,
		slaDueAt: job.slaDueAt,
		estimatedMinutes: job.estimatedMinutes,
		checklist: checklistByJob.get(job.id) ?? cloneChecklist(),
		proofOfService: null,
		completionNotes: job.completionNotes,
		firstTimeFix: job.firstTimeFix,
	}));

	state.unassignedQueue = snapshot.queue.map((entry) => ({
		id: entry.id,
		jobId: entry.jobId,
		reason: entry.reason,
		queuedAt: entry.queuedAt,
	}));

	state.slaBreaches = snapshot.breaches.map((breach) => ({
		id: breach.id,
		jobId: breach.jobId,
		priority: breach.priority,
		minutesOverdue: breach.minutesOverdue,
		breachedAt: breach.breachedAt,
		escalated: breach.escalated,
	}));

	return true;
}

export function hydrateFieldOpsIntelligenceHistoryFromPersistence(input: {
	workOrderRuns: PersistedWorkOrderIntelligenceRun[];
	assistBriefings: PersistedTechnicianAssistBriefing[];
}) {
	const state = stateRef();

	state.workOrderIntelligenceRuns = input.workOrderRuns.map((run) => ({
		id: run.id,
		jobId: run.jobId,
		status: run.statusAtPrediction,
		predictedDurationMinutes: run.predictedDurationMinutes,
		confidence: run.confidence,
		probableDiagnoses: run.probableDiagnoses,
		recommendedParts: run.recommendedParts,
		recommendedActions: run.recommendedActions,
		symptoms: run.symptoms,
		notes: run.notes,
		generatedAt: run.generatedAt,
		actualDurationMinutes: run.actualDurationMinutes,
		durationErrorMinutes: run.durationErrorMinutes,
	}));

	state.technicianAssistBriefings = input.assistBriefings.map((briefing) => ({
		id: briefing.id,
		jobId: briefing.jobId,
		status: briefing.statusAtGeneration,
		recommendedSteps: briefing.recommendedSteps,
		smartFormFields: briefing.smartFormFields,
		voiceNotePrompts: briefing.voiceNotePrompts,
		riskFlags: briefing.riskFlags,
		generatedAt: briefing.generatedAt,
	}));
}

export function resetFieldOpsStateForTests(
	mapProvider?: MapProvider,
	persistence?: FieldOpsPersistence,
) {
	configuredMapProvider = mapProvider ?? defaultMapProvider;
	configuredPersistence = persistence ?? new NoopFieldOpsPersistence();
	tenantStates.clear();
	tenantStates.set(
		'default',
		initialState(configuredMapProvider, configuredPersistence),
	);
}

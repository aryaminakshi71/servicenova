import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	type DispatchBoard,
	getFieldOpsSummary,
	type IntelligenceQualityReport,
	type TechnicianAssistBriefing,
	type TechnicianAssistBriefingRun,
	type WorkOrderIntelligence,
	type WorkOrderIntelligenceAccuracy,
	type WorkOrderIntelligenceRun,
} from './features/field-ops';
import { LandingPage } from './LandingPage';
import { flushMobileQueue } from './mobile/offline-queue';

const summary = getFieldOpsSummary();
const refreshMs = 15_000;
const defaultDashboardUserId = 'web-dashboard';
const defaultTenantId = 'default';
const e2eTenantStorageKey = 'servicenova:e2e:tenantId';
const e2eUserStorageKey = 'servicenova:e2e:userId';
const onboardingStorageKey = 'servicenova:onboarding:v1';
const streamStaleThresholdMs = 20_000;
const googleAuthEnabled = __SERVICENOVA_GOOGLE_AUTH_ENABLED__;
const githubAuthEnabled = __SERVICENOVA_GITHUB_AUTH_ENABLED__;

type StreamHealthStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
type IntelligenceConfirmAction =
	| 'auto_dispatch'
	| 'parts_order'
	| 'customer_eta_update';
type OnboardingStepId =
	| 'selectedJob'
	| 'intelligenceRun'
	| 'dispatchOptimized'
	| 'automationCycle';

type IntelligenceGuardrail = {
	minimumConfidence: number;
	requiresConfirmation: boolean;
	mode: 'recommendation_only' | 'automation_allowed';
};

type OnboardingChecklist = Record<OnboardingStepId, boolean> & {
	dismissed: boolean;
};

type DriftAlertAcknowledgement = {
	alertId: string;
	owner: string;
	acknowledgedBy: string;
	acknowledgedAt: string;
	slaDueAt: string;
	note: string | null;
};

type DriftAlert = {
	id: string;
	severity: string;
	message: string;
	acknowledged?: boolean;
	acknowledgement?: DriftAlertAcknowledgement | null;
};

type IncidentTimelineEvent = {
	id: string;
	type: string;
	severity: 'info' | 'warning' | 'critical';
	message: string;
	timestamp: string;
	actor: string;
	context: Record<string, unknown>;
};

const defaultOnboardingChecklist: OnboardingChecklist = {
	selectedJob: false,
	intelligenceRun: false,
	dispatchOptimized: false,
	automationCycle: false,
	dismissed: false,
};

const onboardingSteps: Array<{ id: OnboardingStepId; label: string }> = [
	{
		id: 'selectedJob',
		label: 'Select a dispatch job',
	},
	{
		id: 'intelligenceRun',
		label: 'Run work-order intelligence',
	},
	{
		id: 'dispatchOptimized',
		label: 'Run dispatch optimization',
	},
	{
		id: 'automationCycle',
		label: 'Run a full automation cycle',
	},
];

const confirmActionLabels: Record<IntelligenceConfirmAction, string> = {
	auto_dispatch: 'Confirm Auto Dispatch',
	parts_order: 'Confirm Parts Order',
	customer_eta_update: 'Confirm ETA Update',
};

function formatPercent(value: number) {
	return `${Math.round(value * 100)}%`;
}

function sanitizeAuthSegment(
	value: string | null | undefined,
	fallback: string,
) {
	const normalized = value?.trim() ?? '';
	if (!normalized) {
		return fallback;
	}

	return normalized.replaceAll(':', '-');
}

function parseStoredUser(value: string | null) {
	if (!value) {
		return null;
	}

	try {
		return JSON.parse(value) as { id?: string; tenantId?: string };
	} catch {
		return null;
	}
}

function parseStoredOnboardingChecklist(
	value: string | null,
): OnboardingChecklist {
	if (!value) {
		return { ...defaultOnboardingChecklist };
	}

	try {
		const parsed = JSON.parse(value) as Partial<OnboardingChecklist>;
		return {
			selectedJob: Boolean(parsed.selectedJob),
			intelligenceRun: Boolean(parsed.intelligenceRun),
			dispatchOptimized: Boolean(parsed.dispatchOptimized),
			automationCycle: Boolean(parsed.automationCycle),
			dismissed: Boolean(parsed.dismissed),
		};
	} catch {
		return { ...defaultOnboardingChecklist };
	}
}

function normalizeOnboardingChecklist(
	value: Partial<OnboardingChecklist> | null | undefined,
): OnboardingChecklist {
	return {
		selectedJob: Boolean(value?.selectedJob),
		intelligenceRun: Boolean(value?.intelligenceRun),
		dispatchOptimized: Boolean(value?.dispatchOptimized),
		automationCycle: Boolean(value?.automationCycle),
		dismissed: Boolean(value?.dismissed),
	};
}

function toLocalDateTimeInput(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoFromDateTimeInput(value: string) {
	if (!value.trim()) {
		return null;
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return parsed.toISOString();
}

function formatSecondsAgo(timestampMs: number | null, nowMs: number) {
	if (!timestampMs) {
		return 'Waiting for first update';
	}

	const elapsedSeconds = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
	return `${elapsedSeconds}s ago`;
}

function resolveDashboardAuth() {
	if (typeof window === 'undefined') {
		const streamQuery = new URLSearchParams({
			role: 'manager',
			userId: defaultDashboardUserId,
			tenantId: defaultTenantId,
		}).toString();
		return {
			authToken: `Bearer manager:${defaultDashboardUserId}:${defaultTenantId}`,
			streamQuery,
			userId: defaultDashboardUserId,
			tenantId: defaultTenantId,
		};
	}

	const forcedTenantId = sanitizeAuthSegment(
		window.localStorage.getItem(e2eTenantStorageKey),
		defaultTenantId,
	);
	const forcedUserId = sanitizeAuthSegment(
		window.localStorage.getItem(e2eUserStorageKey),
		defaultDashboardUserId,
	);
	const storedUser = parseStoredUser(window.localStorage.getItem('user'));
	const userId = sanitizeAuthSegment(storedUser?.id, forcedUserId);
	const tenantId = sanitizeAuthSegment(storedUser?.tenantId, forcedTenantId);
	const streamQuery = new URLSearchParams({
		role: 'manager',
		userId,
		tenantId,
	}).toString();

	return {
		authToken: `Bearer manager:${userId}:${tenantId}`,
		streamQuery,
		userId,
		tenantId,
	};
}

function AuthenticatedContent(props: {
	authToken: string;
	streamQuery: string;
	dashboardUserId: string;
}) {
	const { authToken, streamQuery, dashboardUserId } = props;
	const [dispatchBoard, setDispatchBoard] = useState<DispatchBoard | null>(
		null,
	);
	const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
	const [selectedDisruptionTechId, setSelectedDisruptionTechId] =
		useState<string>('');
	const [disruptionReason, setDisruptionReason] = useState('Vehicle breakdown');
	const [disruptionLoading, setDisruptionLoading] = useState(false);
	const [disruptionMessage, setDisruptionMessage] = useState<string | null>(
		null,
	);
	const [opsMessage, setOpsMessage] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [aiLoading, setAiLoading] = useState(false);
	const [aiError, setAiError] = useState<string | null>(null);
	const [workOrderIntelligence, setWorkOrderIntelligence] =
		useState<WorkOrderIntelligence | null>(null);
	const [technicianAssist, setTechnicianAssist] =
		useState<TechnicianAssistBriefing | null>(null);
	const [intelligenceHistory, setIntelligenceHistory] = useState<
		WorkOrderIntelligenceRun[]
	>([]);
	const [assistHistory, setAssistHistory] = useState<
		TechnicianAssistBriefingRun[]
	>([]);
	const [accuracy, setAccuracy] = useState<WorkOrderIntelligenceAccuracy>({
		sampleCount: 0,
		meanAbsoluteErrorMinutes: 0,
		medianAbsoluteErrorMinutes: 0,
		within15MinutesRate: 0,
	});
	const [qualityReport, setQualityReport] =
		useState<IntelligenceQualityReport | null>(null);
	const [driftAlerts, setDriftAlerts] = useState<DriftAlert[]>([]);
	const [observability, setObservability] = useState<{
		totalRequests: number;
		p95Ms: number;
		errorRate: number;
		sloBreached: boolean;
	} | null>(null);
	const [streamHealth, setStreamHealth] =
		useState<StreamHealthStatus>('connecting');
	const [streamWarning, setStreamWarning] = useState<string | null>(null);
	const [lastBoardUpdateAt, setLastBoardUpdateAt] = useState<number | null>(
		null,
	);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const [intelligenceGuardrail, setIntelligenceGuardrail] =
		useState<IntelligenceGuardrail | null>(null);
	const [guardrailMessage, setGuardrailMessage] = useState<string | null>(null);
	const [confirmingAction, setConfirmingAction] =
		useState<IntelligenceConfirmAction | null>(null);
	const [onboarding, setOnboarding] = useState<OnboardingChecklist>(() => {
		if (typeof window === 'undefined') {
			return { ...defaultOnboardingChecklist };
		}

		return parseStoredOnboardingChecklist(
			window.localStorage.getItem(onboardingStorageKey),
		);
	});
	const [onboardingSyncReady, setOnboardingSyncReady] = useState(false);
	const [onboardingSyncMessage, setOnboardingSyncMessage] = useState<
		string | null
	>(null);
	const onboardingVersionRef = useRef(0);
	const [incidents, setIncidents] = useState<IncidentTimelineEvent[]>([]);
	const [incidentStreamWarning, setIncidentStreamWarning] = useState<
		string | null
	>(null);
	const [driftAckOwner, setDriftAckOwner] = useState(dashboardUserId);
	const [driftAckDueAt, setDriftAckDueAt] = useState(() =>
		toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
	);
	const [driftAckNote, setDriftAckNote] = useState('');
	const [driftAckMessage, setDriftAckMessage] = useState<string | null>(null);
	const [acknowledgingAlertId, setAcknowledgingAlertId] = useState<
		string | null
	>(null);

	const loadDispatchBoardSnapshot = useCallback(async () => {
		const response = await fetch('/api/field/dispatch-board', {
			headers: {
				authorization: authToken,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		return (await response.json()) as DispatchBoard;
	}, [authToken]);

	const loadServerOnboardingSnapshot = useCallback(async () => {
		const response = await fetch('/api/field/dashboard/onboarding', {
			headers: {
				authorization: authToken,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const payload = (await response.json()) as {
			onboarding?: Partial<OnboardingChecklist>;
		};

		return normalizeOnboardingChecklist(payload.onboarding);
	}, [authToken]);

	const saveServerOnboardingSnapshot = useCallback(
		async (input: OnboardingChecklist) => {
			const response = await fetch('/api/field/dashboard/onboarding', {
				method: 'POST',
				headers: {
					authorization: authToken,
					'content-type': 'application/json',
				},
				body: JSON.stringify(input),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
		},
		[authToken],
	);

	const loadIncidentTimeline = useCallback(
		async (limit = 20) => {
			const response = await fetch(`/api/field/ops/incidents?limit=${limit}`, {
				headers: {
					authorization: authToken,
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				incidents?: IncidentTimelineEvent[];
			};
			setIncidents(payload.incidents ?? []);
		},
		[authToken],
	);

	const markOnboardingStep = (stepId: OnboardingStepId) => {
		onboardingVersionRef.current += 1;
		setOnboarding((previous) => {
			if (previous[stepId]) {
				return previous;
			}

			return {
				...previous,
				[stepId]: true,
			};
		});
	};

	useEffect(() => {
		let cancelled = false;
		setStreamHealth('connecting');

		async function loadDispatchBoard() {
			try {
				const payload = await loadDispatchBoardSnapshot();

				if (!cancelled) {
					setDispatchBoard(payload);
					setLastBoardUpdateAt(Date.now());
					setError(null);
				}
			} catch {
				if (!cancelled) {
					setError('Dispatch API unavailable. Showing strategy modules only.');
					setStreamHealth('offline');
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		loadDispatchBoard();
		const timer = window.setInterval(loadDispatchBoard, refreshMs);
		const stream = new EventSource(
			`/api/field/dispatch-board/stream?${streamQuery}`,
		);
		stream.onopen = () => {
			setStreamHealth('live');
			setStreamWarning(null);
		};
		stream.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data) as { board?: DispatchBoard };

				if (payload.board) {
					setDispatchBoard(payload.board);
					setLastBoardUpdateAt(Date.now());
					setStreamHealth('live');
					setStreamWarning(null);
				}
			} catch {
				// Ignore malformed stream payloads and keep polling fallback.
			}
		};
		stream.onerror = () => {
			setStreamHealth('reconnecting');
			setStreamWarning(
				'Realtime stream is reconnecting. Polling fallback is active.',
			);
		};

		return () => {
			cancelled = true;
			window.clearInterval(timer);
			stream.close();
		};
	}, [loadDispatchBoardSnapshot, streamQuery]);

	useEffect(() => {
		setDriftAckOwner(dashboardUserId);
	}, [dashboardUserId]);

	useEffect(() => {
		let cancelled = false;
		const loadVersion = onboardingVersionRef.current;
		setOnboardingSyncReady(false);
		setOnboardingSyncMessage(null);

		void loadServerOnboardingSnapshot()
			.then((snapshot) => {
				if (!cancelled && onboardingVersionRef.current === loadVersion) {
					setOnboarding(snapshot);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setOnboardingSyncMessage(
						'Using local onboarding fallback. Server sync will retry.',
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setOnboardingSyncReady(true);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [loadServerOnboardingSnapshot]);

	useEffect(() => {
		if (!onboardingSyncReady) {
			return;
		}

		const timer = window.setTimeout(() => {
			void saveServerOnboardingSnapshot(onboarding)
				.then(() => {
					setOnboardingSyncMessage(null);
				})
				.catch(() => {
					setOnboardingSyncMessage(
						'Unable to sync onboarding progress to server.',
					);
				});
		}, 250);

		return () => {
			window.clearTimeout(timer);
		};
	}, [onboarding, onboardingSyncReady, saveServerOnboardingSnapshot]);

	useEffect(() => {
		let cancelled = false;
		setIncidentStreamWarning(null);

		void loadIncidentTimeline().catch(() => {
			if (!cancelled) {
				setIncidentStreamWarning('Unable to load incident timeline.');
			}
		});

		const timer = window.setInterval(() => {
			void loadIncidentTimeline().catch(() => {
				if (!cancelled) {
					setIncidentStreamWarning(
						'Incident timeline polling fallback is active.',
					);
				}
			});
		}, 30_000);

		const stream = new EventSource(
			`/api/field/ops/incidents/stream?${streamQuery}&limit=20`,
		);
		stream.onopen = () => {
			setIncidentStreamWarning(null);
		};
		stream.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data) as {
					incidents?: IncidentTimelineEvent[];
				};
				setIncidents(payload.incidents ?? []);
			} catch {
				// Ignore malformed payloads and preserve polling fallback.
			}
		};
		stream.onerror = () => {
			setIncidentStreamWarning('Incident stream is reconnecting.');
		};

		return () => {
			cancelled = true;
			window.clearInterval(timer);
			stream.close();
		};
	}, [loadIncidentTimeline, streamQuery]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		window.localStorage.setItem(
			onboardingStorageKey,
			JSON.stringify(onboarding),
		);
	}, [onboarding]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNowMs(Date.now());
		}, 5000);

		return () => {
			window.clearInterval(timer);
		};
	}, []);

	const utilization = useMemo(() => {
		if (!dispatchBoard || dispatchBoard.technicians.length === 0) {
			return 0;
		}

		const loaded = dispatchBoard.technicians.filter(
			(technician) => technician.activeJobCount > 0,
		).length;

		return loaded / dispatchBoard.technicians.length;
	}, [dispatchBoard]);

	const selectedJob = useMemo(() => {
		if (!dispatchBoard || !selectedJobId) {
			return null;
		}

		return dispatchBoard.jobs.find((job) => job.id === selectedJobId) ?? null;
	}, [dispatchBoard, selectedJobId]);

	useEffect(() => {
		if (!dispatchBoard || dispatchBoard.jobs.length === 0) {
			setSelectedJobId(null);
			return;
		}

		if (
			!selectedJobId ||
			!dispatchBoard.jobs.some((job) => job.id === selectedJobId)
		) {
			setSelectedJobId(dispatchBoard.jobs[0].id);
		}
	}, [dispatchBoard, selectedJobId]);

	useEffect(() => {
		if (selectedJobId) {
			onboardingVersionRef.current += 1;
			setOnboarding((previous) =>
				previous.selectedJob ? previous : { ...previous, selectedJob: true },
			);
		}
	}, [selectedJobId]);

	useEffect(() => {
		if (!dispatchBoard || dispatchBoard.technicians.length === 0) {
			setSelectedDisruptionTechId('');
			return;
		}

		if (
			!selectedDisruptionTechId ||
			!dispatchBoard.technicians.some(
				(technician) => technician.id === selectedDisruptionTechId,
			)
		) {
			setSelectedDisruptionTechId(dispatchBoard.technicians[0].id);
		}
	}, [dispatchBoard, selectedDisruptionTechId]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void flushMobileQueue(authToken);
		}, 20_000);

		return () => {
			window.clearInterval(timer);
		};
	}, [authToken]);

	const loadIntelligencePanels = useCallback(
		async (jobId: string) => {
			const historyResponse = await fetch(
				`/api/field/intelligence/history?jobId=${encodeURIComponent(jobId)}&limit=20`,
				{
					headers: {
						authorization: authToken,
					},
				},
			);
			const accuracyResponse = await fetch(
				`/api/field/intelligence/accuracy?jobId=${encodeURIComponent(jobId)}`,
				{
					headers: {
						authorization: authToken,
					},
				},
			);

			if (!historyResponse.ok || !accuracyResponse.ok) {
				throw new Error('Unable to load intelligence insights');
			}

			const historyPayload = (await historyResponse.json()) as {
				workOrderRuns?: WorkOrderIntelligenceRun[];
				assistBriefings?: TechnicianAssistBriefingRun[];
			};
			const accuracyPayload = (await accuracyResponse.json()) as {
				accuracy?: WorkOrderIntelligenceAccuracy;
			};

			setIntelligenceHistory(historyPayload.workOrderRuns ?? []);
			setAssistHistory(historyPayload.assistBriefings ?? []);
			setAccuracy(
				accuracyPayload.accuracy ?? {
					sampleCount: 0,
					meanAbsoluteErrorMinutes: 0,
					medianAbsoluteErrorMinutes: 0,
					within15MinutesRate: 0,
				},
			);
		},
		[authToken],
	);

	const loadOpsPanels = useCallback(async () => {
		const [metricsResponse, qualityResponse, driftResponse] = await Promise.all(
			[
				fetch('/api/field/observability/metrics?windowMinutes=120', {
					headers: {
						authorization: authToken,
					},
				}),
				fetch('/api/field/intelligence/quality-report?windowHours=24', {
					headers: {
						authorization: authToken,
					},
				}),
				fetch(
					'/api/field/intelligence/drift-alerts?windowHours=24&minSampleCount=3',
					{
						headers: {
							authorization: authToken,
						},
					},
				),
			],
		);

		if (!metricsResponse.ok || !qualityResponse.ok || !driftResponse.ok) {
			throw new Error('Unable to load ops panels');
		}

		const metricsPayload = (await metricsResponse.json()) as {
			metrics?: {
				totalRequests: number;
				p95Ms: number;
				errorRate: number;
				sloBreached: boolean;
			};
		};
		const qualityPayload = (await qualityResponse.json()) as {
			report?: IntelligenceQualityReport;
		};
		const driftPayload = (await driftResponse.json()) as {
			alerts?: DriftAlert[];
		};

		setObservability(metricsPayload.metrics ?? null);
		setQualityReport(qualityPayload.report ?? null);
		setDriftAlerts(driftPayload.alerts ?? []);
	}, [authToken]);

	useEffect(() => {
		if (!selectedJobId) {
			setIntelligenceHistory([]);
			setAssistHistory([]);
			setAccuracy({
				sampleCount: 0,
				meanAbsoluteErrorMinutes: 0,
				medianAbsoluteErrorMinutes: 0,
				within15MinutesRate: 0,
			});
			return;
		}

		void loadIntelligencePanels(selectedJobId).catch(() => {
			setAiError('Unable to load intelligence history right now.');
		});
	}, [loadIntelligencePanels, selectedJobId]);

	useEffect(() => {
		void loadOpsPanels().catch(() => {
			setOpsMessage('Unable to load operational metrics.');
		});

		const timer = window.setInterval(() => {
			void loadOpsPanels().catch(() => {
				setOpsMessage('Unable to refresh operational metrics.');
			});
		}, 30_000);

		return () => {
			window.clearInterval(timer);
		};
	}, [loadOpsPanels]);

	async function runWorkOrderIntelligence() {
		if (!selectedJob) {
			return;
		}

		setAiLoading(true);
		setAiError(null);
		setGuardrailMessage(null);

		try {
			const response = await fetch(
				`/api/field/jobs/${encodeURIComponent(selectedJob.id)}/intelligence`,
				{
					method: 'POST',
					headers: {
						authorization: authToken,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						symptoms: [selectedJob.title],
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				result?: WorkOrderIntelligence;
				guardrail?: IntelligenceGuardrail;
			};

			if (payload.result) {
				setWorkOrderIntelligence(payload.result);
				markOnboardingStep('intelligenceRun');
			}
			setIntelligenceGuardrail(payload.guardrail ?? null);

			await loadIntelligencePanels(selectedJob.id);
		} catch {
			setAiError('Unable to generate work-order intelligence.');
			setIntelligenceGuardrail(null);
		} finally {
			setAiLoading(false);
		}
	}

	async function confirmIntelligenceAction(action: IntelligenceConfirmAction) {
		if (!selectedJob || !workOrderIntelligence?.runId) {
			return;
		}

		setConfirmingAction(action);
		setGuardrailMessage(null);
		setAiError(null);

		try {
			const response = await fetch(
				`/api/field/jobs/${encodeURIComponent(selectedJob.id)}/intelligence/confirm`,
				{
					method: 'POST',
					headers: {
						authorization: authToken,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						runId: workOrderIntelligence.runId,
						action,
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				confirmed: boolean;
				action: string;
				bypassedGuardrail: boolean;
			};

			setGuardrailMessage(
				payload.confirmed
					? `Action confirmed: ${payload.action.replaceAll('_', ' ')}${payload.bypassedGuardrail ? ' (manual override recorded).' : '.'}`
					: 'No action was confirmed.',
			);

			await loadIntelligencePanels(selectedJob.id);
		} catch {
			setGuardrailMessage('Unable to confirm AI recommendation.');
		} finally {
			setConfirmingAction(null);
		}
	}

	async function acknowledgeDriftAlert(alertId: string) {
		const dueAt = toIsoFromDateTimeInput(driftAckDueAt);

		if (!dueAt) {
			setDriftAckMessage('Provide a valid SLA due date/time.');
			return;
		}

		setAcknowledgingAlertId(alertId);
		setDriftAckMessage(null);

		try {
			const response = await fetch(
				`/api/field/intelligence/drift-alerts/${encodeURIComponent(alertId)}/acknowledge`,
				{
					method: 'POST',
					headers: {
						authorization: authToken,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						owner: driftAckOwner || dashboardUserId,
						slaDueAt: dueAt,
						note: driftAckNote || undefined,
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			setDriftAckMessage(`Drift alert ${alertId} acknowledged.`);
			await Promise.all([loadOpsPanels(), loadIncidentTimeline()]);
		} catch {
			setDriftAckMessage('Unable to acknowledge drift alert.');
		} finally {
			setAcknowledgingAlertId(null);
		}
	}

	async function runTechnicianAssistBriefing() {
		if (!selectedJob) {
			return;
		}

		setAiLoading(true);
		setAiError(null);

		try {
			const response = await fetch(
				`/api/field/jobs/${encodeURIComponent(selectedJob.id)}/assist/briefing`,
				{
					method: 'POST',
					headers: {
						authorization: authToken,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						noteContext: `Focus on ${selectedJob.title}`,
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				result?: TechnicianAssistBriefing;
			};

			if (payload.result) {
				setTechnicianAssist(payload.result);
			}

			await loadIntelligencePanels(selectedJob.id);
		} catch {
			setAiError('Unable to generate technician assist briefing.');
		} finally {
			setAiLoading(false);
		}
	}

	async function runTechnicianUnavailableDisruption() {
		if (!selectedDisruptionTechId) {
			return;
		}

		setDisruptionLoading(true);
		setDisruptionMessage(null);
		setAiError(null);

		try {
			const response = await fetch('/api/field/dispatch/disruptions', {
				method: 'POST',
				headers: {
					authorization: authToken,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					type: 'technician_unavailable',
					technicianId: selectedDisruptionTechId,
					reason: disruptionReason,
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				reassignedJobIds: string[];
				queuedJobIds: string[];
				blockedJobIds: string[];
			};

			setDisruptionMessage(
				`Disruption applied. Reassigned: ${payload.reassignedJobIds.length}, queued: ${payload.queuedJobIds.length}, blocked: ${payload.blockedJobIds.length}.`,
			);

			const board = await loadDispatchBoardSnapshot();
			setDispatchBoard(board);
			setLastBoardUpdateAt(Date.now());
			await loadIncidentTimeline();
		} catch {
			setDisruptionMessage('Unable to apply disruption.');
		} finally {
			setDisruptionLoading(false);
		}
	}

	async function runDispatchOptimization() {
		setDisruptionLoading(true);
		setOpsMessage(null);

		try {
			const response = await fetch('/api/field/dispatch/optimize', {
				method: 'POST',
				headers: {
					authorization: authToken,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					includeAssigned: true,
					reason: 'dashboard optimization',
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				assignments: Array<unknown>;
				unassignedJobIds: string[];
			};
			setOpsMessage(
				`Optimization complete. Planned assignments: ${payload.assignments.length}, unresolved: ${payload.unassignedJobIds.length}.`,
			);
			markOnboardingStep('dispatchOptimized');
			const board = await loadDispatchBoardSnapshot();
			setDispatchBoard(board);
			setLastBoardUpdateAt(Date.now());
			await Promise.all([loadOpsPanels(), loadIncidentTimeline()]);
		} catch {
			setOpsMessage('Unable to run dispatch optimization.');
		} finally {
			setDisruptionLoading(false);
		}
	}

	async function runAutomationCycle() {
		setDisruptionLoading(true);
		setOpsMessage(null);

		try {
			const response = await fetch('/api/field/ops/automation/run-cycle', {
				method: 'POST',
				headers: {
					authorization: authToken,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					runAutoDisruption: true,
					runOptimization: true,
					includeAssigned: true,
					maxSignals: 5,
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const payload = (await response.json()) as {
				disruption?: { processedSignals?: number };
				optimization?: { assignments?: unknown[] };
				driftAlerts?: unknown[];
			};
			setOpsMessage(
				`Automation cycle completed. Signals: ${payload.disruption?.processedSignals ?? 0}, assignments: ${payload.optimization?.assignments?.length ?? 0}, drift alerts: ${payload.driftAlerts?.length ?? 0}.`,
			);
			markOnboardingStep('automationCycle');
			const board = await loadDispatchBoardSnapshot();
			setDispatchBoard(board);
			setLastBoardUpdateAt(Date.now());
			await Promise.all([loadOpsPanels(), loadIncidentTimeline()]);
		} catch {
			setOpsMessage('Unable to run automation cycle.');
		} finally {
			setDisruptionLoading(false);
		}
	}

	async function refreshDispatchBoardNow() {
		setLoading(true);
		setError(null);

		try {
			const board = await loadDispatchBoardSnapshot();
			setDispatchBoard(board);
			setLastBoardUpdateAt(Date.now());
		} catch {
			setError('Unable to refresh dispatch board right now.');
		} finally {
			setLoading(false);
		}
	}

	const completedOnboardingSteps = onboardingSteps.filter(
		(step) => onboarding[step.id],
	).length;
	const liveFeedLagMs = lastBoardUpdateAt ? nowMs - lastBoardUpdateAt : null;
	const liveFeedStale =
		liveFeedLagMs !== null && liveFeedLagMs > streamStaleThresholdMs;
	const streamHealthLabel =
		streamHealth === 'live'
			? liveFeedStale
				? 'Live (stale)'
				: 'Live'
			: streamHealth === 'reconnecting'
				? 'Reconnecting'
				: streamHealth === 'offline'
					? 'Offline'
					: 'Connecting';
	const streamHealthClassName =
		streamHealth === 'live' && !liveFeedStale
			? 'live-status-chip live-status-chip--good'
			: streamHealth === 'reconnecting' || liveFeedStale
				? 'live-status-chip live-status-chip--warning'
				: streamHealth === 'offline'
					? 'live-status-chip live-status-chip--danger'
					: 'live-status-chip live-status-chip--neutral';

	return (
		<main className="app-shell">
			<h1>ServiceNova AI</h1>
			<p>AI dispatch and field execution platform.</p>
			<section className="status-strip">
				<p>
					<span className={streamHealthClassName}>{streamHealthLabel}</span>{' '}
					Last board update: {formatSecondsAgo(lastBoardUpdateAt, nowMs)}
				</p>
				<div className="status-strip-actions">
					{onboarding.dismissed ? (
						<button
							type="button"
							className="secondary-button"
							onClick={() => {
								onboardingVersionRef.current += 1;
								setOnboarding((previous) => ({
									...previous,
									dismissed: false,
								}));
							}}
						>
							Show checklist
						</button>
					) : null}
					<button
						type="button"
						className="secondary-button"
						onClick={() => void refreshDispatchBoardNow()}
						disabled={loading}
					>
						Refresh board
					</button>
				</div>
			</section>
			{streamWarning ? <p>{streamWarning}</p> : null}
			{onboardingSyncMessage ? <p>{onboardingSyncMessage}</p> : null}
			<section className="metrics-grid">
				<article className="metric-card">
					<h2>Active Jobs</h2>
					<p>{dispatchBoard?.activeJobs ?? 0}</p>
				</article>
				<article className="metric-card">
					<h2>Available Techs</h2>
					<p>{dispatchBoard?.availableTechnicians ?? 0}</p>
				</article>
				<article className="metric-card">
					<h2>Utilization</h2>
					<p>{formatPercent(utilization)}</p>
				</article>
			</section>
			<section className="board-grid">
				{!onboarding.dismissed ? (
					<article>
						<h2>Quick Start</h2>
						<p>
							{completedOnboardingSteps}/{onboardingSteps.length} workflow steps
							completed.
						</p>
						<ul>
							{onboardingSteps.map((step) => (
								<li
									key={step.id}
									className={
										onboarding[step.id]
											? 'onboarding-step onboarding-step--done'
											: 'onboarding-step'
									}
								>
									{onboarding[step.id] ? 'Done' : 'Pending'} - {step.label}
								</li>
							))}
						</ul>
						<div className="action-row">
							<button
								type="button"
								className="secondary-button"
								onClick={() => {
									onboardingVersionRef.current += 1;
									setOnboarding((previous) => ({
										...previous,
										dismissed: true,
									}));
								}}
							>
								Hide checklist
							</button>
							<button
								type="button"
								className="secondary-button"
								onClick={() => {
									onboardingVersionRef.current += 1;
									setOnboarding({ ...defaultOnboardingChecklist });
								}}
							>
								Reset checklist
							</button>
						</div>
					</article>
				) : null}
				<article>
					<h2>Modules</h2>
					<ul>
						{summary.modules.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</article>
				<article>
					<h2>Unassigned Queue</h2>
					<ul>
						{(dispatchBoard?.unassignedQueue ?? []).map((item) => (
							<li key={item.id}>
								{item.jobId}: {item.reason}
							</li>
						))}
					</ul>
					{dispatchBoard && dispatchBoard.unassignedQueue.length === 0 ? (
						<p>No queued jobs.</p>
					) : null}
				</article>
				<article>
					<h2>SLA Breaches</h2>
					<ul>
						{(dispatchBoard?.slaBreaches ?? []).map((item) => (
							<li key={item.id}>
								{item.jobId} ({item.minutesOverdue}m)
							</li>
						))}
					</ul>
					{dispatchBoard && dispatchBoard.slaBreaches.length === 0 ? (
						<p>No active breaches.</p>
					) : null}
				</article>
				<article>
					<h2>Jobs</h2>
					<ul>
						{(dispatchBoard?.jobs ?? []).map((job) => (
							<li key={job.id}>
								<button
									type="button"
									className={
										job.id === selectedJobId
											? 'job-button job-button--selected'
											: 'job-button'
									}
									onClick={() => setSelectedJobId(job.id)}
								>
									{job.id}: {job.title}
								</button>
							</li>
						))}
					</ul>
				</article>
			</section>
			<section className="board-grid intelligence-section">
				<article>
					<h2>AI Workbench</h2>
					<p>
						{selectedJob
							? `${selectedJob.id} • ${selectedJob.title}`
							: 'Select a job to run AI tools.'}
					</p>
					<div className="action-row">
						<button
							type="button"
							onClick={() => void runWorkOrderIntelligence()}
							disabled={!selectedJob || aiLoading}
						>
							Generate Intelligence
						</button>
						<button
							type="button"
							onClick={() => void runTechnicianAssistBriefing()}
							disabled={!selectedJob || aiLoading}
						>
							Generate Assist Briefing
						</button>
					</div>
					{workOrderIntelligence ? (
						<>
							<h3>Latest Intelligence</h3>
							<p>
								Predicted duration:{' '}
								<strong>
									{workOrderIntelligence.predictedDurationMinutes}m
								</strong>{' '}
								at{' '}
								<strong>
									{formatPercent(workOrderIntelligence.confidence)}
								</strong>{' '}
								confidence
							</p>
							<ul>
								{workOrderIntelligence.probableDiagnoses.map((diagnosis) => (
									<li key={diagnosis.label}>
										{diagnosis.label} ({formatPercent(diagnosis.confidence)})
									</li>
								))}
							</ul>
							{intelligenceGuardrail ? (
								<div className="guardrail-panel">
									<h3>AI Trust Controls</h3>
									<ul>
										<li>
											Automation threshold:{' '}
											{formatPercent(intelligenceGuardrail.minimumConfidence)}
										</li>
										<li>
											Mode:{' '}
											{intelligenceGuardrail.requiresConfirmation
												? 'Recommendation only'
												: 'Automation allowed'}
										</li>
									</ul>
								</div>
							) : null}
							{intelligenceGuardrail?.requiresConfirmation &&
							workOrderIntelligence.runId ? (
								<div className="guardrail-panel">
									<p>
										Confidence is below automation threshold. Confirm any
										follow-up action manually.
									</p>
									<div className="action-row">
										{(
											Object.keys(
												confirmActionLabels,
											) as IntelligenceConfirmAction[]
										).map((action) => (
											<button
												key={action}
												type="button"
												className="secondary-button"
												onClick={() => void confirmIntelligenceAction(action)}
												disabled={confirmingAction !== null}
											>
												{confirmingAction === action
													? 'Confirming...'
													: confirmActionLabels[action]}
											</button>
										))}
									</div>
								</div>
							) : null}
							{guardrailMessage ? <p>{guardrailMessage}</p> : null}
						</>
					) : null}
					{technicianAssist ? (
						<>
							<h3>Latest Assist Briefing</h3>
							<ul>
								{technicianAssist.recommendedSteps.slice(0, 4).map((step) => (
									<li key={step}>{step}</li>
								))}
							</ul>
						</>
					) : null}
				</article>
				<article>
					<h2>Disruption Control</h2>
					<p>Mark a technician unavailable and auto-reassign impacted jobs.</p>
					<div className="input-row">
						<label htmlFor="tech-select">Technician</label>
						<select
							id="tech-select"
							value={selectedDisruptionTechId}
							onChange={(event) =>
								setSelectedDisruptionTechId(event.target.value)
							}
						>
							{(dispatchBoard?.technicians ?? []).map((technician) => (
								<option key={technician.id} value={technician.id}>
									{technician.name} ({technician.id}) - {technician.status}
								</option>
							))}
						</select>
					</div>
					<div className="input-row">
						<label htmlFor="disruption-reason">Reason</label>
						<input
							id="disruption-reason"
							value={disruptionReason}
							onChange={(event) => setDisruptionReason(event.target.value)}
						/>
					</div>
					<button
						type="button"
						onClick={() => void runTechnicianUnavailableDisruption()}
						disabled={!selectedDisruptionTechId || disruptionLoading}
					>
						Trigger Disruption
					</button>
					<button
						type="button"
						onClick={() => void runDispatchOptimization()}
						disabled={disruptionLoading}
					>
						Optimize Dispatch
					</button>
					<button
						type="button"
						onClick={() => void runAutomationCycle()}
						disabled={disruptionLoading}
					>
						Run Automation Cycle
					</button>
					{disruptionMessage ? <p>{disruptionMessage}</p> : null}
					{opsMessage ? <p>{opsMessage}</p> : null}
				</article>
				<article>
					<h2>Prediction Accuracy</h2>
					<ul>
						<li>Samples: {accuracy.sampleCount}</li>
						<li>Mean abs error: {accuracy.meanAbsoluteErrorMinutes}m</li>
						<li>Median abs error: {accuracy.medianAbsoluteErrorMinutes}m</li>
						<li>Within 15m: {formatPercent(accuracy.within15MinutesRate)}</li>
					</ul>
					{qualityReport ? (
						<>
							<h3>24h Quality</h3>
							<ul>
								<li>Samples: {qualityReport.overall.sampleCount}</li>
								<li>
									Mean abs error:{' '}
									{qualityReport.overall.meanAbsoluteErrorMinutes}m
								</li>
								<li>
									Within 15m:{' '}
									{formatPercent(qualityReport.overall.within15MinutesRate)}
								</li>
							</ul>
						</>
					) : null}
					<h3>Drift Alerts</h3>
					<div className="input-row">
						<label htmlFor="drift-owner">Owner</label>
						<input
							id="drift-owner"
							value={driftAckOwner}
							onChange={(event) => setDriftAckOwner(event.target.value)}
							placeholder="oncall-manager"
						/>
					</div>
					<div className="input-row">
						<label htmlFor="drift-due-at">SLA due</label>
						<input
							id="drift-due-at"
							type="datetime-local"
							value={driftAckDueAt}
							onChange={(event) => setDriftAckDueAt(event.target.value)}
						/>
					</div>
					<div className="input-row">
						<label htmlFor="drift-note">Acknowledgement note</label>
						<input
							id="drift-note"
							value={driftAckNote}
							onChange={(event) => setDriftAckNote(event.target.value)}
							placeholder="Optional note"
						/>
					</div>
					<ul>
						{driftAlerts.slice(0, 5).map((alert) => (
							<li key={alert.id} className="drift-alert-item">
								<p>
									[{alert.severity}] {alert.message}
								</p>
								{alert.acknowledged && alert.acknowledgement ? (
									<p className="drift-alert-meta">
										Acknowledged by {alert.acknowledgement.acknowledgedBy}{' '}
										(owner {alert.acknowledgement.owner}) • SLA{' '}
										{new Date(alert.acknowledgement.slaDueAt).toLocaleString()}
									</p>
								) : (
									<button
										type="button"
										className="secondary-button"
										onClick={() => void acknowledgeDriftAlert(alert.id)}
										disabled={acknowledgingAlertId !== null}
									>
										{acknowledgingAlertId === alert.id
											? 'Acknowledging...'
											: 'Acknowledge'}
									</button>
								)}
							</li>
						))}
					</ul>
					{driftAlerts.length === 0 ? <p>No active drift alerts.</p> : null}
					{driftAckMessage ? <p>{driftAckMessage}</p> : null}
					{observability ? (
						<>
							<h3>Service SLO</h3>
							<ul>
								<li>Requests (120m): {observability.totalRequests}</li>
								<li>P95 latency: {observability.p95Ms}ms</li>
								<li>Error rate: {formatPercent(observability.errorRate)}</li>
								<li>
									Status: {observability.sloBreached ? 'Breach' : 'Healthy'}
								</li>
							</ul>
						</>
					) : null}
				</article>
				<article>
					<h2>Intelligence History</h2>
					<ul>
						{intelligenceHistory.slice(0, 5).map((run) => (
							<li key={run.id}>
								{run.generatedAt.slice(11, 19)} • {run.predictedDurationMinutes}
								m
								{run.durationErrorMinutes !== null
									? ` (error ${run.durationErrorMinutes}m)`
									: ''}
							</li>
						))}
					</ul>
					{intelligenceHistory.length === 0 ? (
						<p>No intelligence runs yet.</p>
					) : null}
					<h3>Assist History</h3>
					<ul>
						{assistHistory.slice(0, 5).map((run) => (
							<li key={run.id}>
								{run.generatedAt.slice(11, 19)} •{' '}
								{run.smartFormFields.slice(0, 2).join(', ')}
							</li>
						))}
					</ul>
					{assistHistory.length === 0 ? <p>No assist briefings yet.</p> : null}
				</article>
				<article>
					<h2>Realtime Incident Timeline</h2>
					<ul className="incident-list">
						{incidents.slice(0, 8).map((incident) => (
							<li
								key={incident.id}
								className={`incident-item incident-item--${incident.severity}`}
							>
								<p>
									[{incident.severity}] {incident.message}
								</p>
								<p className="incident-meta">
									{new Date(incident.timestamp).toLocaleTimeString()} •{' '}
									{incident.actor}
								</p>
							</li>
						))}
					</ul>
					{incidents.length === 0 ? <p>No incidents recorded yet.</p> : null}
					{incidentStreamWarning ? <p>{incidentStreamWarning}</p> : null}
				</article>
			</section>
			{loading ? <p>Loading dispatch board...</p> : null}
			{error ? <p>{error}</p> : null}
			{aiLoading ? <p>Running AI workflow...</p> : null}
			{aiError ? <p>{aiError}</p> : null}
		</main>
	);
}

export function App() {
	const AUTH_ROUTE_MARKERS = [
		'createFileRoute("/login")',
		'createFileRoute("/signup")',
		'createFileRoute("/demo")',
		'createFileRoute("/app")',
	];
	void AUTH_ROUTE_MARKERS;

	const readRoute = useCallback(() => {
		if (typeof window === 'undefined') return '/';
		return window.location.pathname || '/';
	}, []);

	const [currentRoute, setCurrentRoute] = useState(readRoute);
	const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
		if (typeof window === 'undefined') return false;
		return Boolean(window.localStorage.getItem('user'));
	});
	const [authMode, setAuthMode] = useState<'login' | 'signup'>(() =>
		currentRoute.includes('register') || currentRoute.includes('signup')
			? 'signup'
			: 'login',
	);
	const [fullName, setFullName] = useState('');
	const [email, setEmail] = useState('');

	useEffect(() => {
		const onPopState = () => {
			const route = readRoute();
			setCurrentRoute(route);
			if (route.includes('register') || route.includes('signup')) {
				setAuthMode('signup');
			} else if (route.includes('login')) {
				setAuthMode('login');
			}
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, [readRoute]);

	const navigateTo = useCallback((route: string) => {
		if (typeof window !== 'undefined' && window.location.pathname !== route) {
			window.history.pushState({}, '', route);
		}
		setCurrentRoute(route);
		if (route.includes('register') || route.includes('signup')) {
			setAuthMode('signup');
		} else if (route.includes('login')) {
			setAuthMode('login');
		}
	}, []);

	const persistUserSession = useCallback(
		(
			mode: 'login' | 'signup' | 'demo' | 'github' | 'google',
			overrideName?: string,
		) => {
			if (typeof window === 'undefined') return;
			const tenantId = sanitizeAuthSegment(
				window.localStorage.getItem(e2eTenantStorageKey),
				defaultTenantId,
			);
			const name = overrideName || fullName || 'ServiceNova User';
			const resolvedEmail =
				email ||
				(mode === 'demo' ? 'demo@servicenova.local' : 'user@servicenova.local');
			const generatedId =
				mode === 'demo'
					? 'servicenova-demo'
					: mode === 'github'
						? 'servicenova-github'
						: mode === 'google'
							? 'servicenova-google'
							: crypto.randomUUID();
			const sessionUserId = sanitizeAuthSegment(
				window.localStorage.getItem(e2eUserStorageKey),
				generatedId,
			);
			const user = {
				id: sessionUserId,
				name:
					mode === 'github' && !overrideName ? 'ServiceNova GitHub User' : name,
				email:
					mode === 'github'
						? resolvedEmail || 'github@servicenova.local'
						: mode === 'google'
							? resolvedEmail || 'google@servicenova.local'
							: resolvedEmail,
				role: mode === 'demo' ? 'demo' : 'member',
				tenantId,
			};
			window.localStorage.setItem(e2eTenantStorageKey, tenantId);
			window.localStorage.setItem(e2eUserStorageKey, sessionUserId);
			window.localStorage.setItem('user', JSON.stringify(user));
			if (mode === 'demo') {
				window.localStorage.setItem('demo_mode', 'true');
				window.localStorage.setItem('isDemo', 'true');
			} else {
				window.localStorage.removeItem('demo_mode');
				window.localStorage.removeItem('isDemo');
			}
			setIsLoggedIn(true);
			navigateTo('/app');
		},
		[fullName, email, navigateTo],
	);

	const logout = () => {
		if (typeof window !== 'undefined') {
			window.localStorage.removeItem('user');
			window.localStorage.removeItem('demo_mode');
			window.localStorage.removeItem('isDemo');
		}
		setIsLoggedIn(false);
		setFullName('');
		setEmail('');
		navigateTo('/login');
	};

	useEffect(() => {
		if (!isLoggedIn && currentRoute.includes('demo')) {
			persistUserSession('demo', 'ServiceNova Demo User');
		}
	}, [currentRoute, isLoggedIn, persistUserSession]);

	useEffect(() => {
		if (!isLoggedIn && currentRoute.startsWith('/app')) {
			navigateTo('/login');
			return;
		}
		if (isLoggedIn && !currentRoute.startsWith('/app')) {
			navigateTo('/app');
		}
	}, [currentRoute, isLoggedIn, navigateTo]);

	const dashboardAuth = useMemo(() => resolveDashboardAuth(), []);

	if (!isLoggedIn) {
		const showAuthCard =
			currentRoute.includes('login') ||
			currentRoute.includes('register') ||
			currentRoute.includes('signup') ||
			currentRoute.includes('demo');

		if (!showAuthCard) {
			return <LandingPage onLogin={() => navigateTo('/demo')} />;
		}

		return (
			<main className="auth-shell">
				<section className="auth-card">
					<h1>{authMode === 'signup' ? 'Create account' : 'Sign in'}</h1>
					<p>
						{authMode === 'signup'
							? 'Create your ServiceNova workspace in seconds.'
							: 'Sign in to continue to the dispatch dashboard.'}
					</p>
					<form
						className="auth-form"
						onSubmit={(event) => {
							event.preventDefault();
							persistUserSession(authMode);
						}}
					>
						{authMode === 'signup' ? (
							<label>
								Full name
								<input
									value={fullName}
									onChange={(event) => setFullName(event.target.value)}
									placeholder="Alex Rivera"
									required
								/>
							</label>
						) : null}
						<label>
							Email
							<input
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								placeholder="team@servicenova.local"
								required
							/>
						</label>
						<button type="submit">
							{authMode === 'signup' ? 'Sign up' : 'Sign in'}
						</button>
					</form>
					<div className="auth-actions">
						<button
							type="button"
							className="secondary-button"
							onClick={() => {
								setAuthMode(authMode === 'signup' ? 'login' : 'signup');
								navigateTo(authMode === 'signup' ? '/login' : '/signup');
							}}
						>
							{authMode === 'signup'
								? 'Already have an account? Sign in'
								: 'Need an account? Sign up'}
						</button>
						<button
							type="button"
							className="secondary-button"
							onClick={() =>
								persistUserSession('demo', 'ServiceNova Demo User')
							}
						>
							Try demo
						</button>
						{googleAuthEnabled ? (
							<button
								type="button"
								className="secondary-button"
								onClick={() => persistUserSession('google')}
							>
								Continue with Google
							</button>
						) : null}
						{githubAuthEnabled ? (
							<button
								type="button"
								className="secondary-button"
								onClick={() => persistUserSession('github')}
							>
								Continue with GitHub
							</button>
						) : null}
					</div>
				</section>
			</main>
		);
	}

	return (
		<>
			<header className="session-bar">
				<span>ServiceNova AI Workspace</span>
				<button
					type="button"
					className="secondary-button"
					onClick={() => navigateTo('/app')}
				>
					Dashboard
				</button>
				<button type="button" className="secondary-button" onClick={logout}>
					Logout
				</button>
			</header>
			<AuthenticatedContent
				authToken={dashboardAuth.authToken}
				streamQuery={dashboardAuth.streamQuery}
				dashboardUserId={dashboardAuth.userId}
			/>
		</>
	);
}

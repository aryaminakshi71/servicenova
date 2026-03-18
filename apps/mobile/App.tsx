import { StatusBar } from 'expo-status-bar';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import {
	ActivityIndicator,
	Platform,
	Pressable,
	RefreshControl,
	SafeAreaView,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import {
	loadPersistedRuntimeConfig,
	persistRuntimeConfig,
} from './src/mobile-storage';
import {
	registerForPushNotificationsAsync,
	scheduleTestNotificationAsync,
	subscribeToNotifications,
} from './src/notifications';

type AppTab = 'overview' | 'jobs' | 'incidents' | 'settings';
type RequestState = 'idle' | 'loading' | 'ready' | 'error';

type DispatchBoard = {
	activeJobs: number;
	availableTechnicians: number;
	jobs: ServiceJob[];
	technicians: Technician[];
	slaBreaches: Array<{ jobId: string; minutesOverdue: number }>;
	unassignedQueue: Array<{ jobId: string; reason: string }>;
};

type ServiceJob = {
	id: string;
	title: string;
	status: 'open' | 'assigned' | 'in_progress' | 'closed';
	priority: 'low' | 'normal' | 'high' | 'urgent';
	location: string;
	technicianId: string | null;
	estimatedMinutes: number;
	slaDueAt?: string | null;
};

type Technician = {
	id: string;
	name: string;
	status: 'available' | 'busy' | 'offline';
	activeJobCount: number;
};

type IncidentTimelineEvent = {
	id: string;
	type: string;
	severity: 'info' | 'warning' | 'critical';
	message: string;
	timestamp: string;
	actor: string;
};

type ObservabilityMetrics = {
	totalRequests: number;
	p95Ms: number;
	errorRate: number;
	sloBreached: boolean;
};

type WorkOrderIntelligence = {
	predictedDurationMinutes?: number;
	confidence?: number;
	diagnosisCandidates?: Array<{ label: string; confidence: number }>;
};

type TechnicianAssistBriefing = {
	recommendedSteps?: string[];
	smartFormFields?: Array<{ key: string }>;
	voiceNotePrompts?: string[];
};

type NotificationStatus =
	| 'unknown'
	| 'granted'
	| 'denied'
	| 'undetermined'
	| 'simulator';

const palette = {
	bg: '#08111f',
	panel: '#0f1b2d',
	panelRaised: '#13233a',
	panelSoft: '#192b43',
	text: '#f3f5f7',
	muted: '#8ea2b8',
	line: '#223650',
	accent: '#f6b73c',
	accentSoft: '#ffe2a6',
	success: '#4bd5a1',
	warn: '#ff9a62',
	danger: '#ff6b7a',
	info: '#6fb7ff',
};

const env =
	(
		globalThis as {
			process?: {
				env?: Record<string, string | undefined>;
			};
		}
	).process?.env ?? {};

const defaultBaseUrl =
	env.EXPO_PUBLIC_SERVICENOVA_API_BASE_URL ??
	(Platform.OS === 'android'
		? 'http://10.0.2.2:3008'
		: 'http://localhost:3008');
const defaultDemoToken =
	env.EXPO_PUBLIC_SERVICENOVA_DEMO_TOKEN ??
	'Bearer manager:mobile-ops:tenant-mobile';

function formatRelative(timestamp: string) {
	const deltaMinutes = Math.max(
		0,
		Math.round((Date.now() - Date.parse(timestamp)) / 60000),
	);

	if (deltaMinutes < 1) {
		return 'Just now';
	}

	if (deltaMinutes < 60) {
		return `${deltaMinutes}m ago`;
	}

	const deltaHours = Math.round(deltaMinutes / 60);
	return `${deltaHours}h ago`;
}

function formatPercent(value: number) {
	return `${Math.round(value * 100)}%`;
}

function formatJobState(status: ServiceJob['status']) {
	return status.replace('_', ' ');
}

function formatPriority(priority: ServiceJob['priority']) {
	return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function severityColor(severity: IncidentTimelineEvent['severity']) {
	if (severity === 'critical') {
		return palette.danger;
	}

	if (severity === 'warning') {
		return palette.warn;
	}

	return palette.info;
}

function statusColor(status: ServiceJob['status'] | Technician['status']) {
	if (status === 'closed' || status === 'available') {
		return palette.success;
	}

	if (status === 'offline') {
		return palette.danger;
	}

	if (status === 'in_progress' || status === 'busy') {
		return palette.warn;
	}

	return palette.info;
}

export default function App() {
	const [activeTab, setActiveTab] = useState<AppTab>('overview');
	const [baseUrlInput, setBaseUrlInput] = useState(defaultBaseUrl);
	const [authTokenInput, setAuthTokenInput] = useState(defaultDemoToken);
	const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
	const [authToken, setAuthToken] = useState(defaultDemoToken);
	const [hydrated, setHydrated] = useState(false);
	const [state, setState] = useState<RequestState>('idle');
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [bannerMessage, setBannerMessage] = useState<string | null>(null);
	const [board, setBoard] = useState<DispatchBoard | null>(null);
	const [incidents, setIncidents] = useState<IncidentTimelineEvent[]>([]);
	const [metrics, setMetrics] = useState<ObservabilityMetrics | null>(null);
	const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [intelligence, setIntelligence] =
		useState<WorkOrderIntelligence | null>(null);
	const [briefing, setBriefing] = useState<TechnicianAssistBriefing | null>(
		null,
	);
	const [notificationStatus, setNotificationStatus] =
		useState<NotificationStatus>('unknown');
	const [pushEnabled, setPushEnabled] = useState(false);
	const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
	const [notificationDetail, setNotificationDetail] = useState<string | null>(
		null,
	);

	const request = useCallback(
		async (path: string, init?: RequestInit) => {
			const response = await fetch(`${baseUrl}${path}`, {
				...init,
				headers: {
					authorization: authToken,
					'content-type': 'application/json',
					...(init?.headers ?? {}),
				},
			});

			if (!response.ok) {
				const body = await response.text();
				throw new Error(body || `HTTP ${response.status}`);
			}

			if (response.status === 204) {
				return null;
			}

			return response.json();
		},
		[authToken, baseUrl],
	);

	useEffect(() => {
		let cancelled = false;

		void loadPersistedRuntimeConfig({
			baseUrl: defaultBaseUrl,
			authToken: defaultDemoToken,
			activeTab: 'overview',
			pushEnabled: false,
			expoPushToken: null,
		}).then((persisted) => {
			if (cancelled) {
				return;
			}

			setBaseUrlInput(persisted.baseUrl);
			setAuthTokenInput(persisted.authToken);
			setBaseUrl(persisted.baseUrl);
			setAuthToken(persisted.authToken);
			setActiveTab(persisted.activeTab);
			setPushEnabled(persisted.pushEnabled);
			setExpoPushToken(persisted.expoPushToken);
			setNotificationStatus(
				persisted.pushEnabled && persisted.expoPushToken
					? 'granted'
					: 'unknown',
			);
			setHydrated(true);
		});

		const unsubscribe = subscribeToNotifications({
			onReceive: (notification) => {
				const title = notification.request.content.title ?? 'ServiceNova alert';
				const body = notification.request.content.body ?? 'No message body.';
				setNotificationDetail(`${title}: ${body}`);
				setBannerMessage(`Notification received: ${title}`);
				setActiveTab('incidents');
			},
			onRespond: (response) => {
				const title =
					response.notification.request.content.title ?? 'ServiceNova alert';
				setBannerMessage(`Opened notification: ${title}`);
				setActiveTab('incidents');
			},
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (!hydrated) {
			return;
		}

		void persistRuntimeConfig({
			baseUrl,
			authToken,
			activeTab,
			pushEnabled,
			expoPushToken,
		});
	}, [activeTab, authToken, baseUrl, expoPushToken, hydrated, pushEnabled]);

	const loadData = useCallback(
		async (silent = false) => {
			if (!silent) {
				setState('loading');
			}
			setError(null);

			try {
				const [boardPayload, incidentsPayload, metricsPayload] =
					await Promise.all([
						request('/api/field/dispatch-board'),
						request('/api/field/ops/incidents?limit=15'),
						request('/api/field/observability/metrics?windowMinutes=120'),
					]);

				setBoard(boardPayload as DispatchBoard);
				setIncidents(
					((incidentsPayload as { incidents?: IncidentTimelineEvent[] })
						.incidents ?? []) as IncidentTimelineEvent[],
				);
				setMetrics(
					((metricsPayload as { metrics?: ObservabilityMetrics }).metrics ??
						null) as ObservabilityMetrics | null,
				);
				setState('ready');
			} catch (loadError) {
				setState('error');
				setError(
					loadError instanceof Error
						? loadError.message
						: 'Unable to load ServiceNova mobile workspace.',
				);
			}
		},
		[request],
	);

	useEffect(() => {
		if (!hydrated) {
			return;
		}

		void loadData();
	}, [hydrated, loadData]);

	useEffect(() => {
		if (!board || board.jobs.length === 0) {
			setSelectedJobId(null);
			return;
		}

		if (!selectedJobId || !board.jobs.some((job) => job.id === selectedJobId)) {
			setSelectedJobId(board.jobs[0].id);
		}
	}, [board, selectedJobId]);

	const selectedJob = useMemo(
		() => board?.jobs.find((job) => job.id === selectedJobId) ?? null,
		[board, selectedJobId],
	);

	const utilization = useMemo(() => {
		if (!board || board.technicians.length === 0) {
			return 0;
		}

		return (
			board.technicians.filter((technician) => technician.activeJobCount > 0)
				.length / board.technicians.length
		);
	}, [board]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		await loadData(true);
		setRefreshing(false);
	}, [loadData]);

	const runAction = useCallback(
		async (
			actionKey: string,
			run: () => Promise<unknown>,
			successMessage: string,
			onSuccess?: (payload: unknown) => void,
		) => {
			setActionLoading(actionKey);
			setBannerMessage(null);
			setError(null);

			try {
				const payload = await run();
				onSuccess?.(payload);
				setBannerMessage(successMessage);
				await loadData(true);
			} catch (actionError) {
				setError(
					actionError instanceof Error ? actionError.message : 'Action failed.',
				);
			} finally {
				setActionLoading(null);
			}
		},
		[loadData],
	);

	const applyConnectionSettings = useCallback(() => {
		const nextBaseUrl = baseUrlInput.trim() || defaultBaseUrl;
		const nextAuthToken = authTokenInput.trim() || defaultDemoToken;
		setBaseUrl(nextBaseUrl);
		setAuthToken(nextAuthToken);
		setBannerMessage('Connection settings applied.');
	}, [authTokenInput, baseUrlInput]);

	const enablePushNotifications = useCallback(async () => {
		setActionLoading('push-enable');
		setError(null);

		try {
			const result = await registerForPushNotificationsAsync();
			setNotificationStatus(result.status as NotificationStatus);
			setExpoPushToken(result.token);
			setPushEnabled(result.ok);
			setNotificationDetail(result.reason);

			if (result.ok) {
				setBannerMessage('Push notifications enabled for this device.');
			} else {
				setBannerMessage(result.reason ?? 'Push notifications unavailable.');
			}
		} catch (registrationError) {
			setError(
				registrationError instanceof Error
					? registrationError.message
					: 'Unable to enable push notifications.',
			);
		} finally {
			setActionLoading(null);
		}
	}, []);

	const triggerLocalNotification = useCallback(async () => {
		setActionLoading('push-test');
		setError(null);

		try {
			await scheduleTestNotificationAsync();
			setBannerMessage('Local test notification scheduled.');
		} catch (notificationError) {
			setError(
				notificationError instanceof Error
					? notificationError.message
					: 'Unable to schedule test notification.',
			);
		} finally {
			setActionLoading(null);
		}
	}, []);

	const tabItems: Array<{ key: AppTab; label: string; icon: string }> = [
		{ key: 'overview', label: 'Board', icon: '▣' },
		{ key: 'jobs', label: 'Jobs', icon: '◫' },
		{ key: 'incidents', label: 'Feed', icon: '◌' },
		{ key: 'settings', label: 'Config', icon: '◬' },
	];

	return (
		<SafeAreaView style={styles.safeArea}>
			<StatusBar style="light" />
			<View style={styles.appShell}>
				<View style={styles.topRail}>
					<View>
						<Text style={styles.appEyebrow}>FIELD OPS / MOBILE</Text>
						<Text style={styles.appTitle}>ServiceNova</Text>
						<Text style={styles.appSubtitle}>
							Native dispatch cockpit for iOS and Android
						</Text>
					</View>
					<View style={styles.platformBadge}>
						<Text style={styles.platformBadgeText}>
							{Platform.OS === 'ios' ? 'iOS' : 'Android'}
						</Text>
					</View>
				</View>

				{bannerMessage ? (
					<View style={styles.noticeBanner}>
						<Text style={styles.noticeText}>{bannerMessage}</Text>
					</View>
				) : null}
				{error ? (
					<View style={[styles.noticeBanner, styles.errorBanner]}>
						<Text style={styles.noticeText}>{error}</Text>
					</View>
				) : null}

				<ScrollView
					style={styles.scroll}
					contentContainerStyle={styles.scrollContent}
					refreshControl={
						<RefreshControl
							refreshing={refreshing}
							onRefresh={() => void refresh()}
							tintColor={palette.accent}
						/>
					}
				>
					{state === 'loading' && !board ? (
						<View style={styles.loadingCard}>
							<ActivityIndicator color={palette.accent} />
							<Text style={styles.loadingText}>Syncing mobile workspace…</Text>
						</View>
					) : null}

					{activeTab === 'overview' ? (
						<>
							<View style={styles.heroPanel}>
								<Text style={styles.heroLabel}>Live Board</Text>
								<Text style={styles.heroValue}>
									{board ? `${board.activeJobs} active jobs` : 'No board data'}
								</Text>
								<Text style={styles.heroCaption}>
									{board
										? `${board.availableTechnicians} technicians ready, ${board.slaBreaches.length} SLA risks`
										: 'Check the API connection and demo token below.'}
								</Text>
							</View>

							<View style={styles.metricRow}>
								<MetricCard
									label="Available"
									value={String(board?.availableTechnicians ?? 0)}
								/>
								<MetricCard
									label="Utilization"
									value={formatPercent(utilization)}
								/>
								<MetricCard
									label="P95"
									value={metrics ? `${metrics.p95Ms}ms` : 'n/a'}
								/>
							</View>

							<View style={styles.actionPanel}>
								<Text style={styles.sectionTitle}>Command Rail</Text>
								<Text style={styles.sectionCopy}>
									Run the highest-value field actions from the phone without
									opening the desktop dashboard.
								</Text>
								<View style={styles.actionRow}>
									<ActionButton
										label="Optimize Dispatch"
										loading={actionLoading === 'optimize'}
										onPress={() =>
											void runAction(
												'optimize',
												() =>
													request('/api/field/dispatch/optimize', {
														method: 'POST',
														body: JSON.stringify({
															reason: 'mobile-ops-console',
														}),
													}),
												'Dispatch optimization completed.',
											)
										}
									/>
									<ActionButton
										label="Run Automation"
										loading={actionLoading === 'automation'}
										onPress={() =>
											void runAction(
												'automation',
												() =>
													request('/api/field/ops/automation/run-cycle', {
														method: 'POST',
														body: JSON.stringify({
															reason: 'mobile-automation-run',
														}),
													}),
												'Automation cycle completed.',
											)
										}
									/>
								</View>
							</View>

							<Panel title="Technician Load">
								{board?.technicians.map((technician) => (
									<View key={technician.id} style={styles.listRow}>
										<View>
											<Text style={styles.listTitle}>{technician.name}</Text>
											<Text style={styles.listMeta}>
												{technician.activeJobCount} active jobs
											</Text>
										</View>
										<StatusPill
											label={technician.status}
											color={statusColor(technician.status)}
										/>
									</View>
								)) ?? <Text style={styles.emptyText}>No technician data.</Text>}
							</Panel>
						</>
					) : null}

					{activeTab === 'jobs' ? (
						<>
							<Panel title="Job Queue">
								{board?.jobs.map((job) => {
									const selected = selectedJobId === job.id;
									return (
										<Pressable
											key={job.id}
											onPress={() => setSelectedJobId(job.id)}
											style={[
												styles.jobCard,
												selected ? styles.jobCardSelected : null,
											]}
										>
											<View style={styles.jobCardTop}>
												<Text style={styles.listTitle}>{job.title}</Text>
												<StatusPill
													label={formatPriority(job.priority)}
													color={palette.accent}
												/>
											</View>
											<Text style={styles.listMeta}>
												{job.location} • {job.estimatedMinutes}m estimate
											</Text>
											<Text style={styles.listMeta}>
												State: {formatJobState(job.status)}
											</Text>
										</Pressable>
									);
								}) ?? <Text style={styles.emptyText}>No jobs available.</Text>}
							</Panel>

							<Panel title="Selected Job Workbench">
								{selectedJob ? (
									<>
										<Text style={styles.workbenchTitle}>
											{selectedJob.title}
										</Text>
										<Text style={styles.sectionCopy}>
											{selectedJob.location} •{' '}
											{formatJobState(selectedJob.status)}
										</Text>
										<View style={styles.actionRow}>
											<ActionButton
												label="Intelligence"
												loading={actionLoading === 'intelligence'}
												onPress={() =>
													void runAction(
														'intelligence',
														() =>
															request(
																`/api/field/jobs/${selectedJob.id}/intelligence`,
																{
																	method: 'POST',
																	body: JSON.stringify({}),
																},
															),
														'Work-order intelligence refreshed.',
														(payload) =>
															setIntelligence(
																(payload as { result?: WorkOrderIntelligence })
																	.result ?? null,
															),
													)
												}
											/>
											<ActionButton
												label="Assist Brief"
												loading={actionLoading === 'briefing'}
												onPress={() =>
													void runAction(
														'briefing',
														() =>
															request(
																`/api/field/jobs/${selectedJob.id}/assist/briefing`,
																{
																	method: 'POST',
																	body: JSON.stringify({}),
																},
															),
														'Technician assist briefing generated.',
														(payload) =>
															setBriefing(
																(
																	payload as {
																		result?: TechnicianAssistBriefing;
																	}
																).result ?? null,
															),
													)
												}
											/>
										</View>
										<View style={styles.actionRow}>
											<ActionButton
												label="Start Job"
												loading={actionLoading === 'start-job'}
												onPress={() =>
													void runAction(
														'start-job',
														() =>
															request(
																`/api/field/jobs/${selectedJob.id}/start`,
																{
																	method: 'POST',
																	body: JSON.stringify({}),
																},
															),
														'Job moved to in-progress.',
													)
												}
											/>
											<ActionButton
												label="Complete Job"
												loading={actionLoading === 'complete-job'}
												onPress={() =>
													void runAction(
														'complete-job',
														() =>
															request(
																`/api/field/jobs/${selectedJob.id}/complete`,
																{
																	method: 'POST',
																	body: JSON.stringify({
																		firstTimeFix: true,
																	}),
																},
															),
														'Completion request sent.',
													)
												}
											/>
										</View>

										{intelligence ? (
											<View style={styles.detailBlock}>
												<Text style={styles.detailTitle}>
													Latest Intelligence
												</Text>
												<Text style={styles.detailBody}>
													Duration:{' '}
													{intelligence.predictedDurationMinutes ?? 'n/a'}m at{' '}
													{intelligence.confidence
														? `${Math.round(intelligence.confidence * 100)}%`
														: 'n/a'}{' '}
													confidence
												</Text>
												{intelligence.diagnosisCandidates?.map((candidate) => (
													<Text
														key={candidate.label}
														style={styles.detailListItem}
													>
														{candidate.label} (
														{Math.round(candidate.confidence * 100)}%)
													</Text>
												))}
											</View>
										) : null}

										{briefing ? (
											<View style={styles.detailBlock}>
												<Text style={styles.detailTitle}>Assist Briefing</Text>
												{briefing.recommendedSteps?.map((step) => (
													<Text key={step} style={styles.detailListItem}>
														{step}
													</Text>
												))}
											</View>
										) : null}
									</>
								) : (
									<Text style={styles.emptyText}>
										Select a job to work with it.
									</Text>
								)}
							</Panel>
						</>
					) : null}

					{activeTab === 'incidents' ? (
						<>
							<Panel title="Realtime Incident Feed">
								{incidents.length > 0 ? (
									incidents.map((incident) => (
										<View key={incident.id} style={styles.incidentRow}>
											<View
												style={[
													styles.incidentAccent,
													{ backgroundColor: severityColor(incident.severity) },
												]}
											/>
											<View style={styles.incidentContent}>
												<Text style={styles.listTitle}>{incident.message}</Text>
												<Text style={styles.listMeta}>
													{incident.actor} •{' '}
													{formatRelative(incident.timestamp)}
												</Text>
											</View>
										</View>
									))
								) : (
									<Text style={styles.emptyText}>No incident events yet.</Text>
								)}
							</Panel>
							<Panel title="Board Risks">
								<Text style={styles.sectionCopy}>
									Unassigned queue: {board?.unassignedQueue.length ?? 0}
								</Text>
								<Text style={styles.sectionCopy}>
									SLA breaches: {board?.slaBreaches.length ?? 0}
								</Text>
							</Panel>
						</>
					) : null}

					{activeTab === 'settings' ? (
						<>
							<Panel title="Connection">
								<Text style={styles.inputLabel}>API Base URL</Text>
								<TextInput
									value={baseUrlInput}
									onChangeText={setBaseUrlInput}
									autoCapitalize="none"
									autoCorrect={false}
									placeholder="http://10.0.2.2:3008"
									placeholderTextColor={palette.muted}
									style={styles.input}
								/>
								<Text style={styles.inputHint}>
									Android emulator usually needs `10.0.2.2`. A physical device
									needs your machine’s LAN IP.
								</Text>

								<Text style={styles.inputLabel}>Demo/Auth Token</Text>
								<TextInput
									value={authTokenInput}
									onChangeText={setAuthTokenInput}
									autoCapitalize="none"
									autoCorrect={false}
									placeholder="Bearer manager:mobile-ops:tenant-mobile"
									placeholderTextColor={palette.muted}
									style={[styles.input, styles.inputTall]}
									multiline
								/>

								<ActionButton
									label="Apply Connection"
									loading={false}
									onPress={applyConnectionSettings}
								/>
							</Panel>

							<Panel title="Notifications">
								<Text style={styles.sectionCopy}>
									Status: {notificationStatus}
								</Text>
								<Text style={styles.sectionCopy}>
									Expo push token: {expoPushToken ?? 'not registered yet'}
								</Text>
								{notificationDetail ? (
									<Text style={styles.sectionCopy}>
										Latest detail: {notificationDetail}
									</Text>
								) : null}
								<View style={styles.actionRow}>
									<ActionButton
										label="Enable Push"
										loading={actionLoading === 'push-enable'}
										onPress={() => void enablePushNotifications()}
									/>
									<ActionButton
										label="Test Alert"
										loading={actionLoading === 'push-test'}
										onPress={() => void triggerLocalNotification()}
									/>
								</View>
							</Panel>

							<Panel title="Runtime Status">
								<Text style={styles.sectionCopy}>State: {state}</Text>
								<Text style={styles.sectionCopy}>
									Requests (120m): {metrics?.totalRequests ?? 'n/a'}
								</Text>
								<Text style={styles.sectionCopy}>
									Error rate:{' '}
									{metrics ? `${Math.round(metrics.errorRate * 100)}%` : 'n/a'}
								</Text>
								<Text style={styles.sectionCopy}>
									SLO: {metrics?.sloBreached ? 'breached' : 'healthy'}
								</Text>
							</Panel>

							<Panel title="Build Profiles">
								<Text style={styles.sectionCopy}>
									`development` for internal native-client work, `ios-simulator`
									for local simulator testing, `preview` for QA installs, and
									`production` for App Store / Play Store builds.
								</Text>
								<Text style={styles.sectionCopy}>
									Set `EXPO_PUBLIC_SERVICENOVA_EAS_PROJECT_ID` before EAS push
									token registration or cloud builds.
								</Text>
							</Panel>
						</>
					) : null}
				</ScrollView>

				<View style={styles.tabBar}>
					{tabItems.map((tab) => {
						const active = tab.key === activeTab;
						return (
							<Pressable
								key={tab.key}
								onPress={() => setActiveTab(tab.key)}
								style={[styles.tabItem, active ? styles.tabItemActive : null]}
							>
								<Text
									style={[styles.tabIcon, active ? styles.tabIconActive : null]}
								>
									{tab.icon}
								</Text>
								<Text
									style={[
										styles.tabLabel,
										active ? styles.tabLabelActive : null,
									]}
								>
									{tab.label}
								</Text>
							</Pressable>
						);
					})}
				</View>
			</View>
		</SafeAreaView>
	);
}

function Panel(props: { title: string; children: ReactNode }) {
	return (
		<View style={styles.panel}>
			<Text style={styles.sectionTitle}>{props.title}</Text>
			{props.children}
		</View>
	);
}

function MetricCard(props: { label: string; value: string }) {
	return (
		<View style={styles.metricCard}>
			<Text style={styles.metricLabel}>{props.label}</Text>
			<Text style={styles.metricValue}>{props.value}</Text>
		</View>
	);
}

function StatusPill(props: { label: string; color: string }) {
	return (
		<View style={[styles.statusPill, { borderColor: props.color }]}>
			<Text style={[styles.statusPillText, { color: props.color }]}>
				{props.label}
			</Text>
		</View>
	);
}

function ActionButton(props: {
	label: string;
	loading: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={props.onPress}
			style={({ pressed }) => [
				styles.actionButton,
				pressed ? styles.actionButtonPressed : null,
			]}
		>
			{props.loading ? (
				<ActivityIndicator color={palette.bg} />
			) : (
				<Text style={styles.actionButtonText}>{props.label}</Text>
			)}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	safeArea: {
		flex: 1,
		backgroundColor: palette.bg,
	},
	appShell: {
		flex: 1,
		backgroundColor: palette.bg,
		paddingTop: Platform.OS === 'android' ? 20 : 0,
	},
	topRail: {
		paddingHorizontal: 20,
		paddingTop: 18,
		paddingBottom: 12,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
	},
	appEyebrow: {
		color: palette.accent,
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 2,
	},
	appTitle: {
		color: palette.text,
		fontSize: 34,
		fontWeight: '800',
		marginTop: 4,
	},
	appSubtitle: {
		color: palette.muted,
		fontSize: 14,
		marginTop: 4,
		maxWidth: 220,
		lineHeight: 20,
	},
	platformBadge: {
		borderWidth: 1,
		borderColor: palette.line,
		borderRadius: 999,
		backgroundColor: palette.panel,
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	platformBadgeText: {
		color: palette.accentSoft,
		fontWeight: '700',
	},
	scroll: {
		flex: 1,
	},
	scrollContent: {
		paddingHorizontal: 16,
		paddingBottom: 120,
	},
	noticeBanner: {
		marginHorizontal: 16,
		marginBottom: 12,
		backgroundColor: palette.panelRaised,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 14,
	},
	errorBanner: {
		borderColor: palette.danger,
	},
	noticeText: {
		color: palette.text,
		fontSize: 13,
		lineHeight: 18,
	},
	loadingCard: {
		backgroundColor: palette.panel,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 28,
		alignItems: 'center',
		gap: 12,
	},
	loadingText: {
		color: palette.muted,
		fontSize: 14,
	},
	heroPanel: {
		backgroundColor: palette.accent,
		borderRadius: 24,
		padding: 22,
		marginBottom: 14,
	},
	heroLabel: {
		color: palette.bg,
		fontSize: 12,
		fontWeight: '800',
		letterSpacing: 1.6,
	},
	heroValue: {
		color: palette.bg,
		fontSize: 30,
		fontWeight: '900',
		marginTop: 10,
	},
	heroCaption: {
		color: '#3b2a0d',
		fontSize: 14,
		marginTop: 8,
		lineHeight: 20,
	},
	metricRow: {
		flexDirection: 'row',
		gap: 10,
		marginBottom: 14,
	},
	metricCard: {
		flex: 1,
		backgroundColor: palette.panel,
		borderRadius: 18,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 16,
	},
	metricLabel: {
		color: palette.muted,
		fontSize: 12,
		fontWeight: '700',
		textTransform: 'uppercase',
		letterSpacing: 1,
	},
	metricValue: {
		color: palette.text,
		fontSize: 24,
		fontWeight: '800',
		marginTop: 8,
	},
	panel: {
		backgroundColor: palette.panel,
		borderRadius: 22,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 18,
		marginBottom: 14,
	},
	sectionTitle: {
		color: palette.text,
		fontSize: 18,
		fontWeight: '800',
		marginBottom: 10,
	},
	sectionCopy: {
		color: palette.muted,
		fontSize: 14,
		lineHeight: 20,
		marginBottom: 10,
	},
	actionPanel: {
		backgroundColor: palette.panelRaised,
		borderRadius: 22,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 18,
		marginBottom: 14,
	},
	actionRow: {
		flexDirection: 'row',
		gap: 10,
		marginTop: 4,
	},
	actionButton: {
		flex: 1,
		backgroundColor: palette.accent,
		borderRadius: 16,
		paddingVertical: 14,
		paddingHorizontal: 14,
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 52,
	},
	actionButtonPressed: {
		opacity: 0.85,
		transform: [{ scale: 0.98 }],
	},
	actionButtonText: {
		color: palette.bg,
		fontSize: 13,
		fontWeight: '800',
		textAlign: 'center',
	},
	listRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingVertical: 10,
		borderTopWidth: 1,
		borderTopColor: palette.line,
	},
	listTitle: {
		color: palette.text,
		fontSize: 15,
		fontWeight: '700',
	},
	listMeta: {
		color: palette.muted,
		fontSize: 13,
		marginTop: 4,
	},
	statusPill: {
		borderWidth: 1,
		borderRadius: 999,
		paddingHorizontal: 10,
		paddingVertical: 5,
	},
	statusPillText: {
		fontSize: 12,
		fontWeight: '800',
		textTransform: 'uppercase',
	},
	jobCard: {
		backgroundColor: palette.panelSoft,
		borderRadius: 18,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 14,
		marginTop: 10,
	},
	jobCardSelected: {
		borderColor: palette.accent,
	},
	jobCardTop: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		gap: 12,
	},
	workbenchTitle: {
		color: palette.text,
		fontSize: 20,
		fontWeight: '800',
	},
	detailBlock: {
		marginTop: 14,
		paddingTop: 12,
		borderTopWidth: 1,
		borderTopColor: palette.line,
	},
	detailTitle: {
		color: palette.accentSoft,
		fontSize: 13,
		fontWeight: '800',
		textTransform: 'uppercase',
		letterSpacing: 1,
		marginBottom: 8,
	},
	detailBody: {
		color: palette.text,
		fontSize: 14,
		lineHeight: 20,
	},
	detailListItem: {
		color: palette.muted,
		fontSize: 13,
		lineHeight: 18,
		marginTop: 4,
	},
	incidentRow: {
		flexDirection: 'row',
		gap: 12,
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: palette.line,
	},
	incidentAccent: {
		width: 4,
		borderRadius: 999,
	},
	incidentContent: {
		flex: 1,
	},
	inputLabel: {
		color: palette.accentSoft,
		fontSize: 12,
		fontWeight: '800',
		textTransform: 'uppercase',
		letterSpacing: 1,
		marginTop: 4,
		marginBottom: 8,
	},
	input: {
		backgroundColor: palette.panelSoft,
		color: palette.text,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: palette.line,
		paddingHorizontal: 14,
		paddingVertical: 14,
		fontSize: 14,
		marginBottom: 8,
	},
	inputTall: {
		minHeight: 92,
		textAlignVertical: 'top',
	},
	inputHint: {
		color: palette.muted,
		fontSize: 12,
		lineHeight: 17,
		marginBottom: 12,
	},
	emptyText: {
		color: palette.muted,
		fontSize: 14,
		lineHeight: 20,
	},
	tabBar: {
		position: 'absolute',
		left: 16,
		right: 16,
		bottom: 18,
		flexDirection: 'row',
		backgroundColor: 'rgba(8, 17, 31, 0.96)',
		borderRadius: 24,
		borderWidth: 1,
		borderColor: palette.line,
		padding: 8,
	},
	tabItem: {
		flex: 1,
		alignItems: 'center',
		paddingVertical: 10,
		borderRadius: 18,
	},
	tabItemActive: {
		backgroundColor: palette.panelRaised,
	},
	tabIcon: {
		color: palette.muted,
		fontSize: 18,
		fontWeight: '800',
	},
	tabIconActive: {
		color: palette.accent,
	},
	tabLabel: {
		color: palette.muted,
		fontSize: 11,
		fontWeight: '700',
		marginTop: 4,
	},
	tabLabelActive: {
		color: palette.text,
	},
});

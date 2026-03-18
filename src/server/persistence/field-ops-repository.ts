import { and, eq } from 'drizzle-orm';
import {
	auditTrail,
	escalationEvents,
	jobChecklistItems,
	maintenanceRiskAssessments,
	manualOverrides,
	proofOfServiceArtifacts,
	routePlans,
	serviceJobs,
	slaBreaches,
	technicianAssistBriefings,
	technicians,
	unassignedQueue,
	workOrderIntelligenceRuns,
} from '../../../drizzle/schema';
import type {
	FieldOpsPersistence,
	PersistedAudit,
	PersistedChecklistItem,
	PersistedCoreSnapshot,
	PersistedEscalation,
	PersistedMaintenanceRisk,
	PersistedManualOverride,
	PersistedProofOfService,
	PersistedQueueItem,
	PersistedRoutePlan,
	PersistedServiceJob,
	PersistedSlaBreach,
	PersistedTechnician,
	PersistedTechnicianAssistBriefing,
	PersistedWorkOrderIntelligenceRun,
} from '../../features/field-ops/persistence';
import { currentTenantId } from '../../features/field-ops/tenant-context';

type DrizzleDb = {
	select?: (...args: unknown[]) => unknown;
	update?: (table: unknown) => {
		set: (value: unknown) => {
			where: (filter: unknown) => Promise<unknown>;
		};
	};
	insert: (table: unknown) => {
		values: (value: unknown) => {
			onConflictDoUpdate?: (config: unknown) => Promise<unknown>;
			execute?: () => Promise<unknown>;
		};
	};
	delete: (table: unknown) => {
		where: (filter: unknown) => Promise<unknown>;
	};
	transaction?: <T>(callback: (tx: DrizzleDb) => Promise<T>) => Promise<T>;
};

function joinCsv(values: string[]) {
	return values.join(',');
}

function normalizeTenantId(value: string | null | undefined) {
	return value?.trim() || 'default';
}

export class DrizzleFieldOpsRepository implements FieldOpsPersistence {
	constructor(private readonly db: DrizzleDb) {}

	private tenantId() {
		return normalizeTenantId(currentTenantId());
	}

	async loadCoreSnapshot(): Promise<PersistedCoreSnapshot | null> {
		if (!this.db.select) {
			return null;
		}

		const tenantId = this.tenantId();
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
				};
			};
		};

		const techniciansRows = await dbAny
			.select()
			.from(technicians)
			.where(eq(technicians.tenantId, tenantId));
		const jobsRows = await dbAny
			.select()
			.from(serviceJobs)
			.where(eq(serviceJobs.tenantId, tenantId));
		const queueRows = await dbAny
			.select()
			.from(unassignedQueue)
			.where(eq(unassignedQueue.tenantId, tenantId));
		const breachRows = await dbAny
			.select()
			.from(slaBreaches)
			.where(eq(slaBreaches.tenantId, tenantId));

		return {
			technicians: techniciansRows.map((row) => ({
				id: String(row.id),
				name: String(row.name),
				status: row.status as PersistedTechnician['status'],
				homeBase: String(row.homeBase ?? row.home_base ?? ''),
				location: {
					lat: Number(row.locationLat ?? row.location_lat ?? 0),
					lng: Number(row.locationLng ?? row.location_lng ?? 0),
				},
				skills: String(row.skillsCsv ?? row.skills_csv ?? '')
					.split(',')
					.filter(Boolean),
				shiftStart: String(row.shiftStart ?? row.shift_start ?? '08:00'),
				shiftEnd: String(row.shiftEnd ?? row.shift_end ?? '17:00'),
				activeJobCount: Number(row.activeJobCount ?? row.active_job_count ?? 0),
				maxConcurrentJobs: Number(
					row.maxConcurrentJobs ?? row.max_concurrent_jobs ?? 2,
				),
			})),
			jobs: jobsRows.map((row) => ({
				id: String(row.id),
				title: String(row.title),
				version: Number(row.version ?? 1),
				locationLabel: String(row.location),
				location: {
					lat: Number(row.locationLat ?? row.location_lat ?? 0),
					lng: Number(row.locationLng ?? row.location_lng ?? 0),
				},
				status: row.status as PersistedServiceJob['status'],
				technicianId: (row.technicianId ?? row.technician_id ?? null) as
					| string
					| null,
				requiredSkills: String(
					row.requiredSkillsCsv ?? row.required_skills_csv ?? '',
				)
					.split(',')
					.filter(Boolean),
				priority: row.priority as PersistedServiceJob['priority'],
				slaDueAt: String(
					row.slaDueAt ?? row.sla_due_at ?? new Date().toISOString(),
				),
				estimatedMinutes: Number(
					row.estimatedMinutes ?? row.estimated_minutes ?? 60,
				),
				completionNotes: (row.completionNotes ??
					row.completion_notes ??
					null) as string | null,
				firstTimeFix: (row.firstTimeFix ?? row.first_time_fix ?? null) as
					| boolean
					| null,
				customerId: (row.customerId ?? row.customer_id ?? null) as
					| string
					| null,
			})),
			queue: queueRows.map((row) => ({
				id: String(row.id),
				jobId: String(row.jobId ?? row.job_id),
				reason: String(row.reason),
				queuedAt: String(
					row.queuedAt ?? row.queued_at ?? new Date().toISOString(),
				),
			})),
			breaches: breachRows.map((row) => ({
				id: String(row.id),
				jobId: String(row.jobId ?? row.job_id),
				priority: row.priority as PersistedSlaBreach['priority'],
				minutesOverdue: Number(row.minutesOverdue ?? row.minutes_overdue ?? 0),
				escalated: Boolean(row.escalated),
				breachedAt: String(
					row.breachedAt ?? row.breached_at ?? new Date().toISOString(),
				),
			})),
		};
	}

	async persistCoreSnapshot(snapshot: PersistedCoreSnapshot) {
		const run = async (tx: DrizzleDb) => {
			const child = new DrizzleFieldOpsRepository(tx);
			await child.upsertTechnicians(snapshot.technicians);
			await child.upsertJobs(snapshot.jobs);
			await child.replaceUnassignedQueue(snapshot.queue);
			await child.replaceSlaBreaches(snapshot.breaches);
		};

		if (this.db.transaction) {
			await this.db.transaction(run);
			return;
		}

		await run(this.db);
	}

	async upsertTechnicians(items: PersistedTechnician[]) {
		const tenantId = this.tenantId();

		for (const item of items) {
			const query = this.db.insert(technicians).values({
				id: item.id,
				tenantId,
				name: item.name,
				status: item.status,
				homeBase: item.homeBase,
				locationLat: item.location.lat,
				locationLng: item.location.lng,
				skillsCsv: joinCsv(item.skills),
				shiftStart: item.shiftStart,
				shiftEnd: item.shiftEnd,
				activeJobCount: item.activeJobCount,
				maxConcurrentJobs: item.maxConcurrentJobs,
			});

			if (query.onConflictDoUpdate) {
				await query.onConflictDoUpdate({
					target: technicians.id,
					set: {
						name: item.name,
						status: item.status,
						homeBase: item.homeBase,
						locationLat: item.location.lat,
						locationLng: item.location.lng,
						skillsCsv: joinCsv(item.skills),
						shiftStart: item.shiftStart,
						shiftEnd: item.shiftEnd,
						activeJobCount: item.activeJobCount,
						maxConcurrentJobs: item.maxConcurrentJobs,
					},
				});
			} else if (query.execute) {
				await query.execute();
			}
		}
	}

	async upsertJobs(items: PersistedServiceJob[]) {
		const tenantId = this.tenantId();

		for (const item of items) {
			const query = this.db.insert(serviceJobs).values({
				id: item.id,
				tenantId,
				title: item.title,
				version: item.version,
				location: item.locationLabel,
				locationLat: item.location.lat,
				locationLng: item.location.lng,
				status: item.status,
				technicianId: item.technicianId,
				requiredSkillsCsv: joinCsv(item.requiredSkills),
				priority: item.priority,
				slaDueAt: item.slaDueAt,
				estimatedMinutes: item.estimatedMinutes,
				completionNotes: item.completionNotes,
				firstTimeFix: item.firstTimeFix,
				customerId: item.customerId,
			});

			if (query.onConflictDoUpdate) {
				await query.onConflictDoUpdate({
					target: serviceJobs.id,
					set: {
						status: item.status,
						version: item.version,
						technicianId: item.technicianId,
						locationLat: item.location.lat,
						locationLng: item.location.lng,
						requiredSkillsCsv: joinCsv(item.requiredSkills),
						priority: item.priority,
						slaDueAt: item.slaDueAt,
						estimatedMinutes: item.estimatedMinutes,
						completionNotes: item.completionNotes,
						firstTimeFix: item.firstTimeFix,
						customerId: item.customerId,
					},
				});
			} else if (query.execute) {
				await query.execute();
			}
		}
	}

	async replaceUnassignedQueue(items: PersistedQueueItem[]) {
		const tenantId = this.tenantId();

		await this.db
			.delete(unassignedQueue)
			.where(eq(unassignedQueue.tenantId, tenantId));

		for (const item of items) {
			const query = this.db.insert(unassignedQueue).values({
				id: item.id,
				tenantId,
				jobId: item.jobId,
				reason: item.reason,
				queuedAt: item.queuedAt,
			});

			if (query.execute) {
				await query.execute();
			}
		}
	}

	async upsertRoutePlan(item: PersistedRoutePlan) {
		const tenantId = this.tenantId();

		const query = this.db.insert(routePlans).values({
			id: item.id,
			tenantId,
			technicianId: item.technicianId,
			date: item.date,
			routeSummary: item.routeSummary,
			totalTravelMinutes: item.totalTravelMinutes,
			totalDistanceKm: item.totalDistanceKm,
			delayRisk: item.delayRisk,
			triggeredBy: item.triggeredBy,
		});

		if (query.onConflictDoUpdate) {
			await query.onConflictDoUpdate({
				target: routePlans.id,
				set: {
					routeSummary: item.routeSummary,
					totalTravelMinutes: item.totalTravelMinutes,
					totalDistanceKm: item.totalDistanceKm,
					delayRisk: item.delayRisk,
					triggeredBy: item.triggeredBy,
				},
			});
		} else if (query.execute) {
			await query.execute();
		}
	}

	async replaceChecklist(jobId: string, items: PersistedChecklistItem[]) {
		const tenantId = this.tenantId();
		await this.db
			.delete(jobChecklistItems)
			.where(
				and(
					eq(jobChecklistItems.tenantId, tenantId),
					eq(jobChecklistItems.jobId, jobId),
				),
			);

		for (const item of items) {
			const query = this.db.insert(jobChecklistItems).values({
				id: item.id,
				tenantId,
				jobId,
				label: item.label,
				required: item.required,
				done: item.done,
			});

			if (query.execute) {
				await query.execute();
			}
		}
	}

	async addProofOfService(item: PersistedProofOfService) {
		const tenantId = this.tenantId();
		const query = this.db.insert(proofOfServiceArtifacts).values({
			...item,
			tenantId,
			jobId: item.jobId,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async replaceSlaBreaches(items: PersistedSlaBreach[]) {
		const tenantId = this.tenantId();
		await this.db.delete(slaBreaches).where(eq(slaBreaches.tenantId, tenantId));

		for (const item of items) {
			const query = this.db.insert(slaBreaches).values({
				id: item.id,
				tenantId,
				jobId: item.jobId,
				priority: item.priority,
				minutesOverdue: item.minutesOverdue,
				escalated: item.escalated,
				breachedAt: item.breachedAt,
			});

			if (query.execute) {
				await query.execute();
			}
		}
	}

	async addEscalation(item: PersistedEscalation) {
		const tenantId = this.tenantId();
		const query = this.db.insert(escalationEvents).values({
			...item,
			tenantId,
			jobId: item.jobId,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async addAudit(item: PersistedAudit) {
		const tenantId = this.tenantId();
		const query = this.db.insert(auditTrail).values({
			id: item.id,
			tenantId,
			eventType: item.eventType,
			actor: item.actor,
			details: item.details,
			createdAt: item.createdAt,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async addMaintenanceRisk(item: PersistedMaintenanceRisk) {
		const tenantId = this.tenantId();
		const query = this.db.insert(maintenanceRiskAssessments).values({
			...item,
			tenantId,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async addManualOverride(item: PersistedManualOverride) {
		const tenantId = this.tenantId();
		const query = this.db.insert(manualOverrides).values({
			...item,
			tenantId,
			jobId: item.jobId,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async addWorkOrderIntelligenceRun(item: PersistedWorkOrderIntelligenceRun) {
		const tenantId = this.tenantId();
		const query = this.db.insert(workOrderIntelligenceRuns).values({
			id: item.id,
			tenantId,
			jobId: item.jobId,
			statusAtPrediction: item.statusAtPrediction,
			predictedDurationMinutes: item.predictedDurationMinutes,
			confidence: item.confidence,
			probableDiagnoses: item.probableDiagnoses,
			recommendedParts: item.recommendedParts,
			recommendedActions: item.recommendedActions,
			symptoms: item.symptoms,
			notes: item.notes,
			generatedAt: item.generatedAt,
			actualDurationMinutes: item.actualDurationMinutes,
			durationErrorMinutes: item.durationErrorMinutes,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async updateWorkOrderIntelligenceOutcome(
		id: string,
		outcome: { actualDurationMinutes: number; durationErrorMinutes: number },
	) {
		if (!this.db.update) {
			return;
		}

		const tenantId = this.tenantId();
		await this.db
			.update(workOrderIntelligenceRuns)
			.set({
				actualDurationMinutes: outcome.actualDurationMinutes,
				durationErrorMinutes: outcome.durationErrorMinutes,
			})
			.where(
				and(
					eq(workOrderIntelligenceRuns.tenantId, tenantId),
					eq(workOrderIntelligenceRuns.id, id),
				),
			);
	}

	async addTechnicianAssistBriefing(item: PersistedTechnicianAssistBriefing) {
		const tenantId = this.tenantId();
		const query = this.db.insert(technicianAssistBriefings).values({
			id: item.id,
			tenantId,
			jobId: item.jobId,
			statusAtGeneration: item.statusAtGeneration,
			recommendedSteps: item.recommendedSteps,
			smartFormFields: item.smartFormFields,
			voiceNotePrompts: item.voiceNotePrompts,
			riskFlags: item.riskFlags,
			generatedAt: item.generatedAt,
		});

		if (query.execute) {
			await query.execute();
		}
	}

	async listWorkOrderIntelligenceRuns(
		limit = 200,
	): Promise<PersistedWorkOrderIntelligenceRun[]> {
		if (!this.db.select) {
			return [];
		}

		const tenantId = this.tenantId();
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
				};
			};
		};
		const rows = await dbAny
			.select()
			.from(workOrderIntelligenceRuns)
			.where(eq(workOrderIntelligenceRuns.tenantId, tenantId));

		return rows
			.map((row) => ({
				id: String(row.id),
				jobId: String(row.jobId ?? row.job_id),
				statusAtPrediction: (row.statusAtPrediction ??
					row.status_at_prediction) as PersistedWorkOrderIntelligenceRun['statusAtPrediction'],
				predictedDurationMinutes: Number(
					row.predictedDurationMinutes ?? row.predicted_duration_minutes ?? 0,
				),
				confidence: Number(row.confidence ?? 0),
				probableDiagnoses: (row.probableDiagnoses ??
					row.probable_diagnoses ??
					[]) as PersistedWorkOrderIntelligenceRun['probableDiagnoses'],
				recommendedParts: (row.recommendedParts ??
					row.recommended_parts ??
					[]) as string[],
				recommendedActions: (row.recommendedActions ??
					row.recommended_actions ??
					[]) as string[],
				symptoms: (row.symptoms ?? []) as string[],
				notes: (row.notes ?? null) as string | null,
				generatedAt: String(
					row.generatedAt ?? row.generated_at ?? new Date().toISOString(),
				),
				actualDurationMinutes: Number(
					row.actualDurationMinutes ?? row.actual_duration_minutes ?? NaN,
				),
				durationErrorMinutes: Number(
					row.durationErrorMinutes ?? row.duration_error_minutes ?? NaN,
				),
			}))
			.map((item) => ({
				...item,
				actualDurationMinutes: Number.isNaN(item.actualDurationMinutes)
					? null
					: item.actualDurationMinutes,
				durationErrorMinutes: Number.isNaN(item.durationErrorMinutes)
					? null
					: item.durationErrorMinutes,
			}))
			.sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt))
			.slice(0, Math.max(1, limit));
	}

	async listTechnicianAssistBriefings(
		limit = 200,
	): Promise<PersistedTechnicianAssistBriefing[]> {
		if (!this.db.select) {
			return [];
		}

		const tenantId = this.tenantId();
		const dbAny = this.db as unknown as {
			select: () => {
				from: (table: unknown) => {
					where: (filter: unknown) => Promise<Array<Record<string, unknown>>>;
				};
			};
		};
		const rows = await dbAny
			.select()
			.from(technicianAssistBriefings)
			.where(eq(technicianAssistBriefings.tenantId, tenantId));

		return rows
			.map((row) => ({
				id: String(row.id),
				jobId: String(row.jobId ?? row.job_id),
				statusAtGeneration: (row.statusAtGeneration ??
					row.status_at_generation) as PersistedTechnicianAssistBriefing['statusAtGeneration'],
				recommendedSteps: (row.recommendedSteps ??
					row.recommended_steps ??
					[]) as string[],
				smartFormFields: (row.smartFormFields ??
					row.smart_form_fields ??
					[]) as string[],
				voiceNotePrompts: (row.voiceNotePrompts ??
					row.voice_note_prompts ??
					[]) as string[],
				riskFlags: (row.riskFlags ?? row.risk_flags ?? []) as string[],
				generatedAt: String(
					row.generatedAt ?? row.generated_at ?? new Date().toISOString(),
				),
			}))
			.sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt))
			.slice(0, Math.max(1, limit));
	}
}

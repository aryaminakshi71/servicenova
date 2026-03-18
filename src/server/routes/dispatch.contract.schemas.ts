import { z } from 'zod';

export const optimizeResponseSchema = z.object({
	totalCandidateJobs: z.number(),
	assignments: z.array(
		z.object({
			jobId: z.string().min(1),
			toTechnicianId: z.string().min(1),
		}),
	),
	unassignedJobIds: z.array(z.string().min(1)),
});

export const automationCycleResponseSchema = z.object({
	disruption: z
		.object({
			detectedSignals: z.number().optional(),
			processedSignals: z.number().optional(),
		})
		.optional(),
	optimization: z
		.object({
			totalCandidateJobs: z.number().optional(),
			assignments: z
				.array(
					z.object({
						jobId: z.string().min(1),
						toTechnicianId: z.string().min(1),
					}),
				)
				.optional(),
			unassignedJobIds: z.array(z.string().min(1)).optional(),
		})
		.optional(),
	driftAlerts: z.array(z.unknown()).optional(),
	metrics: z
		.object({
			totalRequests: z.number(),
			p95Ms: z.number(),
			errorRate: z.number(),
			sloBreached: z.boolean(),
		})
		.optional(),
});

import {
	configureFieldOpsPersistence,
	hydrateFieldOpsIntelligenceHistoryFromPersistence,
	hydrateFieldOpsStateFromPersistence,
} from "../../features/field-ops";
import {
	configureIntegrationOutboxStore,
	resetInMemoryIntegrationOutboxStore,
} from "../../features/integrations/outbox";
import {
	configureBackgroundJobStore,
	resetInMemoryBackgroundJobStore,
} from "../background-jobs";
import {
	configureFieldDashboardStateStore,
	resetInMemoryFieldDashboardStateStore,
} from "../field-dashboard-state";
import { configureIdempotencyStore } from "../idempotency";
import { DrizzleBackgroundJobsRepository } from "../persistence/background-jobs-repository";
import { DrizzleFieldDashboardStateRepository } from "../persistence/field-dashboard-state-repository";
import { DrizzleFieldOpsRepository } from "../persistence/field-ops-repository";
import { DrizzleIdempotencyRepository } from "../persistence/idempotency-repository";
import { DrizzleIntegrationOutboxRepository } from "../persistence/integration-outbox-repository";
import { DrizzleRateLimitRepository } from "../persistence/rate-limit-repository";
import {
	configureRateLimitStore,
	resetInMemoryRateLimitStore,
} from "../rate-limit";
import { withSpan } from "../tracing";

type RuntimeLogger = {
	info: (message: string) => void;
	warn: (message: string) => void;
};

const isTestRuntime =
	process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const defaultLogger: RuntimeLogger = {
	info: (message) => {
		if (!isTestRuntime) {
			console.info(message);
		}
	},
	warn: (message) => {
		if (!isTestRuntime) {
			console.warn(message);
		}
	},
};

export async function configureFieldOpsPersistenceFromEnv(
	logger: RuntimeLogger = defaultLogger,
) {
	const mode = process.env.FIELD_OPS_PERSISTENCE ?? "memory";

	if (mode !== "postgres") {
		resetInMemoryRateLimitStore();
		resetInMemoryIntegrationOutboxStore();
		resetInMemoryBackgroundJobStore();
		resetInMemoryFieldDashboardStateStore();
		logger.info(
			"[persistence] FIELD_OPS_PERSISTENCE is not postgres; using in-memory mode",
		);
		return { mode: "memory" as const, enabled: false };
	}

	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		resetInMemoryRateLimitStore();
		resetInMemoryIntegrationOutboxStore();
		resetInMemoryBackgroundJobStore();
		resetInMemoryFieldDashboardStateStore();
		logger.warn("[persistence] DATABASE_URL missing; using in-memory mode");
		return { mode: "memory" as const, enabled: false };
	}

	try {
		const [postgresModule, drizzleModule] = await withSpan(
			"db.persistence.initialize",
			{
				"db.system": "postgresql",
				"db.operation": "initialize",
			},
			async () => {
				const postgresModuleName = "postgres";
				const drizzleModuleName = "drizzle-orm/postgres-js";

				const postgresModule = (await import(postgresModuleName)) as {
					default: (url: string, options?: Record<string, unknown>) => unknown;
				};
				const drizzleModule = (await import(drizzleModuleName)) as {
					drizzle: (client: unknown) => unknown;
				};
				return [postgresModule, drizzleModule] as const;
			},
		);

		const client = postgresModule.default(databaseUrl, { prepare: false });
		const db = drizzleModule.drizzle(client);

		const repository = new DrizzleFieldOpsRepository(db as never);
		configureIdempotencyStore(new DrizzleIdempotencyRepository(db as never));
		configureRateLimitStore(new DrizzleRateLimitRepository(db as never));
		configureIntegrationOutboxStore(
			new DrizzleIntegrationOutboxRepository(db as never),
		);
		configureBackgroundJobStore(
			new DrizzleBackgroundJobsRepository(db as never),
		);
		configureFieldDashboardStateStore(
			new DrizzleFieldDashboardStateRepository(db as never),
		);
		configureFieldOpsPersistence(repository, { syncOnConfigure: false });

		const { snapshot, workOrderRuns, assistBriefings } = await withSpan(
			"db.persistence.hydrate_snapshot",
			{
				"db.system": "postgresql",
				"db.operation": "hydrate_snapshot",
			},
			async () => {
				const snapshot = await repository.loadCoreSnapshot();
				const [workOrderRuns, assistBriefings] = await Promise.all([
					repository.listWorkOrderIntelligenceRuns(500),
					repository.listTechnicianAssistBriefings(500),
				]);
				return {
					snapshot,
					workOrderRuns,
					assistBriefings,
				};
			},
		);
		hydrateFieldOpsIntelligenceHistoryFromPersistence({
			workOrderRuns,
			assistBriefings,
		});

		if (snapshot && snapshot.jobs.length > 0) {
			hydrateFieldOpsStateFromPersistence(snapshot);
			logger.info(
				`[persistence] Hydrated in-memory state from postgres (${snapshot.jobs.length} jobs)`,
			);
		} else {
			configureFieldOpsPersistence(repository, { syncOnConfigure: true });
		}

		logger.info("[persistence] Drizzle/Postgres persistence enabled");

		return { mode: "postgres" as const, enabled: true };
	} catch (error) {
		resetInMemoryRateLimitStore();
		resetInMemoryIntegrationOutboxStore();
		resetInMemoryBackgroundJobStore();
		resetInMemoryFieldDashboardStateStore();
		logger.warn(
			`[persistence] Failed to initialize postgres adapter: ${String(error)}`,
		);
		return { mode: "memory" as const, enabled: false };
	}
}

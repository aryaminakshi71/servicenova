import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_LIFECYCLE_ERROR_CODES,
  assignJob,
  completeJob,
  evaluateSlaBreaches,
  generateTechnicianAssistBriefing,
  generateWorkOrderIntelligence,
  getJobById,
  getTechnicianAssistHistory,
  getUnassignedQueue,
  getWorkOrderIntelligenceAccuracy,
  getWorkOrderIntelligenceDriftAlerts,
  getWorkOrderIntelligenceHistory,
  getWorkOrderIntelligenceQualityReport,
  handleDispatchDisruption,
  optimizeDispatchAssignments,
  resetFieldOpsStateForTests,
  startJob,
  updateJobChecklist,
  updateTechnicianShift,
} from "./service";
import { runWithTenantContext } from "./tenant-context";

describe("field ops service", () => {
  beforeEach(() => {
    resetFieldOpsStateForTests();
    updateTechnicianShift({
      technicianId: "tech-a1",
      start: "00:00",
      end: "23:59",
    });
    updateTechnicianShift({
      technicianId: "tech-b2",
      start: "00:00",
      end: "23:59",
    });
    updateTechnicianShift({
      technicianId: "tech-c3",
      start: "00:00",
      end: "23:59",
    });
  });

  it("assigns an open job to an eligible technician", () => {
    const result = assignJob({ jobId: "job-100" });

    expect("assigned" in result && result.assigned).toBe(true);

    if ("assigned" in result) {
      expect(result.technicianId).toBeTypeOf("string");
      expect(result.candidates.length).toBeGreaterThan(0);
    }
  });

  it("isolates job state per tenant context", () => {
    runWithTenantContext("tenant-a", () => {
      updateTechnicianShift({
        technicianId: "tech-a1",
        start: "00:00",
        end: "23:59",
      });
      updateTechnicianShift({
        technicianId: "tech-b2",
        start: "00:00",
        end: "23:59",
      });
      updateTechnicianShift({
        technicianId: "tech-c3",
        start: "00:00",
        end: "23:59",
      });

      const result = assignJob({ jobId: "job-100" });
      expect("assigned" in result && result.assigned).toBe(true);
    });

    const tenantAJob = runWithTenantContext("tenant-a", () =>
      getJobById("job-100"),
    );
    const tenantBJob = runWithTenantContext("tenant-b", () =>
      getJobById("job-100"),
    );

    expect(tenantAJob?.status).toBe("assigned");
    expect(tenantAJob?.technicianId).toBeTypeOf("string");
    expect(tenantBJob?.status).toBe("open");
    expect(tenantBJob?.technicianId).toBeNull();
  });

  it("queues a job when a forced technician is not assignable", () => {
    const result = assignJob({
      jobId: "job-100",
      technicianId: "tech-d4",
    });

    expect("assigned" in result && result.assigned).toBe(false);
    expect(getUnassignedQueue().some((item) => item.jobId === "job-100")).toBe(
      true,
    );
  });

  it("detects and escalates overdue SLA jobs", () => {
    const breaches = evaluateSlaBreaches(new Date());
    const urgentBreach = breaches.find((breach) => breach.jobId === "job-102");

    expect(urgentBreach).toBeDefined();
    expect(urgentBreach?.escalated).toBe(true);
  });

  it("enforces required checklist completion before closing a job", () => {
    const assigned = assignJob({ jobId: "job-100" });
    expect("assigned" in assigned && assigned.assigned).toBe(true);

    const started = startJob({ jobId: "job-100" });
    expect(started.started).toBe(true);

    const blocked = completeJob({ jobId: "job-100" });
    expect(blocked.completed).toBe(false);
    if (!blocked.completed) {
      expect(blocked.code).toBe(JOB_LIFECYCLE_ERROR_CODES.checklistIncomplete);
    }

    updateJobChecklist({
      jobId: "job-100",
      items: [
        { id: "site-safety", done: true },
        { id: "verify-asset", done: true },
      ],
    });

    const completed = completeJob({
      jobId: "job-100",
      firstTimeFix: true,
    });

    expect(completed.completed).toBe(true);
  });

  it("requires assigned status before starting a job", () => {
    const startOpen = startJob({ jobId: "job-100" });
    expect(startOpen.started).toBe(false);
    if (!startOpen.started) {
      expect(startOpen.code).toBe(JOB_LIFECYCLE_ERROR_CODES.invalidTransition);
    }

    assignJob({ jobId: "job-100" });
    const startAssigned = startJob({ jobId: "job-100" });
    expect(startAssigned.started).toBe(true);
  });

  it("returns conflict on stale version assignment", () => {
    const staleResult = assignJob({
      jobId: "job-100",
      expectedVersion: 999,
    });

    expect("conflict" in staleResult && staleResult.conflict).toBe(true);
    if ("conflict" in staleResult) {
      expect(staleResult.code).toBe(JOB_LIFECYCLE_ERROR_CODES.versionConflict);
    }
  });

  it("generates work-order intelligence with diagnoses and parts", () => {
    const result = generateWorkOrderIntelligence({
      jobId: "job-100",
      symptoms: ["compressor fault", "overheat warning"],
      notes: "Repeated trip after restart",
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result.jobId).toBe("job-100");
      expect(result.predictedDurationMinutes).toBeGreaterThan(0);
      expect(result.probableDiagnoses.length).toBeGreaterThan(0);
      expect(result.recommendedParts.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
    }
  });

  it("returns null intelligence for unknown job", () => {
    const result = generateWorkOrderIntelligence({
      jobId: "job-missing",
      symptoms: ["unknown issue"],
    });

    expect(result).toBeNull();
  });

  it("builds technician assist briefing with steps and smart fields", () => {
    const briefing = generateTechnicianAssistBriefing({
      jobId: "job-100",
      noteContext: "Customer reports repeated shutdown",
    });

    expect(briefing).not.toBeNull();
    if (briefing) {
      expect(briefing.recommendedSteps.length).toBeGreaterThan(0);
      expect(briefing.smartFormFields.length).toBeGreaterThan(0);
      expect(briefing.voiceNotePrompts.length).toBeGreaterThan(0);
    }
  });

  it("returns null assist briefing for unknown job", () => {
    const briefing = generateTechnicianAssistBriefing({
      jobId: "job-missing",
    });

    expect(briefing).toBeNull();
  });

  it("tracks intelligence history and computes accuracy after completion", () => {
    const run = generateWorkOrderIntelligence({
      jobId: "job-100",
      symptoms: ["compressor fault"],
    });
    expect(run).not.toBeNull();

    const assigned = assignJob({ jobId: "job-100" });
    expect("assigned" in assigned && assigned.assigned).toBe(true);
    const started = startJob({ jobId: "job-100" });
    expect(started.started).toBe(true);

    updateJobChecklist({
      jobId: "job-100",
      items: [
        { id: "site-safety", done: true },
        { id: "verify-asset", done: true },
      ],
    });

    const completed = completeJob({ jobId: "job-100" });
    expect(completed.completed).toBe(true);

    const history = getWorkOrderIntelligenceHistory({
      jobId: "job-100",
      limit: 5,
    });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.actualDurationMinutes).not.toBeNull();

    const accuracy = getWorkOrderIntelligenceAccuracy({ jobId: "job-100" });
    expect(accuracy.sampleCount).toBeGreaterThan(0);
  });

  it("tracks technician assist briefing history", () => {
    const briefing = generateTechnicianAssistBriefing({ jobId: "job-100" });
    expect(briefing).not.toBeNull();

    const history = getTechnicianAssistHistory({ jobId: "job-100", limit: 5 });
    expect(history.length).toBeGreaterThan(0);
  });

  it("handles technician unavailable disruption with auto-reassignment", () => {
    const result = handleDispatchDisruption({
      type: "technician_unavailable",
      technicianId: "tech-c3",
      reason: "Vehicle breakdown",
    });

    expect(result.type).toBe("technician_unavailable");
    expect(result.impactedJobIds).toContain("job-101");
    expect(
      result.reassignedJobIds.length +
        result.queuedJobIds.length +
        result.blockedJobIds.length,
    ).toBeGreaterThan(0);
  });

  it("optimizes dispatch assignments across candidate jobs", () => {
    const result = optimizeDispatchAssignments({
      includeAssigned: true,
    });

    expect(result.totalCandidateJobs).toBeGreaterThan(0);
    expect(result.assignments.length).toBeGreaterThan(0);
  });

  it("builds intelligence quality report with segments", () => {
    generateWorkOrderIntelligence({
      jobId: "job-100",
      symptoms: ["fault"],
    });

    const assigned = assignJob({ jobId: "job-100" });
    expect("assigned" in assigned && assigned.assigned).toBe(true);
    const started = startJob({ jobId: "job-100" });
    expect(started.started).toBe(true);

    updateJobChecklist({
      jobId: "job-100",
      items: [
        { id: "site-safety", done: true },
        { id: "verify-asset", done: true },
      ],
    });
    completeJob({ jobId: "job-100" });

    const report = getWorkOrderIntelligenceQualityReport({
      windowHours: 72,
    });

    expect(report.overall.sampleCount).toBeGreaterThan(0);
    expect(report.byPriority.length).toBeGreaterThan(0);
  });

  it("generates drift alerts when thresholds are exceeded", () => {
    generateWorkOrderIntelligence({
      jobId: "job-100",
      symptoms: ["fault"],
    });
    assignJob({ jobId: "job-100" });
    startJob({ jobId: "job-100" });
    updateJobChecklist({
      jobId: "job-100",
      items: [
        { id: "site-safety", done: true },
        { id: "verify-asset", done: true },
      ],
    });
    completeJob({ jobId: "job-100" });

    const alerts = getWorkOrderIntelligenceDriftAlerts({
      windowHours: 72,
      minSampleCount: 1,
      maxMaeMinutes: 0.1,
    });

    expect(alerts.length).toBeGreaterThan(0);
  });
});

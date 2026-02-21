import { useEffect, useMemo, useState } from "react";
import {
  type DispatchBoard,
  type IntelligenceQualityReport,
  type TechnicianAssistBriefing,
  type TechnicianAssistBriefingRun,
  type WorkOrderIntelligence,
  type WorkOrderIntelligenceAccuracy,
  type WorkOrderIntelligenceRun,
  getFieldOpsSummary,
} from "./features/field-ops";
import { flushMobileQueue } from "./mobile/offline-queue";
import { LandingPage } from "./LandingPage";

const summary = getFieldOpsSummary();
const refreshMs = 15_000;
const authToken = "Bearer manager:web-dashboard";
const streamQuery = "role=manager&userId=web-dashboard";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function AuthenticatedContent() {
  const [dispatchBoard, setDispatchBoard] = useState<DispatchBoard | null>(
    null,
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedDisruptionTechId, setSelectedDisruptionTechId] =
    useState<string>("");
  const [disruptionReason, setDisruptionReason] = useState("Vehicle breakdown");
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
  const [driftAlerts, setDriftAlerts] = useState<
    Array<{ id: string; severity: string; message: string }>
  >([]);
  const [observability, setObservability] = useState<{
    totalRequests: number;
    p95Ms: number;
    errorRate: number;
    sloBreached: boolean;
  } | null>(null);

  async function loadDispatchBoardSnapshot() {
    const response = await fetch("/api/field/dispatch-board", {
      headers: {
        authorization: authToken,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as DispatchBoard;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDispatchBoard() {
      try {
        const payload = await loadDispatchBoardSnapshot();

        if (!cancelled) {
          setDispatchBoard(payload);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Dispatch API unavailable. Showing strategy modules only.");
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
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { board?: DispatchBoard };

        if (payload.board) {
          setDispatchBoard(payload.board);
        }
      } catch {
        // Ignore malformed stream payloads and keep polling fallback.
      }
    };

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream.close();
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
    if (!dispatchBoard || dispatchBoard.technicians.length === 0) {
      setSelectedDisruptionTechId("");
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
  }, []);

  async function loadIntelligencePanels(jobId: string) {
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
      throw new Error("Unable to load intelligence insights");
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
  }

  async function loadOpsPanels() {
    const [metricsResponse, qualityResponse, driftResponse] = await Promise.all(
      [
        fetch("/api/field/observability/metrics?windowMinutes=120", {
          headers: {
            authorization: authToken,
          },
        }),
        fetch("/api/field/intelligence/quality-report?windowHours=24", {
          headers: {
            authorization: authToken,
          },
        }),
        fetch(
          "/api/field/intelligence/drift-alerts?windowHours=24&minSampleCount=3",
          {
            headers: {
              authorization: authToken,
            },
          },
        ),
      ],
    );

    if (!metricsResponse.ok || !qualityResponse.ok || !driftResponse.ok) {
      throw new Error("Unable to load ops panels");
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
      alerts?: Array<{ id: string; severity: string; message: string }>;
    };

    setObservability(metricsPayload.metrics ?? null);
    setQualityReport(qualityPayload.report ?? null);
    setDriftAlerts(driftPayload.alerts ?? []);
  }

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
      setAiError("Unable to load intelligence history right now.");
    });
  }, [selectedJobId]);

  useEffect(() => {
    void loadOpsPanels().catch(() => {
      setOpsMessage("Unable to load operational metrics.");
    });

    const timer = window.setInterval(() => {
      void loadOpsPanels().catch(() => {
        setOpsMessage("Unable to refresh operational metrics.");
      });
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  async function runWorkOrderIntelligence() {
    if (!selectedJob) {
      return;
    }

    setAiLoading(true);
    setAiError(null);

    try {
      const response = await fetch(
        `/api/field/jobs/${encodeURIComponent(selectedJob.id)}/intelligence`,
        {
          method: "POST",
          headers: {
            authorization: authToken,
            "content-type": "application/json",
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
      };

      if (payload.result) {
        setWorkOrderIntelligence(payload.result);
      }

      await loadIntelligencePanels(selectedJob.id);
    } catch {
      setAiError("Unable to generate work-order intelligence.");
    } finally {
      setAiLoading(false);
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
          method: "POST",
          headers: {
            authorization: authToken,
            "content-type": "application/json",
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
      setAiError("Unable to generate technician assist briefing.");
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
      const response = await fetch("/api/field/dispatch/disruptions", {
        method: "POST",
        headers: {
          authorization: authToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "technician_unavailable",
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
    } catch {
      setDisruptionMessage("Unable to apply disruption.");
    } finally {
      setDisruptionLoading(false);
    }
  }

  async function runDispatchOptimization() {
    setDisruptionLoading(true);
    setOpsMessage(null);

    try {
      const response = await fetch("/api/field/dispatch/optimize", {
        method: "POST",
        headers: {
          authorization: authToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          includeAssigned: true,
          reason: "dashboard optimization",
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
      const board = await loadDispatchBoardSnapshot();
      setDispatchBoard(board);
      await loadOpsPanels();
    } catch {
      setOpsMessage("Unable to run dispatch optimization.");
    } finally {
      setDisruptionLoading(false);
    }
  }

  async function runAutomationCycle() {
    setDisruptionLoading(true);
    setOpsMessage(null);

    try {
      const response = await fetch("/api/field/ops/automation/run-cycle", {
        method: "POST",
        headers: {
          authorization: authToken,
          "content-type": "application/json",
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
      const board = await loadDispatchBoardSnapshot();
      setDispatchBoard(board);
      await loadOpsPanels();
    } catch {
      setOpsMessage("Unable to run automation cycle.");
    } finally {
      setDisruptionLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <h1>ServiceNova AI</h1>
      <p>AI dispatch and field execution platform.</p>
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
                      ? "job-button job-button--selected"
                      : "job-button"
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
              : "Select a job to run AI tools."}
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
                Predicted duration:{" "}
                <strong>
                  {workOrderIntelligence.predictedDurationMinutes}m
                </strong>{" "}
                at{" "}
                <strong>
                  {formatPercent(workOrderIntelligence.confidence)}
                </strong>{" "}
                confidence
              </p>
              <ul>
                {workOrderIntelligence.probableDiagnoses.map((diagnosis) => (
                  <li key={diagnosis.label}>
                    {diagnosis.label} ({formatPercent(diagnosis.confidence)})
                  </li>
                ))}
              </ul>
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
                  Mean abs error:{" "}
                  {qualityReport.overall.meanAbsoluteErrorMinutes}m
                </li>
                <li>
                  Within 15m:{" "}
                  {formatPercent(qualityReport.overall.within15MinutesRate)}
                </li>
              </ul>
            </>
          ) : null}
          <h3>Drift Alerts</h3>
          <ul>
            {driftAlerts.slice(0, 5).map((alert) => (
              <li key={alert.id}>
                [{alert.severity}] {alert.message}
              </li>
            ))}
          </ul>
          {driftAlerts.length === 0 ? <p>No active drift alerts.</p> : null}
          {observability ? (
            <>
              <h3>Service SLO</h3>
              <ul>
                <li>Requests (120m): {observability.totalRequests}</li>
                <li>P95 latency: {observability.p95Ms}ms</li>
                <li>Error rate: {formatPercent(observability.errorRate)}</li>
                <li>
                  Status: {observability.sloBreached ? "Breach" : "Healthy"}
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
                  : ""}
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
                {run.generatedAt.slice(11, 19)} •{" "}
                {run.smartFormFields.slice(0, 2).join(", ")}
              </li>
            ))}
          </ul>
          {assistHistory.length === 0 ? <p>No assist briefings yet.</p> : null}
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
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  if (!isLoggedIn) {
    return <LandingPage onLogin={() => setIsLoggedIn(true)} />;
  }

  return <AuthenticatedContent />;
}

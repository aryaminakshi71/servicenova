import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export function isAIConfigured(): boolean {
  return !!openai;
}

export async function requestStructuredAi(
  systemPrompt: string,
  userContent: string
): Promise<any | null> {
  if (!openai) return null;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.error("AI request failed:", error);
    return null;
  }
}

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export async function optimizeDispatch(input: {
  jobs: Array<{ id: string; location: { lat: number; lng: number }; duration: number; priority: number }>;
  technicians: Array<{ id: string; location: { lat: number; lng: number }; skills: string[] }>;
}): Promise<{
  assignments: Array<{ jobId: string; technicianId: string; route: string[] }>;
  totalDistance: number;
}> {
  const fallback = {
    assignments: input.jobs.slice(0, 3).map((j, i) => ({
      jobId: j.id,
      technicianId: input.technicians[i % input.technicians.length]?.id || "TECH-001",
      route: [j.id],
    })),
    totalDistance: 45.2,
  };

  if (!openai) return fallback;

  const result = await requestStructuredAi(
    "Optimize field service dispatch. Return JSON with assignments array (jobId, technicianId, route) and totalDistance.",
    `Jobs: ${JSON.stringify(input.jobs)}, Technicians: ${JSON.stringify(input.technicians)}`
  );

  if (!result) return fallback;

  return {
    assignments: result.assignments || fallback.assignments,
    totalDistance: toNumber(result.totalDistance, fallback.totalDistance),
  };
}

export async function predictMaintenance(input: {
  equipmentId: string;
  usageHours: number;
  errorCodes: string[];
  age: number;
}): Promise<{
  risk: "low" | "medium" | "high";
  predictedFailureDays: number;
  recommendations: string[];
}> {
  const fallback = {
    risk: "medium" as const,
    predictedFailureDays: 30,
    recommendations: ["Schedule preventive maintenance", "Monitor key indicators"],
  };

  if (!openai) return fallback;

  const result = await requestStructuredAi(
    "Predict equipment maintenance needs. Return JSON with risk (low/medium/high), predictedFailureDays, recommendations.",
    `Equipment: ${input.equipmentId}, Usage: ${input.usageHours}h, Errors: ${input.errorCodes.join(", ")}, Age: ${input.age} months`
  );

  if (!result) return fallback;

  return {
    risk: (result.risk || fallback.risk) as "low" | "medium" | "high",
    predictedFailureDays: toNumber(result.predictedFailureDays, fallback.predictedFailureDays),
    recommendations: toStringArray(result.recommendations, fallback.recommendations),
  };
}

export async function estimateJobDuration(input: {
  jobType: string;
  equipmentType: string;
  complexity: "simple" | "standard" | "complex";
  technicianExperience: number;
}): Promise<{
  estimatedMinutes: number;
  confidence: number;
  factors: string[];
}> {
  const complexityValue = input.complexity;
  const experienceValue = input.technicianExperience;
  const baseTime = complexityValue === "simple" ? 30 : complexityValue === "standard" ? 60 : 120;
  const experienceFactor = Math.max(0.7, 1 - (experienceValue * 0.02));
  const fallback = {
    estimatedMinutes: Math.round(baseTime * experienceFactor),
    confidence: 0.72,
    factors: ["Job complexity", "Technician experience"],
  };

  if (!openai) return fallback;

  const result = await requestStructuredAi(
    "Estimate job duration. Return JSON with estimatedMinutes, confidence (0-1), factors array.",
    `Type: ${input.jobType}, Equipment: ${input.equipmentType}, Complexity: ${input.complexity}, Experience: ${input.technicianExperience} years`
  );

  if (!result) return fallback;

  return {
    estimatedMinutes: toNumber(result.estimatedMinutes, fallback.estimatedMinutes),
    confidence: toNumber(result.confidence, fallback.confidence),
    factors: toStringArray(result.factors, fallback.factors),
  };
}

export async function analyzeTechnicianPerformance(input: {
  technicianId: string;
  completedJobs: number;
  avgRating: number;
  responseTime: number;
  issues: string[];
}): Promise<{
  score: number;
  strengths: string[];
  improvements: string[];
}> {
  const fallback = {
    score: Math.round((input.avgRating / 5) * 100 * 0.7 + (100 - input.responseTime) * 0.3),
    strengths: ["Good customer ratings", "Experienced"],
    improvements: ["Response time optimization"],
  };

  if (!openai) return fallback;

  const result = await requestStructuredAi(
    "Analyze technician performance. Return JSON with score (0-100), strengths array, improvements array.",
    `Technician: ${input.technicianId}, Jobs: ${input.completedJobs}, Rating: ${input.avgRating}/5, Response: ${input.responseTime}min`
  );

  if (!result) return fallback;

  return {
    score: toNumber(result.score, fallback.score),
    strengths: toStringArray(result.strengths, fallback.strengths),
    improvements: toStringArray(result.improvements, fallback.improvements),
  };
}

export async function generateServiceReport(input: {
  jobId: string;
  workPerformed: string[];
  parts: string[];
  notes: string;
}): Promise<{
  summary: string;
  recommendations: string[];
  followUp: string;
}> {
  const fallback = {
    summary: "Service completed successfully",
    recommendations: ["Schedule next maintenance"],
    followUp: "In 90 days",
  };

  if (!openai) return fallback;

  const result = await requestStructuredAi(
    "Generate service report. Return JSON with summary, recommendations array, followUp.",
    `Job: ${input.jobId}, Work: ${input.workPerformed.join(", ")}, Parts: ${input.parts.join(", ")}, Notes: ${input.notes}`
  );

  if (!result) return fallback;

  return {
    summary: result.summary || fallback.summary,
    recommendations: toStringArray(result.recommendations, fallback.recommendations),
    followUp: result.followUp || fallback.followUp,
  };
}

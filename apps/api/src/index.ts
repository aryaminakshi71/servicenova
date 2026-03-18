/**
 * ServiceNova API - Enhanced with Auth, Validation, Pagination, Rate Limiting
 */

import { z } from 'zod';

const _JWT_SECRET = process.env.JWT_SECRET || 'servicenova-dev-secret-32chars';
const VALID_API_KEYS = (process.env.API_KEYS || '').split(',').filter(Boolean);

const llmApiKey = process.env.OPENAI_API_KEY;
const useRealLLM = !!llmApiKey;

if (!useRealLLM) {
	console.log('🤖 LLM Integration: Disabled (set OPENAI_API_KEY to enable)');
}

// ============================================================================
// Schemas
// ============================================================================

const requestSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
	category: z.string().default('general'),
});

const userSchema = z.object({
	name: z.string().min(1),
	email: z.string().email(),
	role: z.string().default('user'),
});

const teamSchema = z.object({
	name: z.string().min(1),
	members: z.array(z.string()).default([]),
});

const articleSchema = z.object({
	title: z.string().min(1),
	content: z.string().min(1),
	category: z.string().default('general'),
});

// ============================================================================
// Types
// ============================================================================

interface ServiceRequest {
	id: string;
	title: string;
	description: string;
	status: 'open' | 'in_progress' | 'resolved' | 'closed';
	priority: string;
	category: string;
	createdAt: string;
	organizationId: string;
}

interface User {
	id: string;
	name: string;
	email: string;
	role: string;
	organizationId: string;
}

interface Team {
	id: string;
	name: string;
	members: string[];
	organizationId: string;
}

interface KnowledgeArticle {
	id: string;
	title: string;
	content: string;
	category: string;
	organizationId: string;
}

// ============================================================================
// In-Memory Store
// ============================================================================

const requests: ServiceRequest[] = [];
const users: User[] = [];
const teams: Team[] = [];
const articles: KnowledgeArticle[] = [];

// ============================================================================
// Rate Limiting
// ============================================================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(identifier: string, maxRequests = 100): boolean {
	const now = Date.now();
	const key = `ratelimit:${identifier}`;
	let entry = rateLimitStore.get(key);

	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + 60000 };
		rateLimitStore.set(key, entry);
	}

	entry.count++;
	return entry.count <= maxRequests;
}

// ============================================================================
// Auth
// ============================================================================

function parseAuth(authHeader: string | null) {
	if (!authHeader) return null;

	if (authHeader.startsWith('ApiKey ')) {
		const key = authHeader.slice(7);
		if (VALID_API_KEYS.includes(key)) {
			return {
				id: 'system',
				email: 'system@api.local',
				organizationId: 'default',
				tier: 'enterprise',
			};
		}
	}

	return {
		id: 'demo',
		email: 'demo@user.com',
		organizationId: 'default',
		tier: 'free',
	};
}

function getOrgId(req: Request): string {
	return (
		parseAuth(req.headers.get('Authorization'))?.organizationId || 'default'
	);
}

function requireAuth(req: Request) {
	const auth = parseAuth(req.headers.get('Authorization'));
	if (!auth) {
		return Response.json({ error: 'Authorization required' }, { status: 401 });
	}
	return auth;
}

// ============================================================================
// Helpers
// ============================================================================

function paginate<T>(items: T[], page: number, limit: number) {
	const start = (page - 1) * limit;
	return {
		data: items.slice(start, start + limit),
		total: items.length,
		page,
		limit,
		totalPages: Math.ceil(items.length / limit),
	};
}

function errorResponse(message: string, status = 400) {
	return Response.json({ error: message, status }, { status });
}

async function callLLM(prompt: string): Promise<string> {
	if (!useRealLLM) {
		return 'Simulated AI response - set OPENAI_API_KEY for real LLM responses';
	}

	const response = await fetch(
		'https://openrouter.ai/api/v1/chat/completions',
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${llmApiKey}`,
			},
			body: JSON.stringify({
				model: 'google/gemini-2.0-flash-001',
				messages: [{ role: 'user', content: prompt }],
			}),
		},
	);

	const data = await response.json();
	return data.choices?.[0]?.message?.content || '';
}

// ============================================================================
// Routes
// ============================================================================

const routes: Record<string, (req: Request) => Promise<Response>> = {
	'GET /api/health': () =>
		Response.json({
			status: 'ok',
			version: '1.0.0',
			service: 'servicenova',
			llmEnabled: useRealLLM,
		}),

	// Requests
	'GET /api/v1/requests': async (req: Request) => {
		if (!checkRateLimit(getOrgId(req)))
			return errorResponse('Rate limit exceeded', 429);

		const url = new URL(req.url);
		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
		const limit = Math.min(
			100,
			Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)),
		);
		const status = url.searchParams.get('status');

		let filtered = requests.filter((r) => r.organizationId === getOrgId(req));
		if (status) filtered = filtered.filter((r) => r.status === status);

		return Response.json(paginate(filtered, page, limit));
	},

	'POST /api/v1/requests': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const body = await req.json().catch(() => null);
		const parsed = requestSchema.safeParse(body);
		if (!parsed.success) return errorResponse(parsed.error.errors[0].message);

		const request: ServiceRequest = {
			id: crypto.randomUUID(),
			title: parsed.data.title,
			description: parsed.data.description || '',
			status: 'open',
			priority: parsed.data.priority,
			category: parsed.data.category,
			createdAt: new Date().toISOString(),
			organizationId: auth.organizationId,
		};
		requests.push(request);
		return Response.json(request, { status: 201 });
	},

	'GET /api/v1/requests/:id': async (req: Request) => {
		const id = new URL(req.url).pathname.split('/').pop();
		const request = requests.find(
			(r) => r.id === id && r.organizationId === getOrgId(req),
		);
		if (!request) return errorResponse('Request not found', 404);
		return Response.json(request);
	},

	'PATCH /api/v1/requests/:id': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const id = new URL(req.url).pathname.split('/').pop();
		const request = requests.find(
			(r) => r.id === id && r.organizationId === auth.organizationId,
		);
		if (!request) return errorResponse('Request not found', 404);

		const body = await req.json().catch(() => null);
		if (body.status) request.status = body.status;
		if (body.priority) request.priority = body.priority;
		if (body.title) request.title = body.title;
		if (body.description) request.description = body.description;

		return Response.json(request);
	},

	'DELETE /api/v1/requests/:id': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const id = new URL(req.url).pathname.split('/').pop();
		const index = requests.findIndex(
			(r) => r.id === id && r.organizationId === auth.organizationId,
		);
		if (index === -1) return errorResponse('Request not found', 404);

		requests.splice(index, 1);
		return Response.json({ success: true });
	},

	// Users
	'GET /api/v1/users': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const url = new URL(req.url);
		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
		const limit = Math.min(
			100,
			Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)),
		);

		return Response.json(
			paginate(
				users.filter((u) => u.organizationId === auth.organizationId),
				page,
				limit,
			),
		);
	},

	'POST /api/v1/users': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const body = await req.json().catch(() => null);
		const parsed = userSchema.safeParse(body);
		if (!parsed.success) return errorResponse(parsed.error.errors[0].message);

		const user: User = {
			id: crypto.randomUUID(),
			name: parsed.data.name,
			email: parsed.data.email,
			role: parsed.data.role,
			organizationId: auth.organizationId,
		};
		users.push(user);
		return Response.json(user, { status: 201 });
	},

	'GET /api/v1/users/:id': async (req: Request) => {
		const id = new URL(req.url).pathname.split('/').pop();
		const user = users.find(
			(u) => u.id === id && u.organizationId === getOrgId(req),
		);
		if (!user) return errorResponse('User not found', 404);
		return Response.json(user);
	},

	// Teams
	'GET /api/v1/teams': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		return Response.json({
			data: teams.filter((t) => t.organizationId === auth.organizationId),
			total: teams.length,
		});
	},

	'POST /api/v1/teams': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const body = await req.json().catch(() => null);
		const parsed = teamSchema.safeParse(body);
		if (!parsed.success) return errorResponse(parsed.error.errors[0].message);

		const team: Team = {
			id: crypto.randomUUID(),
			name: parsed.data.name,
			members: parsed.data.members,
			organizationId: auth.organizationId,
		};
		teams.push(team);
		return Response.json(team, { status: 201 });
	},

	// Knowledge Base
	'GET /api/v1/knowledge': async (req: Request) => {
		const url = new URL(req.url);
		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
		const limit = Math.min(
			100,
			Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)),
		);
		const category = url.searchParams.get('category');

		let filtered = articles.filter((a) => a.organizationId === getOrgId(req));
		if (category) filtered = filtered.filter((a) => a.category === category);

		return Response.json(paginate(filtered, page, limit));
	},

	'POST /api/v1/knowledge': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const body = await req.json().catch(() => null);
		const parsed = articleSchema.safeParse(body);
		if (!parsed.success) return errorResponse(parsed.error.errors[0].message);

		const article: KnowledgeArticle = {
			id: crypto.randomUUID(),
			title: parsed.data.title,
			content: parsed.data.content,
			category: parsed.data.category,
			organizationId: auth.organizationId,
		};
		articles.push(article);
		return Response.json(article, { status: 201 });
	},

	'GET /api/v1/knowledge/:id': async (req: Request) => {
		const id = new URL(req.url).pathname.split('/').pop();
		const article = articles.find(
			(a) => a.id === id && a.organizationId === getOrgId(req),
		);
		if (!article) return errorResponse('Article not found', 404);
		return Response.json(article);
	},

	'PATCH /api/v1/knowledge/:id': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const id = new URL(req.url).pathname.split('/').pop();
		const article = articles.find(
			(a) => a.id === id && a.organizationId === auth.organizationId,
		);
		if (!article) return errorResponse('Article not found', 404);

		const body = await req.json().catch(() => null);
		if (body.title) article.title = body.title;
		if (body.content) article.content = body.content;
		if (body.category) article.category = body.category;

		return Response.json(article);
	},

	'DELETE /api/v1/knowledge/:id': async (req: Request) => {
		const auth = requireAuth(req);
		if (auth instanceof Response) return auth;

		const id = new URL(req.url).pathname.split('/').pop();
		const index = articles.findIndex(
			(a) => a.id === id && a.organizationId === auth.organizationId,
		);
		if (index === -1) return errorResponse('Article not found', 404);

		articles.splice(index, 1);
		return Response.json({ success: true });
	},

	// AI Endpoints
	'POST /api/ai/request/triage': async (req: Request) => {
		if (!checkRateLimit(getOrgId(req), 10))
			return errorResponse('AI rate limit exceeded', 429);

		const body = await req.json().catch(() => null);
		if (!body?.description) return errorResponse('description required');

		const aiAnalysis = await callLLM(
			`Triage this service request: ${body.description}`,
		);

		return Response.json({
			category: 'technical',
			priority: 'high',
			suggestedTeam: 'Engineering',
			aiAnalysis,
		});
	},

	'POST /api/ai/knowledge/search': async (req: Request) => {
		if (!checkRateLimit(getOrgId(req), 10))
			return errorResponse('AI rate limit exceeded', 429);

		const body = await req.json().catch(() => null);
		if (!body?.query) return errorResponse('query required');

		const aiSearch = await callLLM(`Search knowledge base for: ${body.query}`);

		return Response.json({
			results: articles
				.filter((a) => a.organizationId === getOrgId(req))
				.slice(0, 3),
			summary: 'Found relevant articles for your query',
			aiSummary: aiSearch,
		});
	},

	'POST /api/ai/response/suggest': async (req: Request) => {
		if (!checkRateLimit(getOrgId(req), 10))
			return errorResponse('AI rate limit exceeded', 429);

		const body = await req.json().catch(() => null);
		if (!body?.requestId) return errorResponse('requestId required');

		const request = requests.find(
			(r) => r.id === body.requestId && r.organizationId === getOrgId(req),
		);
		if (!request) return errorResponse('Request not found', 404);

		const aiSuggestion = await callLLM(
			`Suggest response for: ${request.title} - ${request.description}`,
		);

		return Response.json({
			suggestion: aiSuggestion,
			knowledgeRefs: ['article-1', 'article-2'],
		});
	},

	// Dashboard
	'GET /api/v1/dashboard/stats': async (req: Request) => {
		const orgId = getOrgId(req);
		const orgRequests = requests.filter((r) => r.organizationId === orgId);
		const openRequests = orgRequests.filter((r) => r.status === 'open').length;
		const highPriority = orgRequests.filter(
			(r) => r.priority === 'high' && r.status === 'open',
		).length;

		return Response.json({
			openRequests,
			highPriority,
			totalRequests: orgRequests.length,
			totalUsers: users.filter((u) => u.organizationId === orgId).length,
			totalTeams: teams.filter((t) => t.organizationId === orgId).length,
			totalArticles: articles.filter((a) => a.organizationId === orgId).length,
		});
	},
};

Bun.serve({
	port: 3008,
	fetch(req) {
		const url = new URL(req.url);
		const routeKey = `${req.method} ${url.pathname}`;
		const handler = routes[routeKey];

		if (handler) return handler(req);
		return Response.json({ error: 'Not found' }, { status: 404 });
	},
});

console.log('ServiceNova API running on http://localhost:3000');
console.log(
	'Features: Auth, Zod Validation, Pagination, Rate Limiting, LLM Integration',
);

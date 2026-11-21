import type {
  AdminAuthStatus,
  AppSettings,
  AttachedDocumentInput,
  BatchJob,
  ChatMessage,
  Conversation,
  ExternalSearchReport,
  KnowledgeBaseStats,
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeSectionId,
  ProviderStatus,
  ReviewStatus,
  ToolCapabilityDescriptor,
  UserPreferenceItem,
  UserTaskItem,
} from '../shared/types.ts';

// Admin token held strictly in JS memory (never persisted to localStorage/sessionStorage)
let inMemoryAdminToken: string | null = null;

export function setAdminToken(token: string | null): void {
  inMemoryAdminToken = token;
}

export function getAdminToken(): string | null {
  return inMemoryAdminToken;
}

async function requestJson<T>(
  url: string,
  options?: RequestInit,
  includeAdminAuth = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (includeAdminAuth && inMemoryAdminToken) {
    headers.Authorization = `Bearer ${inMemoryAdminToken}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface PublicCapabilitiesResponse {
  settings: AppSettings;
  providers: ProviderStatus[];
  tools: ToolCapabilityDescriptor[];
  supportedAppsCount: number;
  imageGenerationEnabled: boolean;
}

export interface SystemStatusResponse {
  providers: ProviderStatus[];
  settings: AppSettings;
  knowledgeStats: KnowledgeBaseStats;
  supportedAppsCount: number;
  imageGenerationEnabled: boolean;
  recentAudits: Array<{ id: number; event_type: string; detail: string; created_at: string }>;
}

export const apiClient = {
  getPublicCapabilities: () =>
    requestJson<PublicCapabilitiesResponse>('/api/public/capabilities'),

  // Admin Auth & Diagnostics
  getAdminStatus: () => requestJson<AdminAuthStatus>('/api/admin/status', undefined, true),
  claimAdmin: async (passcode: string) => {
    const res = await requestJson<{ token: string }>('/api/admin/claim', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    inMemoryAdminToken = res.token;
    return res;
  },
  loginAdmin: async (passcode: string) => {
    const res = await requestJson<{ token: string }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    inMemoryAdminToken = res.token;
    return res;
  },
  logoutAdmin: () => {
    inMemoryAdminToken = null;
  },

  getSystemStatus: () => requestJson<SystemStatusResponse>('/api/system/status', undefined, true),

  getSettings: () => requestJson<AppSettings>('/api/settings'),
  updateSettings: (partial: Partial<AppSettings>) =>
    requestJson<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(partial),
    }),

  // Tools, Tasks & Consented Memory
  listTools: () => requestJson<{ tools: ToolCapabilityDescriptor[] }>('/api/tools'),
  listTasks: () => requestJson<{ tasks: UserTaskItem[] }>('/api/tasks'),
  createTask: (title: string, notes = '', priority: UserTaskItem['priority'] = 'medium') =>
    requestJson<UserTaskItem>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, notes, priority }),
    }),
  updateTaskStatus: (id: string, status: UserTaskItem['status']) =>
    requestJson<{ updated: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteTask: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listPreferences: () =>
    requestJson<{ consentGranted: boolean; preferences: UserPreferenceItem[] }>('/api/preferences'),
  savePreference: (key: string, value: string) =>
    requestJson<UserPreferenceItem>('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    }),
  deletePreference: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/preferences/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Conversations & Chat
  listConversations: () => requestJson<{ conversations: Conversation[] }>('/api/conversations'),
  createConversation: (title?: string) =>
    requestJson<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  getMessages: (conversationId: string) =>
    requestJson<{ messages: ChatMessage[] }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`
    ),
  deleteConversation: (conversationId: string) =>
    requestJson<{ deleted: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    }),

  sendChatMessage: (payload: {
    query: string;
    conversationId?: string;
    attachments?: AttachedDocumentInput[];
    platform?: string;
    settingsOverride?: Partial<AppSettings>;
  }) =>
    requestJson<{
      conversationId: string;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin-Protected Knowledge Base Endpoints
  getKnowledgeStats: () =>
    requestJson<KnowledgeBaseStats>('/api/knowledge/stats', undefined, true),
  listKnowledgeRecords: (params: {
    section?: KnowledgeSectionId;
    status?: ReviewStatus;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.section) sp.set('section', params.section);
    if (params.status) sp.set('status', params.status);
    if (params.q) sp.set('q', params.q);
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.offset) sp.set('offset', String(params.offset));
    return requestJson<{ records: KnowledgeRecord[]; total: number }>(
      `/api/knowledge/records?${sp.toString()}`,
      undefined,
      true
    );
  },
  createKnowledgeRecord: (input: KnowledgeRecordInput) =>
    requestJson<KnowledgeRecord>(
      '/api/knowledge/records',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      true
    ),
  updateKnowledgeRecord: (id: string, updates: Partial<KnowledgeRecordInput>) =>
    requestJson<KnowledgeRecord>(
      `/api/knowledge/records/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      },
      true
    ),
  deleteKnowledgeRecord: (id: string) =>
    requestJson<{ deleted: boolean }>(
      `/api/knowledge/records/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
      true
    ),
  exportKnowledge: (section?: KnowledgeSectionId) =>
    requestJson<{ exportedAt: string; total: number; records: KnowledgeRecord[] }>(
      `/api/knowledge/export${section ? `?section=${encodeURIComponent(section)}` : ''}`,
      undefined,
      true
    ),
  importKnowledge: (records: KnowledgeRecordInput[]) =>
    requestJson<{ inserted: number; duplicates: number; rejected: number; errors: string[] }>(
      '/api/knowledge/import',
      {
        method: 'POST',
        body: JSON.stringify({ records }),
      },
      true
    ),
  backupKnowledge: () =>
    requestJson<{ filePath: string; sizeBytes: number; createdAt: string }>(
      '/api/knowledge/backup',
      { method: 'POST' },
      true
    ),

  listBatches: () => requestJson<{ jobs: BatchJob[] }>('/api/knowledge/batches', undefined, true),
  startBatch: (section: KnowledgeSectionId, targetBatchSize: number) =>
    requestJson<{ job: BatchJob; stats: KnowledgeBaseStats }>(
      '/api/knowledge/batches',
      {
        method: 'POST',
        body: JSON.stringify({ section, targetBatchSize, runImmediately: true }),
      },
      true
    ),
  stepBatch: (jobId: string, maxSteps = 3) =>
    requestJson<{ job: BatchJob; stats: KnowledgeBaseStats }>(
      `/api/knowledge/batches/${encodeURIComponent(jobId)}/step`,
      {
        method: 'POST',
        body: JSON.stringify({ maxSteps }),
      },
      true
    ),
  resumeBatches: () =>
    requestJson<{ resumed: number; jobs: BatchJob[]; stats: KnowledgeBaseStats }>(
      '/api/knowledge/batches/resume',
      { method: 'POST' },
      true
    ),

  runExternalSearch: (query: string, preferArabic: boolean) =>
    requestJson<ExternalSearchReport>(
      '/api/search',
      {
        method: 'POST',
        body: JSON.stringify({ query, preferArabic }),
      },
      true
    ),

  transcribeAudioFallback: (audioBase64: string, mimeType: string, lang: 'ar-SA' | 'en-US') =>
    requestJson<{ transcript: string }>('/api/voice/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, mimeType, lang }),
    }),

  synthesizeServerTts: (text: string, voiceName = 'Kore') =>
    requestJson<{ audioBase64: string; mimeType: string }>('/api/voice/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voiceName }),
    }),
};

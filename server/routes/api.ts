import crypto from 'node:crypto';
import express from 'express';
import {
  KNOWLEDGE_SECTIONS,
  PERSONALITY_STYLES,
} from '../../src/shared/constants.ts';
import { SUPPORTED_APPS } from '../../src/shared/supportedApps.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  Conversation,
  KnowledgeRecordInput,
  KnowledgeSectionId,
  ReviewStatus,
  UserTaskItem,
} from '../../src/shared/types.ts';
import {
  claimAdminPasscode,
  extractBearerToken,
  getAdminSetupState,
  requireAdminAuth,
  verifyAdminLogin,
  verifyAdminToken,
} from '../auth/adminAuth.ts';
import { detectDeviceControlCommand, runNexoraMaster } from '../brain/nexoraMaster.ts';
import {
  createDatabaseBackup,
  createUserTask,
  deleteUserPreference,
  deleteUserTask,
  getAppSettings,
  getDatabase,
  listUserPreferences,
  listUserTasks,
  logAuditEvent,
  saveAppSettings,
  updateUserTaskStatus,
  upsertUserPreference,
} from '../db/database.ts';
import {
  createBatchJob,
  listBatchJobs,
  resumeIncompleteBatches,
  runBatchStep,
} from '../knowledge/batchHarvester.ts';
import {
  deleteKnowledgeRecord,
  exportKnowledgeRecords,
  getKnowledgeStats,
  insertKnowledgeBatch,
  insertKnowledgeRecord,
  listKnowledgeRecords,
  updateKnowledgeRecord,
} from '../knowledge/repository.ts';
import { createGeminiClient, getProvidersStatus, ProviderError } from '../providers/manager.ts';
import { runExternalSearch } from '../search/externalSearch.ts';
import { listRegisteredTools } from '../tools/registry.ts';

const VALID_SECTIONS = new Set<KnowledgeSectionId>(KNOWLEDGE_SECTIONS.map((s) => s.id));

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Minimal public health endpoint (no internal KB counts or details exposed)
  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'NEXORA AI',
      timestamp: new Date().toISOString(),
    });
  });

  // Public Capabilities & Safe Runtime Info (no internal KB/DB/audit details)
  router.get('/public/capabilities', (_req, res) => {
    const settings = getAppSettings();
    const providers = getProvidersStatus();
    res.json({
      settings,
      providers,
      tools: listRegisteredTools(),
      supportedAppsCount: SUPPORTED_APPS.length,
      imageGenerationEnabled: false,
    });
  });

  // Admin Authentication Endpoints
  router.get('/admin/status', (req, res) => {
    const setup = getAdminSetupState();
    const token = extractBearerToken(req);
    res.json({
      needsClaim: setup.needsClaim,
      envPasscodeActive: setup.envPasscodeActive,
      authenticated: verifyAdminToken(token),
    });
  });

  router.post('/admin/claim', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = claimAdminPasscode(passcode);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ token: result.token });
  });

  router.post('/admin/login', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = verifyAdminLogin(passcode);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ token: result.token });
  });

  // Protected Admin System Diagnostics (requires Admin Bearer token)
  router.get('/system/status', requireAdminAuth, (_req, res) => {
    const db = getDatabase();
    const stats = getKnowledgeStats(db);
    const providers = getProvidersStatus();
    const settings = getAppSettings(db);
    const recentAudits = db
      .prepare('SELECT id, event_type, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT 15')
      .all();

    res.json({
      providers,
      settings,
      knowledgeStats: stats,
      supportedAppsCount: SUPPORTED_APPS.length,
      imageGenerationEnabled: false,
      recentAudits,
    });
  });

  // User Settings
  router.get('/settings', (_req, res) => {
    res.json(getAppSettings());
  });

  router.put('/settings', (req, res) => {
    const body = req.body as Partial<AppSettings>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }
    const allowed: Partial<AppSettings> = {};
    if (body.language === 'ar' || body.language === 'en') allowed.language = body.language;
    if (body.theme === 'light' || body.theme === 'dark') allowed.theme = body.theme;
    if (PERSONALITY_STYLES.some((s) => s.id === body.personalityStyle)) {
      allowed.personalityStyle = body.personalityStyle;
    }
    if (
      body.activeProvider &&
      ['gemini', 'openai', 'anthropic', 'openai-compatible', 'local'].includes(body.activeProvider)
    ) {
      allowed.activeProvider = body.activeProvider;
    }
    if (typeof body.activeModel === 'string' && body.activeModel.trim()) {
      allowed.activeModel = body.activeModel.trim().slice(0, 100);
    }
    if (typeof body.enableExternalSearch === 'boolean') {
      allowed.enableExternalSearch = body.enableExternalSearch;
    }
    if (typeof body.enableProviderFallback === 'boolean') {
      allowed.enableProviderFallback = body.enableProviderFallback;
    }
    if (body.voiceSttLang === 'ar-SA' || body.voiceSttLang === 'en-US') {
      allowed.voiceSttLang = body.voiceSttLang;
    }
    if (typeof body.voiceInputDeviceId === 'string') {
      allowed.voiceInputDeviceId = body.voiceInputDeviceId.slice(0, 160);
    }
    if (typeof body.voiceTtsEnabled === 'boolean') {
      allowed.voiceTtsEnabled = body.voiceTtsEnabled;
    }
    if (typeof body.voiceTtsRate === 'number' && body.voiceTtsRate >= 0.5 && body.voiceTtsRate <= 2.0) {
      allowed.voiceTtsRate = body.voiceTtsRate;
    }
    if (typeof body.voiceTtsVoiceName === 'string') {
      allowed.voiceTtsVoiceName = body.voiceTtsVoiceName.slice(0, 120);
    }
    if (typeof body.autoSpeakResponses === 'boolean') {
      allowed.autoSpeakResponses = body.autoSpeakResponses;
    }
    if (typeof body.autoSendVoiceTranscript === 'boolean') {
      allowed.autoSendVoiceTranscript = body.autoSendVoiceTranscript;
    }
    if (typeof body.useServerTtsFallback === 'boolean') {
      allowed.useServerTtsFallback = body.useServerTtsFallback;
    }
    if (typeof body.enableWakeWord === 'boolean') {
      allowed.enableWakeWord = body.enableWakeWord;
    }
    if (typeof body.allowBackgroundTts === 'boolean') {
      allowed.allowBackgroundTts = body.allowBackgroundTts;
    }
    if (typeof body.memoryConsentGranted === 'boolean') {
      allowed.memoryConsentGranted = body.memoryConsentGranted;
    }

    const updated = saveAppSettings(allowed);
    logAuditEvent('SETTINGS_UPDATED', `Updated settings (${Object.keys(allowed).join(', ')})`);
    res.json(updated);
  });

  // Tools, User Tasks & Consented Preferences
  router.get('/tools', (_req, res) => {
    res.json({ tools: listRegisteredTools() });
  });

  router.get('/tasks', (_req, res) => {
    res.json({ tasks: listUserTasks() });
  });

  router.post('/tasks', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Task title is required.' });
      return;
    }
    const priority = ['low', 'medium', 'high'].includes(req.body?.priority)
      ? req.body.priority
      : 'medium';
    const created = createUserTask({
      id: `task_${crypto.randomUUID().slice(0, 10)}`,
      title: title.slice(0, 140),
      notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 400) : '',
      status: 'todo',
      priority,
    });
    res.status(201).json(created);
  });

  router.patch('/tasks/:id', (req, res) => {
    const status = req.body?.status as UserTaskItem['status'];
    if (!['todo', 'in_progress', 'done'].includes(status)) {
      res.status(400).json({ error: 'Invalid task status.' });
      return;
    }
    const ok = updateUserTaskStatus(req.params.id, status);
    res.json({ updated: ok });
  });

  router.delete('/tasks/:id', (req, res) => {
    res.json({ deleted: deleteUserTask(req.params.id) });
  });

  router.get('/preferences', (_req, res) => {
    const settings = getAppSettings();
    res.json({
      consentGranted: settings.memoryConsentGranted,
      preferences: listUserPreferences(),
    });
  });

  router.post('/preferences', (req, res) => {
    const settings = getAppSettings();
    if (!settings.memoryConsentGranted) {
      res.status(403).json({ error: 'User consent for preference memory is required.' });
      return;
    }
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';
    if (!key || !value) {
      res.status(400).json({ error: 'Both key and value are required.' });
      return;
    }
    const saved = upsertUserPreference(`up_${crypto.randomUUID().slice(0, 10)}`, key, value);
    res.status(201).json(saved);
  });

  router.delete('/preferences/:id', (req, res) => {
    res.json({ deleted: deleteUserPreference(req.params.id) });
  });

  // Conversations & History
  router.get('/conversations', (_req, res) => {
    const db = getDatabase();
    const list = db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50')
      .all() as unknown as Conversation[];
    res.json({ conversations: list });
  });

  router.post('/conversations', (req, res) => {
    const db = getDatabase();
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 120)
        : 'محادثة جديدة';
    const now = new Date().toISOString();
    const id = `conv_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      id,
      title,
      now,
      now
    );
    res.status(201).json({ id, title, created_at: now, updated_at: now });
  });

  router.get('/conversations/:id/messages', (req, res) => {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT id, conversation_id, role, content, metadata_json, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(req.params.id) as Array<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      metadata_json: string | null;
      created_at: string;
    }>;

    const messages: ChatMessage[] = rows.map((r) => {
      const parsedMeta = r.metadata_json ? JSON.parse(r.metadata_json) : undefined;
      if (parsedMeta) {
        // Ensure internal KB records are never returned to client chat UI
        delete parsedMeta.kbSources;
        delete parsedMeta.selectedSections;
      }
      return {
        id: r.id,
        conversation_id: r.conversation_id,
        role: r.role,
        content: r.content,
        metadata: parsedMeta,
        created_at: r.created_at,
      };
    });
    res.json({ messages });
  });

  router.delete('/conversations/:id', (req, res) => {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    res.json({ deleted: Number(result.changes) > 0 });
  });

  // Primary NEXORA MASTER Chat Endpoint
  router.post('/chat', async (req, res) => {
    const db = getDatabase();
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Query text is required.' });
      return;
    }

    const attachmentsRaw = Array.isArray(req.body?.attachments)
      ? (req.body.attachments as AttachedDocumentInput[])
      : [];
    const attachments: AttachedDocumentInput[] = attachmentsRaw
      .filter(
        (a) =>
          a &&
          typeof a.fileName === 'string' &&
          typeof a.contentText === 'string' &&
          a.contentText.length > 0
      )
      .slice(0, 3)
      .map((a) => ({
        fileName: a.fileName.slice(0, 120),
        mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 80) : 'text/plain',
        contentText: a.contentText.slice(0, 30000),
      }));

    let conversationId =
      typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
        ? req.body.conversationId.trim()
        : '';

    const now = new Date().toISOString();
    if (!conversationId) {
      conversationId = `conv_${crypto.randomUUID().slice(0, 12)}`;
      db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        conversationId,
        query.slice(0, 60),
        now,
        now
      );
    } else {
      const exists = db
        .prepare('SELECT id FROM conversations WHERE id = ?')
        .get(conversationId) as { id: string } | undefined;
      if (!exists) {
        db.prepare(
          'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
        ).run(conversationId, query.slice(0, 60), now, now);
      }
    }

    const prevRows = db
      .prepare(
        'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 8'
      )
      .all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;
    const history = prevRows.reverse();

    const userMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
    const storedUserText =
      attachments.length > 0
        ? `${query}\n\n[مرفق: ${attachments.map((a) => a.fileName).join(', ')}]`
        : query;
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userMsgId, conversationId, 'user', storedUserText, null, now);

    try {
      const platform = req.body?.platform ?? 'web';
      const settingsOverride = req.body?.settingsOverride as Partial<AppSettings> | undefined;
      const masterResult = await runNexoraMaster({
        query,
        history,
        attachments,
        platform,
        settingsOverride,
      });

      const assistantTime = new Date().toISOString();
      const assistantMsgId = `msg_${crypto.randomUUID().slice(0, 12)}`;
      const { answer, internalUsedKbCount: _internalCount, ...publicMetadata } = masterResult;

      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        assistantMsgId,
        conversationId,
        'assistant',
        answer,
        JSON.stringify(publicMetadata),
        assistantTime
      );
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        assistantTime,
        conversationId
      );

      res.json({
        conversationId,
        userMessage: {
          id: userMsgId,
          conversation_id: conversationId,
          role: 'user',
          content: storedUserText,
          created_at: now,
        },
        assistantMessage: {
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: answer,
          metadata: publicMetadata,
          created_at: assistantTime,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected NEXORA MASTER error.';
      res.status(500).json({ error: msg });
    }
  });

  // ADMIN-ONLY Knowledge Base Management Routes
  router.get('/knowledge/stats', requireAdminAuth, (_req, res) => {
    res.json(getKnowledgeStats());
  });

  router.get('/knowledge/records', requireAdminAuth, (req, res) => {
    const sectionRaw = typeof req.query.section === 'string' ? req.query.section : undefined;
    const section =
      sectionRaw && VALID_SECTIONS.has(sectionRaw as KnowledgeSectionId)
        ? (sectionRaw as KnowledgeSectionId)
        : undefined;
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const reviewStatus =
      statusRaw && ['verified', 'needs_review', 'rejected'].includes(statusRaw)
        ? (statusRaw as ReviewStatus)
        : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const limit = Number(req.query.limit ?? 30);
    const offset = Number(req.query.offset ?? 0);

    res.json(
      listKnowledgeRecords({
        section,
        reviewStatus,
        query,
        limit: Number.isFinite(limit) ? limit : 30,
        offset: Number.isFinite(offset) ? offset : 0,
      })
    );
  });

  router.post('/knowledge/records', requireAdminAuth, (req, res) => {
    const input = req.body as KnowledgeRecordInput;
    if (!input || !VALID_SECTIONS.has(input.section)) {
      res.status(400).json({ error: 'Valid section and record fields are required.' });
      return;
    }
    const result = insertKnowledgeRecord(input);
    if (result.duplicate) {
      res.status(409).json({ error: 'Duplicate knowledge record blocked.', duplicate: true });
      return;
    }
    if (!result.inserted) {
      res.status(400).json({ error: result.error ?? 'Failed to insert record.' });
      return;
    }
    res.status(201).json(result.record);
  });

  router.patch('/knowledge/records/:id', requireAdminAuth, (req, res) => {
    const updated = updateKnowledgeRecord(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    res.json(updated);
  });

  router.delete('/knowledge/records/:id', requireAdminAuth, (req, res) => {
    const deleted = deleteKnowledgeRecord(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  router.get('/knowledge/export', requireAdminAuth, (req, res) => {
    const sectionRaw = typeof req.query.section === 'string' ? req.query.section : undefined;
    const section =
      sectionRaw && VALID_SECTIONS.has(sectionRaw as KnowledgeSectionId)
        ? (sectionRaw as KnowledgeSectionId)
        : undefined;
    const records = exportKnowledgeRecords(section);
    res.json({
      exportedAt: new Date().toISOString(),
      total: records.length,
      records,
    });
  });

  router.post('/knowledge/import', requireAdminAuth, (req, res) => {
    const records = Array.isArray(req.body?.records) ? (req.body.records as KnowledgeRecordInput[]) : null;
    if (!records) {
      res.status(400).json({ error: 'Expected { records: [...] } array.' });
      return;
    }
    const summary = insertKnowledgeBatch(records.slice(0, 2000));
    logAuditEvent(
      'KNOWLEDGE_IMPORT',
      `Imported=${summary.inserted}, duplicates=${summary.duplicates}, rejected=${summary.rejected}`
    );
    res.json(summary);
  });

  router.post('/knowledge/backup', requireAdminAuth, (_req, res) => {
    const backup = createDatabaseBackup();
    logAuditEvent('KNOWLEDGE_BACKUP', `Created backup (${backup.sizeBytes} bytes)`);
    res.json(backup);
  });

  router.get('/knowledge/batches', requireAdminAuth, (_req, res) => {
    res.json({ jobs: listBatchJobs() });
  });

  router.post('/knowledge/batches', requireAdminAuth, async (req, res) => {
    const section = req.body?.section as KnowledgeSectionId;
    const batchSize = Number(req.body?.targetBatchSize ?? 100);
    const runImmediately = req.body?.runImmediately !== false;

    if (!VALID_SECTIONS.has(section)) {
      res.status(400).json({ error: 'Invalid knowledge section.' });
      return;
    }

    try {
      let job = createBatchJob(section, Number.isFinite(batchSize) ? batchSize : 100, 'wikipedia');
      if (runImmediately) {
        job = await runBatchStep(job.id, 3);
      }
      res.status(201).json({ job, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Batch execution error',
        stats: getKnowledgeStats(),
      });
    }
  });

  router.post('/knowledge/batches/:id/step', requireAdminAuth, async (req, res) => {
    try {
      const steps = Math.min(Math.max(Number(req.body?.maxSteps ?? 3), 1), 10);
      const job = await runBatchStep(req.params.id, steps);
      res.json({ job, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed batch step',
        stats: getKnowledgeStats(),
      });
    }
  });

  router.post('/knowledge/batches/resume', requireAdminAuth, async (_req, res) => {
    try {
      const jobs = await resumeIncompleteBatches();
      res.json({ resumed: jobs.length, jobs, stats: getKnowledgeStats() });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed resuming batches',
      });
    }
  });

  // External Search Engine Route (accessible to admin search tester and tools)
  router.post('/search', requireAdminAuth, async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const preferArabic = Boolean(req.body?.preferArabic);
    const report = await runExternalSearch(query, preferArabic);
    res.json(report);
  });

  // Voice STT / TTS Server Endpoints (real audio transcription & WAV TTS synthesis)
  router.post('/voice/transcribe', async (req, res) => {
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/webm';
    const langHint = req.body?.lang === 'en-US' ? 'English' : 'Arabic or English';

    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required.' });
      return;
    }

    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this spoken audio accurately in ${langHint}. Return ONLY the exact spoken words, or an empty string if the audio contains only silence or noise.`,
            },
          ],
        },
      });
      res.json({ transcript: (response.text ?? '').trim() });
    } catch (err) {
      const status = err instanceof ProviderError ? err.statusCode : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Audio transcription failed.',
      });
    }
  });

  router.post('/voice/tts', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1500) : '';
    const voiceName =
      typeof req.body?.voiceName === 'string' &&
      ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(req.body.voiceName)
        ? req.body.voiceName
        : 'Kore';

    if (!text) {
      res.status(400).json({ error: 'Text is required for TTS synthesis.' });
      return;
    }

    try {
      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: 'Clear, natural, articulate assistant voice',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({ error: 'TTS model did not return audio data.' });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
      });
    } catch (err) {
      const status = err instanceof ProviderError ? err.statusCode : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Server TTS synthesis failed.',
      });
    }
  });

  // Device Control & Supported Apps
  router.get('/device/apps', (_req, res) => {
    res.json({ apps: SUPPORTED_APPS });
  });

  router.post('/device/parse', (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    const platform = req.body?.platform ?? 'web';
    const command = detectDeviceControlCommand(query, platform);
    res.json({ command });
  });

  return router;
}

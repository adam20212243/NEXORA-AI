import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  classifySections,
  detectDeviceControlCommand,
  runNexoraMaster,
} from '../server/brain/nexoraMaster.ts';
import { closeDatabase, getDatabase, saveAppSettings } from '../server/db/database.ts';
import {
  createBatchJob,
  runBatchStep,
} from '../server/knowledge/batchHarvester.ts';
import {
  getKnowledgeStats,
  insertKnowledgeRecord,
  searchKnowledgeRecords,
} from '../server/knowledge/repository.ts';
import { ensureStarterKnowledgeSeeded } from '../server/knowledge/starterPack.ts';
import { createApiRouter } from '../server/routes/api.ts';
import { validateExternalUrl } from '../server/search/externalSearch.ts';
import {
  evaluateSafeMathExpression,
  listRegisteredTools,
  runMatchedTools,
} from '../server/tools/registry.ts';
import { matchWakeWord } from '../src/services/voiceService.ts';
import { PERSONALITY_STYLES } from '../src/shared/constants.ts';

let tempDbPath = '';

before(() => {
  tempDbPath = path.join(os.tmpdir(), `nexora-test-${Date.now()}.db`);
  process.env.NEXORA_DB_PATH = tempDbPath;
  delete process.env.NEXORA_ADMIN_PASSCODE;
  getDatabase(tempDbPath);
  const seeded = ensureStarterKnowledgeSeeded();
  assert.equal(seeded.seeded, true);
  assert.equal(seeded.count, 25);
});

after(() => {
  closeDatabase();
  if (tempDbPath && fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});

describe('NEXORA AI Core, Privacy, Tools, Voice & Admin Auth', () => {
  test('1. Real section counters match persisted records across all 5 sections', () => {
    const stats = getKnowledgeStats();
    assert.equal(stats.totalRecords, 25);
    assert.equal(stats.sections.length, 5);
    for (const sec of stats.sections) {
      assert.equal(sec.totalCount, 5);
      assert.equal(sec.verifiedCount, 5);
      assert.equal(sec.targetCount, 4000);
    }
  });

  test('2. Duplicate prevention blocks identical or normalized duplicate records', () => {
    const first = insertKnowledgeRecord({
      section: 'science',
      subcategory: 'Physics',
      title: 'Law of Conservation of Energy Test',
      detailed_content:
        'Energy cannot be created or destroyed in an isolated system; it transforms between forms.',
      simple_explanation: 'Total energy in a closed system remains constant.',
      context: 'Thermodynamics',
      usage_limits: 'Applies to isolated macroscopic systems.',
      sources: ['Wikipedia - Conservation of energy'],
      source_urls: ['https://en.wikipedia.org/wiki/Conservation_of_energy'],
      confidence_level: 'high',
      keywords: ['energy', 'thermodynamics'],
    });
    assert.equal(first.inserted, true);

    const dup = insertKnowledgeRecord({
      section: 'science',
      subcategory: 'Physics',
      title: 'Law of Conservation of Energy Test!',
      detailed_content:
        'Energy cannot be created or destroyed in an isolated system; it transforms between forms.',
      simple_explanation: 'Total energy in a closed system remains constant.',
      context: 'Thermodynamics',
      usage_limits: 'Applies to isolated macroscopic systems.',
      sources: ['Wikipedia - Conservation of energy'],
      source_urls: ['https://en.wikipedia.org/wiki/Conservation_of_energy'],
      confidence_level: 'high',
      keywords: ['energy'],
    });
    assert.equal(dup.inserted, false);
    assert.equal(dup.duplicate, true);
  });

  test('3. FTS5 retrieval pulls records silently across all 5 sections', () => {
    assert.ok(searchKnowledgeRecords('نيوتن', ['science'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('TypeScript', ['programming'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('المناعي', ['medicine'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('بغداد', ['history_culture'], 5).length >= 1);
    assert.ok(searchKnowledgeRecords('الاستدلال', ['logic_creativity'], 5).length >= 1);

    const multiSections = classifySections('اشرح الفيزياء وتطوير الألعاب في Unity والمنهج العلمي');
    assert.ok(multiSections.includes('science'));
    assert.ok(multiSections.includes('programming'));
    assert.ok(multiSections.includes('logic_creativity'));
  });

  test('4. NEXORA MASTER enforces medical safety and uses silent background KB', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const medRes = await runNexoraMaster({
        query: 'ما هي وظيفة الجهاز المناعي ونتائج تحليل CBC؟',
        settingsOverride: { enableExternalSearch: false, personalityStyle: 'scientific' },
      });
      assert.equal(medRes.medicalDisclaimerIncluded, true);
      assert.ok((medRes.internalUsedKbCount ?? 0) >= 1);
      assert.equal('kbSources' in medRes, false);
      assert.ok(medRes.answer.includes('تثقيف') || medRes.answer.includes('طبيب'));
    } finally {
      if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
    }
  });

  test('5. All 7 personality styles and Wake Word matcher work in Arabic and English', () => {
    assert.equal(PERSONALITY_STYLES.length, 7);

    const arWake = matchWakeWord('هاي مساعد افتح يوتيوب');
    assert.equal(arWake.matched, true);
    assert.equal(arWake.trailingText, 'افتح يوتيوب');

    const enWake = matchWakeWord('Hey Assistant explain gravity');
    assert.equal(enWake.matched, true);
    assert.equal(enWake.trailingText, 'explain gravity');

    const nexoraWake = matchWakeWord('يا NEXORA احسب 10 + 20');
    assert.equal(nexoraWake.matched, true);
    assert.equal(nexoraWake.trailingText, 'احسب 10 + 20');
  });

  test('6. Direct app opening works without repeated confirmation for standard apps, keeps confirmation for sensitive actions', () => {
    const ytCmd = detectDeviceControlCommand('افتح يوتيوب', 'android');
    assert.ok(ytCmd);
    assert.equal(ytCmd.matchedAppId, 'youtube');
    assert.equal(ytCmd.requiresConfirmation, false);
    assert.equal(ytCmd.autoLaunchRecommended, true);

    const browserCmd = detectDeviceControlCommand('افتح المتصفح', 'web');
    assert.ok(browserCmd);
    assert.equal(browserCmd.matchedAppId, 'browser');
    assert.equal(browserCmd.requiresConfirmation, false);
    assert.equal(browserCmd.autoLaunchRecommended, true);

    const settingsCmd = detectDeviceControlCommand('افتح الإعدادات', 'windows');
    assert.ok(settingsCmd);
    assert.equal(settingsCmd.matchedAppId, 'settings');
    assert.equal(settingsCmd.windowsProtocol, 'ms-settings:');
    assert.equal(settingsCmd.requiresConfirmation, false);

    const cameraCmd = detectDeviceControlCommand('افتح الكاميرا', 'android');
    assert.ok(cameraCmd);
    assert.equal(cameraCmd.matchedAppId, 'camera');
    assert.equal(cameraCmd.requiresConfirmation, true);

    const unknownCmd = detectDeviceControlCommand('افتح التطبيق الذي اسمه غير_موجود_ابدا', 'web');
    assert.ok(unknownCmd);
    assert.equal(unknownCmd.supportedOnCurrentPlatform, false);
  });

  test('7. Extensible tools registry computes math, saves tasks, analyzes attachments, and enforces memory consent', async () => {
    const tools = listRegisteredTools();
    assert.ok(tools.length >= 14);

    const calc = evaluateSafeMathExpression('احسب (48 * 15) + 360 / 12');
    assert.equal(calc.matched, true);
    assert.equal(calc.result, 750);

    // Without memory consent, remember_preference refuses saving
    saveAppSettings({ memoryConsentGranted: false });
    const blockedPref = await runMatchedTools({
      query: 'تذكر أنني أفضل TypeScript',
      memoryConsentGranted: false,
    });
    assert.ok(blockedPref.traces.some((t) => t.toolId === 'remember_preference' && !t.success));

    // With explicit memory consent, remember_preference saves
    saveAppSettings({ memoryConsentGranted: true });
    const savedPref = await runMatchedTools({
      query: 'تذكر أنني أفضل TypeScript',
      memoryConsentGranted: true,
    });
    assert.ok(savedPref.traces.some((t) => t.toolId === 'remember_preference' && t.success));

    // Document analyzer processes attached file
    const docOut = await runMatchedTools({
      query: 'حلل هذا الملف',
      attachments: [
        { fileName: 'notes.txt', mimeType: 'text/plain', contentText: 'NEXORA architecture note line 1\nline 2' },
      ],
      memoryConsentGranted: false,
    });
    assert.ok(docOut.combinedContext.includes('notes.txt'));
  });

  test('8. SSRF URL validator blocks localhost and private IP ranges', () => {
    assert.equal(validateExternalUrl('https://en.wikipedia.org/wiki/Physics'), true);
    assert.equal(validateExternalUrl('http://en.wikipedia.org/wiki/Physics'), false);
    assert.equal(validateExternalUrl('https://127.0.0.1/admin'), false);
    assert.equal(validateExternalUrl('https://169.254.169.254/latest/meta-data'), false);
    assert.equal(validateExternalUrl('https://192.168.1.1/router'), false);
  });

  test('9. Real batch harvester ingests verified records from Wikipedia API and persists progress', async () => {
    const job = createBatchJob('science', 15, 'wikipedia');
    const updated = await runBatchStep(job.id, 1);
    assert.ok(updated.processed_count > 0);
    assert.ok(updated.inserted_count >= 5);
    const stats = getKnowledgeStats();
    assert.ok(stats.totalRecords >= 30);
  });

  test('10. Express API hides KB from unauthenticated users & enforces Admin password protection', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter());

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Public health must NOT leak knowledgeTotal
      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthJson = (await healthRes.json()) as Record<string, unknown>;
      assert.equal(healthRes.status, 200);
      assert.equal('knowledgeTotal' in healthJson, false);

      // Knowledge Base & System Status MUST return 401 without Admin Bearer token
      const unauthStats = await fetch(`${baseUrl}/api/knowledge/stats`);
      assert.equal(unauthStats.status, 401);
      const unauthSys = await fetch(`${baseUrl}/api/system/status`);
      assert.equal(unauthSys.status, 401);

      // Claim initial admin password
      const claimRes = await fetch(`${baseUrl}/api/admin/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'nexora-admin-2026' }),
      });
      assert.equal(claimRes.status, 201);
      const { token } = (await claimRes.json()) as { token: string };
      assert.ok(token.length > 20);

      // Wrong password rejected
      const badLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: 'wrong-pass' }),
      });
      assert.equal(badLogin.status, 401);

      // Authenticated admin accesses Knowledge Base & System Status
      const authSys = await fetch(`${baseUrl}/api/system/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(authSys.status, 200);
      const sysJson = (await authSys.json()) as {
        imageGenerationEnabled: boolean;
        knowledgeStats: { totalRecords: number };
      };
      assert.equal(sysJson.imageGenerationEnabled, false);
      assert.ok(sysJson.knowledgeStats.totalRecords >= 30);

      // Regular user chat hides internal KB records completely
      const chatRes = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'ما هي مبرهنة فيثاغورس؟',
          settingsOverride: { enableExternalSearch: false },
        }),
      });
      assert.equal(chatRes.status, 200);
      const chatJson = (await chatRes.json()) as {
        assistantMessage: {
          content: string;
          metadata: Record<string, unknown>;
        };
      };
      assert.ok(chatJson.assistantMessage.content.length > 20);
      assert.equal('kbSources' in chatJson.assistantMessage.metadata, false);
      assert.equal('selectedSections' in chatJson.assistantMessage.metadata, false);
      assert.equal('internalUsedKbCount' in chatJson.assistantMessage.metadata, false);
    } finally {
      server.close();
    }
  });
});

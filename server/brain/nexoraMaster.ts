import { KNOWLEDGE_SECTIONS, PERSONALITY_STYLES } from '../../src/shared/constants.ts';
import { SUPPORTED_APPS } from '../../src/shared/supportedApps.ts';
import type {
  AIProviderId,
  AppLanguage,
  AppSettings,
  AttachedDocumentInput,
  ChatSourceWeb,
  DeviceControlCommand,
  KnowledgeRecord,
  KnowledgeSectionId,
  MasterResponsePayload,
  PersonalityStyleId,
  ToolExecutionTrace,
} from '../../src/shared/types.ts';
import { getAppSettings } from '../db/database.ts';
import { searchKnowledgeRecords } from '../knowledge/repository.ts';
import { generateWithProviders } from '../providers/manager.ts';
import { runExternalSearch } from '../search/externalSearch.ts';
import { runMatchedTools } from '../tools/registry.ts';

const SECTION_KEYWORDS: Record<KnowledgeSectionId, string[]> = {
  science: [
    'فيزياء', 'كيمياء', 'رياضيات', 'أحياء', 'فلك', 'طاقة', 'بيئة', 'ذرة', 'نسبية', 'نيوتن', 'جاذبية', 'بناء ضوئي', 'فيثاغورس',
    'physics', 'chemistry', 'math', 'biology', 'astronomy', 'earth', 'energy', 'quantum', 'relativity', 'atom', 'molecule', 'theorem',
  ],
  programming: [
    'برمجة', 'كود', 'تطبيق', 'موقع', 'أندرويد', 'لعبة', 'ألعاب', 'قاعدة بيانات', 'شبكة', 'أمن', 'ذكاء اصطناعي', 'جافاسكريبت', 'بايثون', 'تايب سكريبت',
    'code', 'programming', 'typescript', 'javascript', 'python', 'c++', 'android', 'unity', 'unreal', 'godot', 'database', 'sql', 'sqlite', 'network', 'ai', 'cybersecurity', 'bug', 'error', 'react', 'vite', 'express',
  ],
  medicine: [
    'طب', 'مرض', 'أمراض', 'دواء', 'أدوية', 'مناعة', 'قلب', 'دم', 'تحليل', 'تغذية', 'فيتامين', 'أعراض', 'جسم', 'تشريح', 'علاج', 'صحة', 'صداع', 'ضغط', 'سكري',
    'medicine', 'medical', 'disease', 'drug', 'pharmacology', 'immune', 'heart', 'blood', 'cbc', 'nutrition', 'anatomy', 'physiology', 'symptom', 'diagnosis', 'health', 'doctor',
  ],
  history_culture: [
    'تاريخ', 'حضارة', 'جغرافيا', 'دولة', 'مدينة', 'لغة', 'ثقافة', 'اكتشاف', 'نيل', 'بغداد', 'مصر', 'حرب', 'قديم', 'عباسي', 'رافدين',
    'history', 'civilization', 'geography', 'country', 'city', 'culture', 'language', 'ancient', 'modern', 'discovery', 'empire', 'war',
  ],
  logic_creativity: [
    'منطق', 'استدلال', 'تفكير', 'تحليل', 'إبداع', 'ابتكار', 'خطة', 'تخطيط', 'قرار', 'حل مشكلة', 'كتابة', 'سيناريو', 'انحياز', 'مبادئ أولى', 'المنهج العلمي', 'منهج علمي', 'تفكير علمي',
    'logic', 'reasoning', 'critical', 'thinking', 'problem', 'creativity', 'innovation', 'planning', 'decision', 'writing', 'scenario', 'fallacy', 'bias', 'scientific method',
  ],
};

export function detectLanguage(text: string, fallback: AppLanguage = 'ar'): AppLanguage {
  const arMatches = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const enMatches = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (arMatches > enMatches) return 'ar';
  if (enMatches > arMatches) return 'en';
  return fallback;
}

export function classifySections(query: string): KnowledgeSectionId[] {
  const lower = query.toLowerCase();
  const scores: Array<{ id: KnowledgeSectionId; score: number }> = [];

  for (const section of KNOWLEDGE_SECTIONS) {
    const terms = SECTION_KEYWORDS[section.id];
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      scores.push({ id: section.id, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  if (scores.length > 0) {
    return scores.slice(0, 3).map((s) => s.id);
  }
  return ['science', 'programming', 'medicine', 'history_culture', 'logic_creativity'];
}

export function detectDeviceControlCommand(
  query: string,
  platform: DeviceControlCommand['targetPlatform'] = 'web'
): DeviceControlCommand | null {
  const trimmed = query.trim();
  const arOpenMatch = trimmed.match(
    /^(?:افتح|شغّل|شغل|فتح)\s+(?:لي\s+)?(?:التطبيق\s+الذي\s+اسمه\s+|البرنامج\s+الذي\s+اسمه\s+|تطبيق\s+|برنامج\s+)?(.+)$/i
  );
  const enOpenMatch = trimmed.match(
    /^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+named\s+|app\s+called\s+|app\s+)?(.+)$/i
  );

  const rawTarget = (arOpenMatch?.[1] ?? enOpenMatch?.[1])?.trim();
  if (!rawTarget) return null;

  const cleanTarget = rawTarget
    .replace(/^(?:ال)?(?:برنامج|تطبيق)\s+/i, '')
    .replace(/[.!?؟]+$/, '')
    .trim();

  const lowerTarget = cleanTarget.toLowerCase();
  const matched = SUPPORTED_APPS.find((app) =>
    app.aliases.some(
      (alias) => lowerTarget === alias.toLowerCase() || lowerTarget.includes(alias.toLowerCase())
    )
  );

  if (!matched) {
    return {
      detected: true,
      action: 'open_app',
      rawQuery: trimmed,
      extractedAppName: cleanTarget,
      matchedAppId: null,
      matchedAppLabel: null,
      targetPlatform: platform,
      supportedOnCurrentPlatform: false,
      requiresConfirmation: false,
      autoLaunchRecommended: false,
      launchUri: null,
      androidPackage: null,
      androidIntentUri: null,
      windowsProtocol: null,
      messageAr: `التطبيق "${cleanTarget}" غير مثبت أو غير مدرج ضمن التطبيقات المتاحة للتشغيل على هذه المنصة.`,
      messageEn: `"${cleanTarget}" is not installed or is not in the supported applications catalog for this platform.`,
    };
  }

  let launchUri: string | null = null;
  let supported = false;

  if (platform === 'android') {
    launchUri = matched.androidIntentUri ?? matched.webFallbackUrl ?? null;
    supported = Boolean(matched.androidPackage || launchUri);
  } else if (platform === 'windows') {
    launchUri = matched.windowsProtocol ?? matched.webFallbackUrl ?? null;
    supported = Boolean(launchUri);
  } else if (platform === 'macos') {
    launchUri = matched.macosScheme ?? matched.webFallbackUrl ?? null;
    supported = Boolean(launchUri);
  } else {
    launchUri = matched.webFallbackUrl ?? matched.windowsProtocol ?? null;
    supported = Boolean(launchUri);
  }

  const needsConfirm = matched.sensitive;
  const autoLaunch = supported && !needsConfirm;

  return {
    detected: true,
    action: matched.category === 'system' ? 'system_setting' : 'open_app',
    rawQuery: trimmed,
    extractedAppName: cleanTarget,
    matchedAppId: matched.id,
    matchedAppLabel: matched.labelAr,
    targetPlatform: platform,
    supportedOnCurrentPlatform: supported,
    requiresConfirmation: needsConfirm,
    autoLaunchRecommended: autoLaunch,
    launchUri,
    androidPackage: matched.androidPackage ?? null,
    androidIntentUri: matched.androidIntentUri ?? null,
    windowsProtocol: matched.windowsProtocol ?? null,
    messageAr: !supported
      ? `التطبيق "${matched.labelAr}" غير متاح للتشغيل المباشر على منصة ${platform} من بيئة الويب.`
      : needsConfirm
      ? `يتطلب فتح "${matched.labelAr}" تأكيدك لأن هذا الإجراء يمس صلاحية حساسة بالجهاز.`
      : `جاري فتح "${matched.labelAr}" (${matched.labelEn})...`,
    messageEn: !supported
      ? `"${matched.labelEn}" cannot be launched directly from a web sandbox on ${platform}.`
      : needsConfirm
      ? `Opening "${matched.labelEn}" requires confirmation because it accesses a sensitive device capability.`
      : `Launching "${matched.labelEn}"...`,
  };
}

function buildOfflineMasterSynthesis(
  query: string,
  lang: AppLanguage,
  style: PersonalityStyleId,
  kbRecords: KnowledgeRecord[],
  webResults: ChatSourceWeb[],
  toolTraces: ToolExecutionTrace[],
  toolContext: string,
  includeMedicalDisclaimer: boolean,
  providerNote: string | null
): string {
  const lines: string[] = [];

  // Include deterministic tool results first (e.g. Math result, Saved Task, File summary)
  const mathTrace = toolTraces.find((t) => t.toolId === 'solve_math' && t.summary.includes('='));
  const taskTrace = toolTraces.find((t) => t.toolId === 'task_planner' && t.summary.startsWith('Saved task:'));

  if (lang === 'ar') {
    if (mathTrace) {
      lines.push(`النتيجة الحسابية الدقيقة: **${mathTrace.summary}**`);
    }
    if (taskTrace) {
      lines.push(`تم حفظ المهمة بنجاح: **${taskTrace.summary.replace('Saved task: ', '')}**`);
    }
    if (toolContext.includes('[Tool: Attached Files Context]')) {
      lines.push(`تم تحليل المستند المرفق بنجاح.`);
    }

    if (kbRecords.length > 0) {
      lines.push('');
      for (const rec of kbRecords.slice(0, 3)) {
        const body = style === 'simple' ? rec.simple_explanation : rec.detailed_content;
        lines.push(`**${rec.title}**\n${body}`);
      }
    } else if (!mathTrace && !taskTrace && webResults.length === 0) {
      lines.push(
        `حاليًا مزود الذكاء الاصطناعي السحابي غير مفعّل لإنتاج إجابة موسعة حول "${query}". يمكنك تفعيل البحث الخارجي أو ضبط مزود الذكاء الاصطناعي على الخادم للحصول على تحليل متكامل.`
      );
      if (providerNote) {
        lines.push(`تفاصيل الحالة: ${providerNote}`);
      }
    }

    if (webResults.length > 0) {
      lines.push(`\n**ملخص نتائج البحث الخارجي:**`);
      for (const w of webResults.slice(0, 3)) {
        lines.push(`- ${w.title} (${w.sourceName})`);
      }
    }

    if (includeMedicalDisclaimer) {
      lines.push(
        `\nتنبيه طبي: هذه المعلومات للتثقيف العلمي فقط ولا تُعد تشخيصًا شخصيًا أو وصفة علاجية؛ يُرجى مراجعة الطبيب المختص.`
      );
    }
  } else {
    if (mathTrace) {
      lines.push(`Exact Calculation Result: **${mathTrace.summary}**`);
    }
    if (taskTrace) {
      lines.push(`Task saved: **${taskTrace.summary.replace('Saved task: ', '')}**`);
    }

    if (kbRecords.length > 0) {
      lines.push('');
      for (const rec of kbRecords.slice(0, 3)) {
        const body = style === 'simple' ? rec.simple_explanation : rec.detailed_content;
        lines.push(`**${rec.title}**\n${body}`);
      }
    } else if (!mathTrace && !taskTrace && webResults.length === 0) {
      lines.push(
        `No cloud AI provider is currently configured for "${query}". Enable external search or configure a server-side AI provider for full synthesis.`
      );
      if (providerNote) {
        lines.push(`Status detail: ${providerNote}`);
      }
    }

    if (webResults.length > 0) {
      lines.push(`\n**External Web Summary:**`);
      for (const w of webResults.slice(0, 3)) {
        lines.push(`- ${w.title} (${w.sourceName})`);
      }
    }

    if (includeMedicalDisclaimer) {
      lines.push(
        `\nMedical Notice: This information is strictly educational and does not constitute personal diagnosis or treatment. Consult a licensed physician.`
      );
    }
  }

  return lines.join('\n').trim();
}

export interface RunMasterInput {
  query: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: AttachedDocumentInput[];
  settingsOverride?: Partial<AppSettings>;
  platform?: DeviceControlCommand['targetPlatform'];
}

export async function runNexoraMaster(input: RunMasterInput): Promise<MasterResponsePayload> {
  const started = Date.now();
  const settings = { ...getAppSettings(), ...input.settingsOverride };
  const lang = detectLanguage(input.query, settings.language);
  const styleId = settings.personalityStyle;
  const styleDef = PERSONALITY_STYLES.find((s) => s.id === styleId) ?? PERSONALITY_STYLES[1];

  // 1. Check Device/App Launch Command first
  const deviceCommand = detectDeviceControlCommand(input.query, input.platform ?? 'web');
  if (deviceCommand) {
    const answer = lang === 'ar' ? deviceCommand.messageAr : deviceCommand.messageEn;
    return {
      answer,
      language: lang,
      personalityStyle: styleId,
      providerUsed: 'kb_offline_synthesis',
      modelUsed: 'device-control-parser',
      toolsExecuted: [
        {
          toolId: 'app_launcher',
          toolNameAr: 'فتح التطبيقات المدعومة',
          toolNameEn: 'Supported App Launcher',
          success: deviceCommand.supportedOnCurrentPlatform,
          summary: deviceCommand.matchedAppLabel ?? deviceCommand.extractedAppName ?? 'App command',
        },
      ],
      webSources: [],
      uncertaintyLevel: 'low',
      medicalDisclaimerIncluded: false,
      deviceCommand,
      externalSearchExecuted: false,
      externalSearchError: null,
      processingMs: Date.now() - started,
      internalUsedKbCount: 0,
    };
  }

  // 2. Run Silent Background Knowledge Retrieval across internal 5 sections
  const selectedSections = classifySections(input.query);
  const isMedical = selectedSections.includes('medicine');
  const kbRecords = searchKnowledgeRecords(input.query, selectedSections, 8);

  // 3. Run Extensible Tools Pipeline
  const toolsOut = await runMatchedTools({
    query: input.query,
    attachments: input.attachments,
    memoryConsentGranted: settings.memoryConsentGranted,
  });

  // 4. External Search ONLY when needed (explicit search intent or low internal coverage without deterministic local tool match)
  let webSources: ChatSourceWeb[] = [];
  let externalSearchExecuted = false;
  let externalSearchError: string | null = null;
  let webSnippetsContext = '';

  const explicitWebSearchIntent =
    /اليوم|الآن|أحدث|2025|2026|ابحث|search|latest|recent|today|news|compare|قارن/i.test(
      input.query
    );
  const handledByDeterministicTool = toolsOut.traces.some(
    (t) =>
      t.success &&
      ['solve_math', 'task_planner', 'remember_preference', 'analyze_document'].includes(t.toolId)
  );

  const needsExternalSearch =
    settings.enableExternalSearch &&
    (explicitWebSearchIntent || (kbRecords.length < 2 && !handledByDeterministicTool));

  if (needsExternalSearch) {
    const searchReport = await runExternalSearch(input.query, lang === 'ar');
    externalSearchExecuted = searchReport.executed;
    externalSearchError = searchReport.error;
    webSources = searchReport.results.map((r) => ({
      title: r.title,
      url: r.url,
      sourceName: r.sourceName,
      publishedAt: r.publishedAt,
      reliabilityScore: r.reliabilityScore,
    }));
    if (searchReport.results.length > 0) {
      webSnippetsContext = searchReport.results
        .map(
          (r, idx) =>
            `[WEB-${idx + 1}] ${r.title} (${r.sourceName}, date=${r.publishedAt ?? 'unknown'}): ${r.snippet} | URL: ${r.url}`
        )
        .join('\n');
    }
  }

  // Internal background context (NEVER leaked as internal database/table/section details to user)
  const silentKbContext =
    kbRecords.length > 0
      ? kbRecords
          .map(
            (r) =>
              `Reference Fact (${r.title}): ${r.detailed_content}\nScope/Limits: ${r.usage_limits}`
          )
          .join('\n\n')
      : '';

  const systemInstruction = `You are NEXORA MASTER, the single unified AI assistant of NEXORA AI.

STRICT PRIVACY & ARCHITECTURE RULES:
1. NEVER mention internal databases, SQLite, tables, "5 sections", "20,000 records", record IDs, or internal knowledge base architecture to the user. Integrate background reference facts naturally as your own verified knowledge.
2. NEVER invent facts, URLs, studies, or search results.
3. Show external source links ONLY when external web sources are provided below and add value to the answer.
4. If the query touches medicine, symptoms, drugs, or personal health, clearly include an educational disclaimer advising consultation with a qualified physician.
5. Language: Respond in ${lang === 'ar' ? 'Arabic (العربية الواضحة والطبيعية)' : 'English'}.
6. Personality Style (${styleDef.nameEn} / ${styleDef.nameAr}): ${styleDef.instruction}`;

  const compositePrompt = `User Request: ${input.query}

${silentKbContext ? `--- VERIFIED BACKGROUND REFERENCE ---\n${silentKbContext}\n` : ''}
${toolsOut.combinedContext ? `--- TOOL OUTPUTS & CONTEXT ---\n${toolsOut.combinedContext}\n` : ''}
${webSnippetsContext ? `--- EXTERNAL WEB SEARCH RESULTS ---\n${webSnippetsContext}\n` : ''}

Provide one clear, cohesive, direct answer following the requested style.`;

  let answer = '';
  let providerUsed: AIProviderId | 'kb_offline_synthesis' = settings.activeProvider;
  let modelUsed = settings.activeModel;

  try {
    const genResult = await generateWithProviders({
      provider: settings.activeProvider,
      model: settings.activeModel,
      systemInstruction,
      prompt: compositePrompt,
      history: input.history,
      enableFallback: settings.enableProviderFallback,
    });
    answer = genResult.text;
    providerUsed = genResult.providerUsed;
    modelUsed = genResult.modelUsed;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    providerUsed = 'kb_offline_synthesis';
    modelUsed = 'local-synthesis';
    answer = buildOfflineMasterSynthesis(
      input.query,
      lang,
      styleId,
      kbRecords,
      webSources,
      toolsOut.traces,
      toolsOut.combinedContext,
      isMedical,
      errMsg
    );
  }

  let uncertaintyLevel: MasterResponsePayload['uncertaintyLevel'] = 'low';
  if (kbRecords.length === 0 && webSources.length === 0 && toolsOut.traces.length === 0) {
    uncertaintyLevel = 'high';
  } else if (kbRecords.length > 0 && kbRecords.every((r) => r.review_status !== 'verified')) {
    uncertaintyLevel = 'medium';
  }

  return {
    answer,
    language: lang,
    personalityStyle: styleId,
    providerUsed,
    modelUsed,
    toolsExecuted: toolsOut.traces,
    // Expose external webSources ONLY when external search actually found useful external results
    webSources: webSources.length > 0 ? webSources : [],
    uncertaintyLevel,
    medicalDisclaimerIncluded: isMedical,
    deviceCommand: null,
    externalSearchExecuted,
    externalSearchError,
    processingMs: Date.now() - started,
    internalUsedKbCount: kbRecords.length,
  };
}

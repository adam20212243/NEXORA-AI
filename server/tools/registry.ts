import crypto from 'node:crypto';
import type {
  AttachedDocumentInput,
  ToolCapabilityDescriptor,
  ToolExecutionTrace,
} from '../../src/shared/types.ts';
import {
  createUserTask,
  getAppSettings,
  listUserPreferences,
  upsertUserPreference,
} from '../db/database.ts';

export interface ToolRuntimeContext {
  query: string;
  attachments?: AttachedDocumentInput[];
  memoryConsentGranted: boolean;
}

export interface ToolExecutionOutput {
  trace: ToolExecutionTrace;
  injectedContext: string;
}

export interface NexoraRegisteredTool {
  descriptor: ToolCapabilityDescriptor;
  matches: (ctx: ToolRuntimeContext) => boolean;
  execute: (ctx: ToolRuntimeContext) => Promise<ToolExecutionOutput>;
}

const toolRegistry: NexoraRegisteredTool[] = [];

export function registerNexoraTool(tool: NexoraRegisteredTool): void {
  const existingIdx = toolRegistry.findIndex((t) => t.descriptor.id === tool.descriptor.id);
  if (existingIdx >= 0) {
    toolRegistry[existingIdx] = tool;
  } else {
    toolRegistry.push(tool);
  }
}

export function listRegisteredTools(): ToolCapabilityDescriptor[] {
  return toolRegistry.map((t) => t.descriptor);
}

/**
 * Safe deterministic arithmetic & math expression evaluator (no eval/Function).
 */
export function evaluateSafeMathExpression(rawExpr: string): {
  matched: boolean;
  expression?: string;
  result?: number;
} {
  const cleaned = rawExpr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**');

  // Extract arithmetic expressions including leading/nested parentheses like (48 * 15) + 360 / 12
  const candidateMatch = cleaned.match(
    /((?:[+-]?\s*\(*\s*-?\d+(?:\.\d+)?\s*\)*)(?:\s*(?:\*\*|[+\-*/%])\s*[+-]?\s*\(*\s*-?\d+(?:\.\d+)?\s*\)*)+)/,
  );
  if (!candidateMatch) return { matched: false };

  const expr = candidateMatch[1].trim();
  if (!/^[0-9+\-*/().%\s*]+$/.test(expr)) {
    return { matched: false };
  }

  try {
    const tokens = expr.match(/\d+(?:\.\d+)?|\*\*|[+\-*/()%]/g);
    if (!tokens || tokens.length < 3) return { matched: false };

    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];

    function parseExpr(): number {
      let left = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const right = parseTerm();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseTerm(): number {
      let left = parsePower();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = consume();
        const right = parsePower();
        if (op === '*') left *= right;
        else if (op === '/') {
          if (right === 0) throw new Error('Division by zero');
          left /= right;
        } else {
          left %= right;
        }
      }
      return left;
    }

    function parsePower(): number {
      let base = parseFactor();
      if (peek() === '**') {
        consume();
        const exp = parsePower();
        base = Math.pow(base, exp);
      }
      return base;
    }

    function parseFactor(): number {
      const tok = peek();
      if (tok === '-') {
        consume();
        return -parseFactor();
      }
      if (tok === '+') {
        consume();
        return parseFactor();
      }
      if (tok === '(') {
        consume();
        const val = parseExpr();
        if (peek() !== ')') throw new Error('Unbalanced parentheses');
        consume();
        return val;
      }
      const num = Number(consume());
      if (!Number.isFinite(num)) throw new Error('Invalid number');
      return num;
    }

    const result = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(result)) {
      return { matched: false };
    }
    return { matched: true, expression: expr, result: Number(result.toPrecision(12)) };
  } catch {
    return { matched: false };
  }
}

function initializeBuiltInTools(): void {
  if (toolRegistry.length > 0) return;

  registerNexoraTool({
    descriptor: {
      id: 'solve_math',
      category: 'math_science',
      nameAr: 'حل المسائل الرياضية',
      nameEn: 'Math Problem Solver',
      descriptionAr: 'حل العمليات الحسابية والمعادلات وشرح الخطوات الرياضية بدقة.',
      descriptionEn: 'Deterministic expression computation and step-by-step math solving.',
      samplePromptAr: 'احسب (45 * 12) + 180 / 6 واشرح الخطوات',
      samplePromptEn: 'Solve (45 * 12) + 180 / 6 step by step',
    },
    matches: (ctx) =>
      evaluateSafeMathExpression(ctx.query).matched ||
      /احسب|معادلة|جذر|تكامل|تفاضل|رياضي|calculate|solve|equation|math|derivative|integral/i.test(ctx.query),
    execute: async (ctx) => {
      const calc = evaluateSafeMathExpression(ctx.query);
      if (calc.matched) {
        return {
          trace: {
            toolId: 'solve_math',
            toolNameAr: 'حل المسائل الرياضية',
            toolNameEn: 'Math Solver',
            success: true,
            summary: `${calc.expression} = ${calc.result}`,
          },
          injectedContext: `[Tool: Deterministic Math Evaluator] Verified computation: ${calc.expression} = ${calc.result}. Show clear step-by-step explanation.`,
        };
      }
      return {
        trace: {
          toolId: 'solve_math',
          toolNameAr: 'حل المسائل الرياضية',
          toolNameEn: 'Math Solver',
          success: true,
          summary: 'Symbolic/stepwise mathematical reasoning activated.',
        },
        injectedContext: `[Tool: Math Reasoning] Solve the mathematical problem clearly step-by-step and verify units/assumptions.`,
      };
    },
  });

  registerNexoraTool({
    descriptor: {
      id: 'analyze_document',
      category: 'files',
      nameAr: 'تحليل الملفات واستخراج المعلومات',
      nameEn: 'File & Document Analysis',
      descriptionAr: 'قراءة وتحليل المستندات المرفقة (TXT, MD, CSV, JSON, Code) واستخراج البيانات الرئيسية.',
      descriptionEn: 'Parse and extract structured insights from uploaded text, markdown, CSV, JSON, and code files.',
      samplePromptAr: 'لخّص النقاط الأساسية واستخرج الجداول من الملف المرفق',
      samplePromptEn: 'Extract key entities and summarize the attached document',
    },
    matches: (ctx) =>
      (ctx.attachments?.length ?? 0) > 0 ||
      /ملف|مستند|استخرج|تقرير|document|file|extract|csv|json/i.test(ctx.query),
    execute: async (ctx) => {
      const docs = ctx.attachments ?? [];
      if (docs.length === 0) {
        return {
          trace: {
            toolId: 'analyze_document',
            toolNameAr: 'تحليل الملفات',
            toolNameEn: 'Document Analysis',
            success: true,
            summary: 'Ready to analyze pasted or attached text/document content.',
          },
          injectedContext: '[Tool: Document Analyzer] Extract structured facts and key points cleanly.',
        };
      }
      const snippets = docs
        .map((d, i) => {
          const lines = d.contentText.split('\n').length;
          const chars = d.contentText.length;
          return `[Attached File ${i + 1}: ${d.fileName} (${d.mimeType}, ${lines} lines, ${chars} chars)]\n${d.contentText.slice(0, 6000)}`;
        })
        .join('\n\n');

      return {
        trace: {
          toolId: 'analyze_document',
          toolNameAr: 'تحليل الملفات واستخراج المعلومات',
          toolNameEn: 'File & Document Analysis',
          success: true,
          summary: `Analyzed ${docs.length} attached file(s): ${docs.map((d) => d.fileName).join(', ')}`,
        },
        injectedContext: `[Tool: Attached Files Context]\n${snippets}`,
      };
    },
  });

  registerNexoraTool({
    descriptor: {
      id: 'task_planner',
      category: 'productivity',
      nameAr: 'تنظيم المهام والخطط',
      nameEn: 'Task & Plan Organizer',
      descriptionAr: 'إنشاء مهام محفوظة وجداول زمنية منظمة وخطط عمل قابلة للتنفيذ.',
      descriptionEn: 'Create persisted tasks, action plans, and structured schedules.',
      samplePromptAr: 'أضف مهمة: مراجعة بنية المشروع وتجهيز خطة إطلاق خلال أسبوع',
      samplePromptEn: 'Add task: Prepare weekly product launch checklist',
    },
    matches: (ctx) =>
      /أضف مهمة|مهمة جديدة|نظّم خطة|خطة عمل|جدول مهام|add task|create task|task plan|roadmap/i.test(
        ctx.query
      ),
    execute: async (ctx) => {
      const taskMatch = ctx.query.match(/(?:أضف مهمة|مهمة جديدة|add task|create task)\s*[:：-]?\s*(.+)$/i);
      if (taskMatch && taskMatch[1]) {
        const title = taskMatch[1].trim().slice(0, 140);
        const created = createUserTask({
          id: `task_${crypto.randomUUID().slice(0, 10)}`,
          title,
          notes: 'Created via NEXORA MASTER',
          status: 'todo',
          priority: 'medium',
        });
        return {
          trace: {
            toolId: 'task_planner',
            toolNameAr: 'تنظيم المهام والخطط',
            toolNameEn: 'Task & Plan Organizer',
            success: true,
            summary: `Saved task: ${created.title}`,
          },
          injectedContext: `[Tool: Task Saved] A new task "${created.title}" has been saved to the user's task list. Confirm and offer a concise breakdown.`,
        };
      }
      return {
        trace: {
          toolId: 'task_planner',
          toolNameAr: 'تنظيم المهام والخطط',
          toolNameEn: 'Task & Plan Organizer',
          success: true,
          summary: 'Structured planning framework applied.',
        },
        injectedContext: '[Tool: Task & Plan Organizer] Produce a concrete phased plan with priorities and milestones.',
      };
    },
  });

  registerNexoraTool({
    descriptor: {
      id: 'remember_preference',
      category: 'productivity',
      nameAr: 'تذكر التفضيلات بإذن المستخدم',
      nameEn: 'Consented Preference Memory',
      descriptionAr: 'حفظ تفضيلات المستخدم وتخصيص الإجابات فقط بعد موافقته الصريحة.',
      descriptionEn: 'Remember user preferences strictly with explicit user consent.',
      samplePromptAr: 'تذكّر أنني أفضل الأمثلة بلغة TypeScript',
      samplePromptEn: 'Remember that I prefer concise TypeScript examples',
    },
    matches: (ctx) =>
      /تذكر أن|تذكّر أن|احفظ تفضيل|remember that|save preference/i.test(ctx.query) ||
      ctx.memoryConsentGranted,
    execute: async (ctx) => {
      const settings = getAppSettings();
      const saveReq = ctx.query.match(
        /(?:تذكر أن(?:ني)?|تذكّر أن(?:ني)?|remember that(?:\s+i)?)\s+(.+)$/i
      );

      if (saveReq && saveReq[1]) {
        if (!settings.memoryConsentGranted) {
          return {
            trace: {
              toolId: 'remember_preference',
              toolNameAr: 'تذكر التفضيلات بإذن المستخدم',
              toolNameEn: 'Preference Memory',
              success: false,
              summary: 'Consent required before saving preferences.',
            },
            injectedContext:
              '[Tool: Preference Memory Guard] The user asked to remember a preference, but memoryConsentGranted is currently OFF. Politely ask the user to enable Preference Memory Consent in Settings before saving.',
          };
        }
        const value = saveReq[1].trim().slice(0, 200);
        const key = `pref_${crypto.createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 8)}`;
        upsertUserPreference(`up_${crypto.randomUUID().slice(0, 10)}`, key, value);
        return {
          trace: {
            toolId: 'remember_preference',
            toolNameAr: 'تذكر التفضيلات بإذن المستخدم',
            toolNameEn: 'Preference Memory',
            success: true,
            summary: `Saved consented preference: ${value}`,
          },
          injectedContext: `[Tool: Preference Saved] Saved preference "${value}" with explicit user consent.`,
        };
      }

      const prefs = settings.memoryConsentGranted ? listUserPreferences() : [];
      if (prefs.length === 0) {
        return {
          trace: {
            toolId: 'remember_preference',
            toolNameAr: 'تذكر التفضيلات',
            toolNameEn: 'Preference Memory',
            success: true,
            summary: 'No consented preferences stored.',
          },
          injectedContext: '',
        };
      }
      return {
        trace: {
          toolId: 'remember_preference',
          toolNameAr: 'تذكر التفضيلات',
          toolNameEn: 'Preference Memory',
          success: true,
          summary: `Loaded ${prefs.length} consented preference(s).`,
        },
        injectedContext: `[Consented User Preferences]\n${prefs.map((p) => `- ${p.value}`).join('\n')}`,
      };
    },
  });

  // Declarative specialized reasoning & productivity tools inside NEXORA MASTER
  const declarativeTools: Array<{
    descriptor: ToolCapabilityDescriptor;
    pattern: RegExp;
    instruction: string;
  }> = [
    {
      descriptor: {
        id: 'summarize_text',
        category: 'writing',
        nameAr: 'تلخيص النصوص والمقالات',
        nameEn: 'Text & Article Summarizer',
        descriptionAr: 'استخلاص الأفكار الجوهرية من المقالات والنصوص الطويلة بدقة.',
        descriptionEn: 'Condense articles and long prose into structured key takeaways.',
        samplePromptAr: 'لخّص النص التالي في 5 نقاط مركزة',
        samplePromptEn: 'Summarize the following article into 5 clear takeaways',
      },
      pattern: /لخص|لخّص|تلخيص|اختصر|summarize|summary|tl;dr/i,
      instruction: '[Tool: Text Summarizer] Produce a concise hierarchical summary preserving factual accuracy.',
    },
    {
      descriptor: {
        id: 'translate_text',
        category: 'writing',
        nameAr: 'الترجمة بين اللغات',
        nameEn: 'Multilingual Translator',
        descriptionAr: 'ترجمة دقيقة تراعي السياق والمصطلحات العلمية والتقنية.',
        descriptionEn: 'Context-aware translation preserving technical and domain terminology.',
        samplePromptAr: 'ترجم هذه الفقرة إلى الإنجليزية بأسلوب احترافي',
        samplePromptEn: 'Translate this paragraph to Arabic accurately',
      },
      pattern: /ترجم|ترجمة|translate|translation/i,
      instruction: '[Tool: Translator] Translate faithfully while preserving technical terminology and nuance.',
    },
    {
      descriptor: {
        id: 'educational_explain',
        category: 'math_science',
        nameAr: 'الشرح التعليمي المتدرج',
        nameEn: 'Educational Tutor',
        descriptionAr: 'تبسيط المفاهيم خطوة بخطوة مع أمثلة تطبيقية وأسئلة مراجعة.',
        descriptionEn: 'Stepwise pedagogical explanations with worked examples.',
        samplePromptAr: 'اشرح لي كيف تعمل الشبكات العصبية بأسلوب تعليمي مبسط',
        samplePromptEn: 'Teach me how neural networks work step by step',
      },
      pattern: /اشرح|علّمني|علمني|فسّر|فسر|تبسيط|explain|teach|how does/i,
      instruction: '[Tool: Educational Tutor] Teach progressively from core intuition to structured detail with clear examples.',
    },
    {
      descriptor: {
        id: 'analyze_code',
        category: 'coding',
        nameAr: 'تحليل الأكواد البرمجية',
        nameEn: 'Code Analyzer',
        descriptionAr: 'مراجعة جودة الكود، البنية، التعقيد الزمني، والمخاطر الأمنية.',
        descriptionEn: 'Inspect code quality, architecture, complexity, and security pitfalls.',
        samplePromptAr: 'حلّل هذا الكود واكتشف نقاط الضعف أو التحسين',
        samplePromptEn: 'Analyze this TypeScript function for bugs and complexity',
      },
      pattern: /حلل الكود|حلّل الكود|مراجعة الكود|analyze code|code review|refactor/i,
      instruction: '[Tool: Code Analyzer] Analyze control flow, edge cases, performance, and security defects.',
    },
    {
      descriptor: {
        id: 'write_debug_code',
        category: 'coding',
        nameAr: 'كتابة وتصحيح البرامج',
        nameEn: 'Code Writer & Debugger',
        descriptionAr: 'كتابة أكواد نظيفة وتشخيص الأخطاء البرمجية واقتراح حلول عملية.',
        descriptionEn: 'Generate clean code and diagnose stack traces or runtime bugs.',
        samplePromptAr: 'اكتب دالة TypeScript للتحقق من صحة البيانات وعالج الأخطاء',
        samplePromptEn: 'Debug this async error and write a clean fix',
      },
      pattern: /اكتب كود|صحح الكود|برمجة|خطأ برمجي|debug|fix bug|write code|typescript|python|javascript|c\+\+/i,
      instruction: '[Tool: Software Engineer] Provide clean, runnable code and explain the root cause of any bug.',
    },
    {
      descriptor: {
        id: 'game_dev_assist',
        category: 'coding',
        nameAr: 'المساعدة في تطوير الألعاب',
        nameEn: 'Game Development Assistant',
        descriptionAr: 'دعم Unity وUnreal Engine وGodot وهندسة الألعاب والفيزياء.',
        descriptionEn: 'Guidance for Unity, Unreal Engine, Godot, game loops, physics, and shaders.',
        samplePromptAr: 'كيف أنفذ نظام حركة شخصية 2D متجاوب في Godot؟',
        samplePromptEn: 'Compare Unity vs Godot for a 2D mobile platformer',
      },
      pattern: /تطوير الألعاب|لعبة|unity|unreal|godot|game dev|gamedev|shader/i,
      instruction: '[Tool: Game Dev Architect] Provide engine-specific architecture, frame-rate, and input/physics guidance.',
    },
    {
      descriptor: {
        id: 'draft_document',
        category: 'writing',
        nameAr: 'كتابة المستندات والرسائل',
        nameEn: 'Document & Message Drafter',
        descriptionAr: 'صياغة رسائل رسمية، تقارير، مقترحات مشاريع، ومستندات منظمة.',
        descriptionEn: 'Draft formal emails, proposals, executive reports, and structured docs.',
        samplePromptAr: 'اكتب رسالة بريد إلكتروني رسمية لطلب اجتماع عمل',
        samplePromptEn: 'Draft a formal project proposal email',
      },
      pattern: /اكتب رسالة|صياغة|اكتب مستند|بريد إلكتروني|تقرير رسمي|draft|write email|write a letter|proposal/i,
      instruction: '[Tool: Document Drafter] Draft a well-structured, ready-to-send document matching the requested tone.',
    },
    {
      descriptor: {
        id: 'compare_items',
        category: 'research',
        nameAr: 'المقارنة بين المنتجات والمعلومات',
        nameEn: 'Structured Comparator',
        descriptionAr: 'مقارنة موضوعية بالمعايير والمزايا والعيوب في جدول واضح.',
        descriptionEn: 'Objective multi-criteria comparison tables highlighting trade-offs.',
        samplePromptAr: 'قارن بين SQLite وPostgreSQL لمشاريع الويب المتوسطة',
        samplePromptEn: 'Compare SQLite vs PostgreSQL with pros, cons, and use cases',
      },
      pattern: /قارن|مقارنة|الفرق بين|أيهما أفضل|compare|comparison|vs\b|versus|difference between/i,
      instruction: '[Tool: Structured Comparator] Present a balanced, criteria-based comparison table with clear trade-offs.',
    },
    {
      descriptor: {
        id: 'web_search',
        category: 'research',
        nameAr: 'البحث الذكي على الإنترنت',
        nameEn: 'Smart Web Search',
        descriptionAr: 'البحث في المصادر الموثوقة ومقارنة المعلومات وعرض الروابط عند الحاجة.',
        descriptionEn: 'Live authorized web search with cross-source verification and links.',
        samplePromptAr: 'ابحث عن أحدث تطورات الذكاء الاصطناعي مع المصادر',
        samplePromptEn: 'Search for the latest verified developments with sources',
      },
      pattern: /ابحث|بحث|مصادر|أحدث|2025|2026|search|latest|news/i,
      instruction: '[Tool: Smart Web Search] Cross-check external search results and cite verified URLs.',
    },
    {
      descriptor: {
        id: 'science_qa',
        category: 'math_science',
        nameAr: 'الإجابة عن الأسئلة العلمية',
        nameEn: 'Scientific Q&A',
        descriptionAr: 'تحليل الأسئلة الفيزيائية والكيميائية والحيوية بدقة علمية.',
        descriptionEn: 'Rigorous answers across physics, chemistry, biology, and astronomy.',
        samplePromptAr: 'لماذا السماء زرقاء علميًا وما حدود تشتت رايلي؟',
        samplePromptEn: 'Explain Rayleigh scattering and its physical limits',
      },
      pattern: /فيزياء|كيمياء|أحياء|علمي|ذرة|طاقة|فلك|physics|chemistry|biology|science/i,
      instruction: '[Tool: Scientific Analyst] Provide accurate scientific explanation citing principles and scope limits.',
    },
    {
      descriptor: {
        id: 'voice_suite',
        category: 'voice_device',
        nameAr: 'المحادثة الصوتية والتنبيه الصوتي',
        nameEn: 'Voice STT, TTS & Wake Word',
        descriptionAr: 'إدخال صوتي بالعربية والإنجليزية، قراءة طبيعية للردود، وتنبيه صوتي.',
        descriptionEn: 'Bilingual speech recognition, natural TTS reading, and opt-in wake word.',
        samplePromptAr: 'اضغط على زر الميكروفون وتحدث مباشرة بالعربية أو الإنجليزية',
        samplePromptEn: 'Press the microphone button to speak in Arabic or English',
      },
      pattern: /صوت|ميكروفون|اقرأ|voice|speak|microphone/i,
      instruction: '',
    },
    {
      descriptor: {
        id: 'app_launcher',
        category: 'voice_device',
        nameAr: 'فتح التطبيقات المدعومة',
        nameEn: 'Supported App Launcher',
        descriptionAr: 'تشغيل التطبيقات المدعومة مباشرة بالأوامر الصوتية أو النصية.',
        descriptionEn: 'Launch supported apps directly via voice or text commands.',
        samplePromptAr: 'افتح يوتيوب',
        samplePromptEn: 'Open YouTube',
      },
      pattern: /افتح|شغل|open\s+|launch\s+/i,
      instruction: '',
    },
    {
      descriptor: {
        id: 'conversation_history',
        category: 'productivity',
        nameAr: 'إدارة سجل المحادثات',
        nameEn: 'Conversation History',
        descriptionAr: 'حفظ وتصفح وحذف المحادثات السابقة بأمان.',
        descriptionEn: 'Persist, revisit, and manage past conversations.',
        samplePromptAr: 'اعرض قائمة المحادثات السابقة من الشريط الجانبي',
        samplePromptEn: 'Switch between saved conversations in the sidebar',
      },
      pattern: /محادثة سابقة|سجل المحادثات|history/i,
      instruction: '',
    },
  ];

  for (const item of declarativeTools) {
    registerNexoraTool({
      descriptor: item.descriptor,
      matches: (ctx) => item.pattern.test(ctx.query),
      execute: async () => ({
        trace: {
          toolId: item.descriptor.id,
          toolNameAr: item.descriptor.nameAr,
          toolNameEn: item.descriptor.nameEn,
          success: true,
          summary: item.descriptor.nameEn,
        },
        injectedContext: item.instruction,
      }),
    });
  }
}

initializeBuiltInTools();

export async function runMatchedTools(ctx: ToolRuntimeContext): Promise<{
  traces: ToolExecutionTrace[];
  combinedContext: string;
}> {
  const matched = toolRegistry.filter((t) => t.matches(ctx));
  const traces: ToolExecutionTrace[] = [];
  const contexts: string[] = [];

  for (const tool of matched) {
    try {
      const out = await tool.execute(ctx);
      if (out.trace) traces.push(out.trace);
      if (out.injectedContext) contexts.push(out.injectedContext);
    } catch (err) {
      traces.push({
        toolId: tool.descriptor.id,
        toolNameAr: tool.descriptor.nameAr,
        toolNameEn: tool.descriptor.nameEn,
        success: false,
        summary: err instanceof Error ? err.message : 'Tool error',
      });
    }
  }

  return {
    traces,
    combinedContext: contexts.join('\n\n'),
  };
}

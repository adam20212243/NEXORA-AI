import { Mic, Save, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PERSONALITY_STYLES } from '../shared/constants.ts';
import type {
  AIProviderId,
  AppLanguage,
  AppSettings,
  AppTheme,
  PersonalityStyleId,
  ProviderStatus,
} from '../shared/types.ts';
import {
  getAudioInputDevices,
  getAvailableTtsVoices,
  getMicrophonePermissionState,
  getVoiceCapabilities,
  playReadyChime,
  speakText,
  stopAllSpeech,
  testMicrophoneCapture,
  type AudioInputDeviceOption,
  type MicPermissionStatus,
} from '../services/voiceService.ts';

interface SettingsViewProps {
  settings: AppSettings;
  providers: ProviderStatus[];
  onSaveSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

export function SettingsView({
  settings,
  providers,
  onSaveSettings,
}: SettingsViewProps) {
  const isAr = settings.language === 'ar';
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [micDevices, setMicDevices] = useState<AudioInputDeviceOption[]>([]);
  const [micPermission, setMicPermission] = useState<MicPermissionStatus>('prompt');
  const [micTestResult, setMicTestResult] = useState<string | null>(null);
  const [testingMic, setTestingMic] = useState(false);
  const [speakerTestStatus, setSpeakerTestStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const voiceCaps = getVoiceCapabilities();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const refreshHardwareInfo = async () => {
    setVoices(getAvailableTtsVoices());
    setMicPermission(await getMicrophonePermissionState());
    setMicDevices(await getAudioInputDevices());
  };

  useEffect(() => {
    void refreshHardwareInfo();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const onVoices = () => setVoices(getAvailableTtsVoices());
      window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
    }
    return undefined;
  }, []);

  const selectedProviderMeta = providers.find((p) => p.id === draft.activeProvider);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveSettings(draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestMicrophone = async () => {
    setTestingMic(true);
    setMicTestResult(null);
    const res = await testMicrophoneCapture(draft.voiceInputDeviceId || undefined);
    await refreshHardwareInfo();
    setTestingMic(false);
    if (!res.ok) {
      setMicTestResult(
        isAr ? `فشل اختبار الميكروفون: ${res.error}` : `Microphone test failed: ${res.error}`
      );
    } else {
      const pct = Math.round(res.peakLevel * 100);
      setMicTestResult(
        isAr
          ? `الميكروفون يعمل! أعلى مستوى صوت ملتقط: ${pct}%`
          : `Microphone active! Peak input signal measured: ${pct}%`
      );
    }
  };

  const handleTestSpeakers = async () => {
    setSpeakerTestStatus(isAr ? 'جاري اختبار السماعات...' : 'Testing speakers...');
    playReadyChime();
    await speakText({
      text: isAr
        ? 'مرحبًا، هذا اختبار صوتي للتأكد من عمل السماعات والنطق العربي في NEXORA AI.'
        : 'Hello, this is a speaker and voice synthesis test for NEXORA AI.',
      lang: draft.language,
      rate: draft.voiceTtsRate,
      preferredVoiceName: draft.voiceTtsVoiceName,
      useServerFallback: draft.useServerTtsFallback,
      onEnd: () =>
        setSpeakerTestStatus(isAr ? 'اكتمل اختبار السماعات بنجاح.' : 'Speaker test completed.'),
      onError: (err) => setSpeakerTestStatus(err),
    });
  };

  const permLabel: Record<MicPermissionStatus, { ar: string; en: string }> = {
    granted: { ar: 'مسموح (Granted)', en: 'Granted' },
    denied: { ar: 'مرفوض (Denied)', en: 'Denied' },
    prompt: { ar: 'يتطلب موافقة عند التشغيل', en: 'Prompt on Use' },
    unsupported: { ar: 'غير مدعوم في هذه البيئة', en: 'Unsupported' },
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-6">
      <form onSubmit={handleSave} className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {isAr ? 'الإعدادات وإعدادات الصوت' : 'Settings & Voice Configuration'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {isAr
                ? 'تخصيص الشخصية، اللغة، المزود، الميكروفون، التنبيه الصوتي، واختبار الصوت.'
                : 'Configure personality style, language, AI provider, microphone, wake word, and audio tests.'}
            </p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? (isAr ? 'جاري الحفظ...' : 'Saving...') : (isAr ? 'حفظ الإعدادات' : 'Save Settings')}</span>
          </button>
        </div>

        {savedNotice && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            {isAr ? 'تم حفظ الإعدادات وتطبيقها بنجاح.' : 'Settings saved and applied.'}
          </div>
        )}

        {/* Complete Voice Settings Section */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'إعدادات الصوت والتنبيه الصوتي' : 'Voice, Wake Word & Audio Diagnostics'}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isAr ? 'حالة إذن الميكروفون:' : 'Mic Permission:'}{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {isAr ? permLabel[micPermission].ar : permLabel[micPermission].en}
              </strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? 'لغة التحدث (STT)' : 'Speech Language'}
              </label>
              <select
                value={draft.voiceSttLang}
                onChange={(e) =>
                  setDraft({ ...draft, voiceSttLang: e.target.value as 'ar-SA' | 'en-US' })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="ar-SA">العربية (ar-SA)</option>
                <option value="en-US">English (en-US)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? 'جهاز الميكروفون' : 'Microphone Device'}
              </label>
              <select
                value={draft.voiceInputDeviceId}
                onChange={(e) => setDraft({ ...draft, voiceInputDeviceId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="">{isAr ? 'الميكروفون الافتراضي للنظام' : 'System Default Mic'}</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? 'اختيار الصوت (TTS)' : 'Voice Selection'}
              </label>
              <select
                value={draft.voiceTtsVoiceName}
                onChange={(e) => setDraft({ ...draft, voiceTtsVoiceName: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              >
                <option value="">{isAr ? 'تلقائي حسب اللغة' : 'Auto by Language'}</option>
                {voices.map((v) => (
                  <option key={`${v.name}-${v.lang}`} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? `سرعة القراءة (${draft.voiceTtsRate.toFixed(1)}x)` : `Speech Rate (${draft.voiceTtsRate.toFixed(1)}x)`}
              </label>
              <input
                type="range"
                min="0.6"
                max="1.8"
                step="0.1"
                value={draft.voiceTtsRate}
                onChange={(e) => setDraft({ ...draft, voiceTtsRate: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.voiceTtsEnabled}
                onChange={(e) => setDraft({ ...draft, voiceTtsEnabled: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'تفعيل نظام قراءة الردود الصوتية (TTS)' : 'Enable Voice Responses (TTS)'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.autoSpeakResponses}
                onChange={(e) => setDraft({ ...draft, autoSpeakResponses: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'قراءة الردود تلقائيًا عند وصولها' : 'Auto-speak assistant replies'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.autoSendVoiceTranscript}
                onChange={(e) => setDraft({ ...draft, autoSendVoiceTranscript: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'إرسال النص الصوتي تلقائيًا بعد التعرف عليه' : 'Auto-send recognized speech immediately'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enableWakeWord}
                onChange={(e) => setDraft({ ...draft, enableWakeWord: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'تفعيل التنبيه الصوتي ("هاي مساعد" / "يا NEXORA")' : 'Enable Wake Word ("Hey Assistant" / "يا NEXORA")'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.useServerTtsFallback}
                onChange={(e) => setDraft({ ...draft, useServerTtsFallback: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'استخدام محرك صوت الخادم عند نقص أصوات المتصفح' : 'Server TTS fallback when browser lacks voices'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.allowBackgroundTts}
                onChange={(e) => setDraft({ ...draft, allowBackgroundTts: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>
                {isAr
                  ? `السماح باستمرار القراءة في الخلفية ${voiceCaps.androidBridgeAvailable ? '(مدعوم)' : '(محدود في المتصفح)'}`
                  : `Allow Background Audio Reading ${voiceCaps.androidBridgeAvailable ? '(Native Supported)' : '(Browser-limited)'}`}
              </span>
            </label>
          </div>

          {/* Interactive Mic & Speaker Diagnostics */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={testingMic}
              onClick={() => void handleTestMicrophone()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Mic className="w-3.5 h-3.5 text-blue-600" />
              <span>{testingMic ? (isAr ? 'جاري الاختبار...' : 'Testing Mic...') : (isAr ? 'اختبار الميكروفون' : 'Test Microphone')}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleTestSpeakers()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5 text-blue-600" />
              <span>{isAr ? 'اختبار السماعات' : 'Test Speakers'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                stopAllSpeech();
                setSpeakerTestStatus(isAr ? 'تم إيقاف الصوت.' : 'Audio stopped.');
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {isAr ? 'إيقاف الصوت' : 'Stop Audio'}
            </button>

            {micTestResult && (
              <span className="text-xs text-slate-700 dark:text-slate-300">{micTestResult}</span>
            )}
            {speakerTestStatus && (
              <span className="text-xs text-slate-700 dark:text-slate-300">{speakerTestStatus}</span>
            )}
          </div>
        </section>

        {/* 7 Personality Styles */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'أسلوب شخصية NEXORA (7 أساليب)' : 'NEXORA Personality Style (7 Modes)'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isAr
                ? 'يؤثر الأسلوب المختار على طريقة الشرح فقط ولا يغير صحة المعلومات أو معايير التحقق والسلامة.'
                : 'Selected style adjusts phrasing only—never factual accuracy or safety rules.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PERSONALITY_STYLES.map((style) => {
              const selected = draft.personalityStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, personalityStyle: style.id as PersonalityStyleId })
                  }
                  className={`text-start p-3.5 rounded-lg border transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {isAr ? style.nameAr : style.nameEn}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {isAr ? style.descriptionAr : style.descriptionEn}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Interface Language, Theme & Memory Consent */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
              {isAr ? 'لغة الواجهة والاتجاه' : 'Interface Language & Direction'}
            </label>
            <select
              value={draft.language}
              onChange={(e) => setDraft({ ...draft, language: e.target.value as AppLanguage })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
            >
              <option value="ar">العربية (RTL)</option>
              <option value="en">English (LTR)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-900 dark:text-slate-100 block">
              {isAr ? 'المظهر' : 'Theme'}
            </label>
            <select
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.target.value as AppTheme })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
            >
              <option value="light">{isAr ? 'نهاري (Light)' : 'Light'}</option>
              <option value="dark">{isAr ? 'ليلي (Dark)' : 'Dark'}</option>
            </select>
          </div>

          <div className="sm:col-span-2 pt-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.memoryConsentGranted}
                onChange={(e) => setDraft({ ...draft, memoryConsentGranted: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>
                {isAr
                  ? 'السماح بحفظ تفضيلات المستخدم الشخصية لتخصيص الردود'
                  : 'Consent to remembering personal preferences across conversations'}
              </span>
            </label>
          </div>
        </section>

        {/* AI Provider & Search Settings */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {isAr ? 'مزود الذكاء الاصطناعي والبحث الخارجي' : 'AI Provider & External Search'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? 'المزود النشط' : 'Active Provider'}
              </label>
              <select
                value={draft.activeProvider}
                onChange={(e) => {
                  const nextId = e.target.value as AIProviderId;
                  const meta = providers.find((p) => p.id === nextId);
                  setDraft({
                    ...draft,
                    activeProvider: nextId,
                    activeModel: meta?.modelDefault ?? draft.activeModel,
                  });
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {isAr ? p.nameAr : p.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                {isAr ? 'النموذج' : 'Model'}
              </label>
              <select
                value={draft.activeModel}
                onChange={(e) => setDraft({ ...draft, activeModel: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono"
              >
                {(selectedProviderMeta?.availableModels ?? [draft.activeModel]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-1 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enableExternalSearch}
                onChange={(e) => setDraft({ ...draft, enableExternalSearch: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'تفعيل البحث الخارجي الموثق عند الحاجة' : 'Enable External Search Grounding'}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enableProviderFallback}
                onChange={(e) => setDraft({ ...draft, enableProviderFallback: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>{isAr ? 'الانتقال التلقائي لمزود بديل عند الفشل' : 'Auto-fallback to backup provider'}</span>
            </label>
          </div>
        </section>
      </form>
    </div>
  );
}

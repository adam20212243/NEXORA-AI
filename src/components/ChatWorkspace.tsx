import {
  ExternalLink,
  Globe,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Radio,
  Send,
  ShieldAlert,
  Square,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PERSONALITY_STYLES } from '../shared/constants.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  DeviceControlCommand,
  PersonalityStyleId,
} from '../shared/types.ts';
import {
  detectClientPlatform,
  executeConfirmedDeviceCommand,
  type DeviceLaunchResult,
} from '../services/deviceControlService.ts';
import {
  getMicStatusLabel,
  speakText,
  startSpeechRecognitionSession,
  startWakeWordListener,
  stopAllSpeech,
  type MicStatus,
  type SttController,
  type WakeWordController,
} from '../services/voiceService.ts';

interface ChatWorkspaceProps {
  conversationId: string | null;
  settings: AppSettings;
  messages: ChatMessage[];
  sending: boolean;
  errorMsg: string | null;
  prefillText?: string;
  onConsumePrefill?: () => void;
  onDismissError: () => void;
  onSendMessage: (
    query: string,
    platform: DeviceControlCommand['targetPlatform'],
    attachments?: AttachedDocumentInput[]
  ) => Promise<void>;
  onChangePersonality: (style: PersonalityStyleId) => void;
  onToggleAutoSpeak: () => void;
  onDisableWakeWord: () => void;
}

export function ChatWorkspace({
  conversationId,
  settings,
  messages,
  sending,
  errorMsg,
  prefillText,
  onConsumePrefill,
  onDismissError,
  onSendMessage,
  onChangePersonality,
  onToggleAutoSpeak,
  onDisableWakeWord,
}: ChatWorkspaceProps) {
  const isAr = settings.language === 'ar';
  const [inputText, setInputText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [deviceResults, setDeviceResults] = useState<Record<string, DeviceLaunchResult>>({});
  const [visibilityNotice, setVisibilityNotice] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachedDocumentInput[]>([]);
  const [wakeWordError, setWakeWordError] = useState<string | null>(null);

  const sttRef = useRef<SttController | null>(null);
  const wakeRef = useRef<WakeWordController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const spokenMessageIdsRef = useRef<Set<string>>(new Set());
  const autoLaunchedIdsRef = useRef<Set<string>>(new Set());
  const prevConvIdRef = useRef<string | null>(conversationId);

  // Prefill from Tools Hub
  useEffect(() => {
    if (prefillText) {
      setInputText(prefillText);
      onConsumePrefill?.();
    }
  }, [prefillText, onConsumePrefill]);

  // Scroll to newest message
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  // Mandatory TTS Stop Rule 3 & 4 & 6: Stop TTS when switching conversation or leaving chat
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      stopAllSpeech();
      setSpeakingMessageId(null);
    }
  }, [conversationId]);

  useEffect(() => {
    return () => {
      sttRef.current?.abort();
      wakeRef.current?.stop();
      if (!settings.allowBackgroundTts) {
        stopAllSpeech();
      }
    };
  }, [settings.allowBackgroundTts]);

  // Background / Foreground visibility handler
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (micStatus === 'listening') {
          sttRef.current?.stop();
          setVisibilityNotice(
            isAr
              ? 'تم إيقاف الميكروفون عند الانتقال إلى الخلفية بسبب قيود المتصفح.'
              : 'Microphone paused in background due to browser OS constraints.'
          );
        }
        if (!settings.allowBackgroundTts && speakingMessageId) {
          stopAllSpeech();
          setSpeakingMessageId(null);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [micStatus, speakingMessageId, settings.allowBackgroundTts, isAr]);

  // Wake Word Listener (Opt-in ONLY, visible status banner)
  useEffect(() => {
    wakeRef.current?.stop();
    wakeRef.current = null;
    setWakeWordError(null);

    if (!settings.enableWakeWord || micStatus === 'listening' || sending) {
      return;
    }

    wakeRef.current = startWakeWordListener({
      lang: settings.voiceSttLang,
      onWakeWord: (trailingCommand) => {
        if (trailingCommand && trailingCommand.length >= 2) {
          void submitRecognizedQuery(trailingCommand);
        } else {
          void handleStartRecording();
        }
      },
      onError: (err) => {
        setWakeWordError(
          isAr
            ? `تعذر تشغيل التنبيه الصوتي المستمر في هذا المتصفح (${err}).`
            : `Wake word unavailable in this browser (${err}).`
        );
      },
    });

    return () => {
      wakeRef.current?.stop();
      wakeRef.current = null;
    };
  }, [settings.enableWakeWord, settings.voiceSttLang, micStatus, sending]);

  // Auto-speak new assistant responses (never reading same message twice automatically)
  useEffect(() => {
    if (!settings.voiceTtsEnabled || !settings.autoSpeakResponses || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && !spokenMessageIdsRef.current.has(last.id)) {
      spokenMessageIdsRef.current.add(last.id);
      void handleSpeakMessage(last);
    }
  }, [messages, settings.autoSpeakResponses, settings.voiceTtsEnabled]);

  // Direct execution for non-sensitive app launch commands
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    const cmd = last.metadata?.deviceCommand;
    if (
      last.role === 'assistant' &&
      cmd &&
      cmd.detected &&
      cmd.autoLaunchRecommended &&
      !autoLaunchedIdsRef.current.has(last.id)
    ) {
      autoLaunchedIdsRef.current.add(last.id);
      void executeConfirmedDeviceCommand(cmd).then((res) => {
        setDeviceResults((prev) => ({ ...prev, [last.id]: res }));
      });
    }
  }, [messages]);

  const submitRecognizedQuery = async (recognizedText: string) => {
    const clean = recognizedText.trim();
    if (!clean) return;
    setMicStatus('sending');
    setInputText('');
    setInterimText('');
    try {
      setMicStatus('awaiting_reply');
      const attachedCopy = attachments.length > 0 ? [...attachments] : undefined;
      setAttachments([]);
      await onSendMessage(clean, detectClientPlatform(), attachedCopy);
      setMicStatus('idle');
    } catch {
      setMicStatus('error');
    }
  };

  const handleStartRecording = async () => {
    setMicError(null);
    setVisibilityNotice(null);
    wakeRef.current?.stop();
    stopAllSpeech();
    setSpeakingMessageId(null);

    sttRef.current = await startSpeechRecognitionSession({
      lang: settings.voiceSttLang,
      uiLang: settings.language,
      deviceId: settings.voiceInputDeviceId || undefined,
      onStatus: (status, err) => {
        setMicStatus(status);
        if (err) setMicError(err);
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onInterim: (interim) => {
        setInterimText(interim);
      },
      onFinal: (finalTranscript) => {
        setInterimText('');
        const clean = finalTranscript.trim();
        if (!clean) {
          setMicError(
            isAr
              ? 'لم يتم التقاط كلام واضح لإرساله.'
              : 'No clear speech captured to send.'
          );
          setMicStatus('error');
          return;
        }
        if (settings.autoSendVoiceTranscript) {
          void submitRecognizedQuery(clean);
        } else {
          setInputText((prev) => (prev ? `${prev} ${clean}`.trim() : clean));
          setMicStatus('recognized');
        }
      },
    });
  };

  const handleToggleMic = async () => {
    if (micStatus === 'listening' || micStatus === 'requesting_permission') {
      sttRef.current?.stop();
      return;
    }
    await handleStartRecording();
  };

  const handleSpeakMessage = async (msg: ChatMessage) => {
    if (!settings.voiceTtsEnabled) {
      setTtsError(
        isAr
          ? 'الرد الصوتي معطل من الإعدادات حاليًا.'
          : 'Voice playback is disabled in Settings.'
      );
      return;
    }
    setTtsError(null);
    if (speakingMessageId === msg.id) {
      stopAllSpeech();
      setSpeakingMessageId(null);
      return;
    }

    const msgLang = msg.metadata?.language ?? settings.language;
    setSpeakingMessageId(msg.id);
    await speakText({
      text: msg.content,
      lang: msgLang,
      rate: settings.voiceTtsRate,
      preferredVoiceName: settings.voiceTtsVoiceName,
      useServerFallback: settings.useServerTtsFallback,
      onStart: () => setSpeakingMessageId(msg.id),
      onEnd: () => setSpeakingMessageId((curr) => (curr === msg.id ? null : curr)),
      onError: (err) => {
        setTtsError(err);
        setSpeakingMessageId(null);
      },
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: AttachedDocumentInput[] = [];
    for (const file of Array.from(files).slice(0, 3)) {
      if (file.size > 400_000) {
        setMicError(
          isAr
            ? `الملف "${file.name}" يتجاوز الحد النصي (400KB).`
            : `File "${file.name}" exceeds 400KB text limit.`
        );
        continue;
      }
      const text = await file.text();
      added.push({
        fileName: file.name,
        mimeType: file.type || 'text/plain',
        contentText: text,
      });
    }
    setAttachments((prev) => [...prev, ...added].slice(0, 3));
    e.target.value = '';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const combined = `${inputText} ${interimText}`.trim();
    if (!combined || sending) return;

    if (micStatus === 'listening') {
      sttRef.current?.abort();
    }

    setInputText('');
    setInterimText('');
    setMicStatus('idle');
    const attachedCopy = attachments.length > 0 ? [...attachments] : undefined;
    setAttachments([]);
    await onSendMessage(combined, detectClientPlatform(), attachedCopy);
  };

  const handleDeviceLaunch = async (messageId: string, cmd: DeviceControlCommand) => {
    const res = await executeConfirmedDeviceCommand(cmd);
    setDeviceResults((prev) => ({ ...prev, [messageId]: res }));
  };

  const starterPrompts = isAr
    ? [
        'اشرح لي قوانين نيوتن للحركة بطريقة مبسطة مع مثال يومي.',
        'احسب (48 * 15) + 360 / 12 واشرح خطوات الحل.',
        'افتح يوتيوب',
        'اكتب خطة منظمة لتعلم TypeScript وتطوير تطبيقات الويب.',
      ]
    : [
        'Explain Newton laws of motion clearly with an everyday example.',
        'Solve (48 * 15) + 360 / 12 step by step.',
        'Open YouTube',
        'Create a structured plan to master TypeScript web development.',
      ];

  const effectiveMicState: MicStatus = sending ? 'awaiting_reply' : micStatus;

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">NEXORA MASTER</span>
          <span aria-hidden="true">·</span>
          <span>{isAr ? 'مساعد موحد متعدد الأدوات' : 'Unified Multi-Tool Assistant'}</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap">{isAr ? 'أسلوب الرد:' : 'Style:'}</span>
            <select
              value={settings.personalityStyle}
              onChange={(e) => onChangePersonality(e.target.value as PersonalityStyleId)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PERSONALITY_STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {isAr ? style.nameAr : style.nameEn}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onToggleAutoSpeak}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              settings.autoSpeakResponses && settings.voiceTtsEnabled
                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {settings.autoSpeakResponses && settings.voiceTtsEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{isAr ? 'رد صوتي تلقائي' : 'Auto Voice'}</span>
          </button>
        </div>
      </div>

      {/* Explicit Opt-in Wake Word Transparency Banner */}
      {settings.enableWakeWord && (
        <div className="px-6 py-2 border-b border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-800 dark:text-blue-300">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>
              {isAr
                ? 'التنبيه الصوتي مفعّل (قل: "هاي مساعد" أو "يا NEXORA" أو "Hey Assistant"). يتوقف الاستماع تلقائيًا عند إغلاق المتصفح.'
                : 'Wake Word listening active (say "Hey Assistant" or "يا NEXORA"). Browser stops listening when closed.'}
            </span>
          </div>
          <button
            type="button"
            onClick={onDisableWakeWord}
            className="underline font-medium shrink-0"
          >
            {isAr ? 'تعطيل التنبيه الصوتي' : 'Disable Wake Word'}
          </button>
        </div>
      )}

      {/* Alerts */}
      {(errorMsg || micError || ttsError || visibilityNotice || wakeWordError) && (
        <div className="px-6 pt-3 space-y-2">
          {errorMsg && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              <span>{errorMsg}</span>
              <button type="button" onClick={onDismissError} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {micError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{micError}</span>
              <button type="button" onClick={() => setMicError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {ttsError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{ttsError}</span>
              <button type="button" onClick={() => setTtsError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {wakeWordError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <span>{wakeWordError}</span>
              <button type="button" onClick={() => setWakeWordError(null)} className="underline shrink-0">
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
          {visibilityNotice && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300">
              <span>{visibilityNotice}</span>
              <button
                type="button"
                onClick={() => setVisibilityNotice(null)}
                className="underline shrink-0"
              >
                {isAr ? 'إغلاق' : 'Dismiss'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Messages Stream (Clean user experience — NO internal KB/sections/DB exposed) */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="py-12 space-y-8">
              <div className="space-y-3">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 text-balance">
                  {isAr ? 'مرحبًا بك في NEXORA AI' : 'Welcome to NEXORA AI'}
                </h1>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                  {isAr
                    ? 'اسأل أي سؤال، حلل ملفاتك أو أكوادك، تحدث مباشرة بالصوت بالعربية أو الإنجليزية، أو اطلب فتح التطبيقات المدعومة.'
                    : 'Ask anything, analyze files or code, speak naturally in Arabic or English, or launch supported apps directly.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void onSendMessage(prompt, detectClientPlatform())}
                    className="text-start p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-600 transition-colors text-sm text-slate-800 dark:text-slate-200"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const meta = msg.metadata;
              const isSpeaking = speakingMessageId === msg.id;
              const launchOutcome = deviceResults[msg.id];

              return (
                <article
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`w-full max-w-3xl rounded-xl px-5 py-4 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {/* Header Metadata Line */}
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 pb-2 mb-3 border-b text-xs ${
                        isUser
                          ? 'border-blue-500/40 text-blue-100'
                          : 'border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {isUser ? (isAr ? 'أنت' : 'You') : 'NEXORA'}
                        </span>
                        {!isUser && meta?.toolsExecuted && meta.toolsExecuted.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {meta.toolsExecuted
                                .map((t) => (isAr ? t.toolNameAr : t.toolNameEn))
                                .join(' / ')}
                            </span>
                          </>
                        )}
                        {!isUser && isSpeaking && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-blue-600 dark:text-blue-400 font-medium">
                              {isAr ? 'جاري القراءة الصوتية...' : 'Speaking...'}
                            </span>
                          </>
                        )}
                      </div>

                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => void handleSpeakMessage(msg)}
                          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          {isSpeaking ? (
                            <>
                              <Square className="w-3.5 h-3.5" />
                              <span>{isAr ? 'إيقاف الصوت' : 'Stop Voice'}</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>{isAr ? 'تشغيل الصوت' : 'Speak'}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Message Body */}
                    <div className="text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>

                    {/* Device Control Card (Direct launch for normal apps; confirm only for sensitive) */}
                    {!isUser && meta?.deviceCommand && meta.deviceCommand.detected && (
                      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span>
                            {isAr ? 'التحكم بالتطبيق' : 'App Launch'} ·{' '}
                            <span className="font-mono">{meta.deviceCommand.targetPlatform}</span>
                          </span>
                        </div>

                        {meta.deviceCommand.supportedOnCurrentPlatform && (
                          <button
                            type="button"
                            onClick={() => void handleDeviceLaunch(msg.id, meta.deviceCommand!)}
                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
                          >
                            {meta.deviceCommand.requiresConfirmation
                              ? isAr
                                ? `تأكيد فتح ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`
                                : `Confirm Launch ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`
                              : isAr
                              ? `فتح ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName} الآن`
                              : `Open ${meta.deviceCommand.matchedAppLabel ?? meta.deviceCommand.extractedAppName}`}
                          </button>
                        )}

                        {launchOutcome && (
                          <p
                            className={`text-xs ${
                              launchOutcome.executed
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isAr ? launchOutcome.messageAr : launchOutcome.messageEn}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Medical Disclaimer Notice */}
                    {!isUser && meta?.medicalDisclaimerIncluded && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          {isAr
                            ? 'تنبيه: المعلومات الطبية للتثقيف العلمي فقط ولا تُغني عن استشارة الطبيب المختص في الحالات الشخصية.'
                            : 'Notice: Medical information is strictly educational and does not substitute for consulting a licensed physician.'}
                        </span>
                      </div>
                    )}

                    {/* External Web Sources ONLY when external search was actually needed and returned links */}
                    {!isUser && meta?.webSources && meta.webSources.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                          <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>
                            {isAr ? 'المصادر الخارجية' : 'External Sources'}
                          </span>
                        </div>
                        <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                          {meta.webSources.map((w) => (
                            <li key={w.url} className="flex flex-wrap items-center gap-1.5">
                              <a
                                href={w.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                              >
                                <span>{w.title}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <span aria-hidden="true">·</span>
                              <span>{w.sourceName}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}

          {sending && (
            <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 px-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>{getMicStatusLabel('awaiting_reply', settings.language)}</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer with Explicit 8-State Voice Bar & Live RMS Meter */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 py-4"
      >
        <div className="max-w-4xl mx-auto space-y-2.5">
          {/* Attached Files Strip */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {attachments.map((att, idx) => (
                <span
                  key={`${att.fileName}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  <span>{att.fileName}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Explicit Microphone State + Real Audio Signal Bar */}
          {(effectiveMicState !== 'idle' || interimText) && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs">
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium ${
                    effectiveMicState === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : effectiveMicState === 'listening'
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {getMicStatusLabel(effectiveMicState, settings.language)}
                </span>

                {effectiveMicState === 'listening' && (
                  <div
                    className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
                    title={isAr ? 'مستوى الصوت الفعلي' : 'Real audio input level'}
                  >
                    <div
                      className="h-full bg-blue-600 transition-all duration-75"
                      style={{ width: `${Math.max(6, Math.round(audioLevel * 100))}%` }}
                    />
                  </div>
                )}
              </div>

              {interimText && (
                <span className="italic text-blue-600 dark:text-blue-400 truncate max-w-md">
                  {interimText}
                </span>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <label
              className="shrink-0 h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center cursor-pointer"
              title={isAr ? 'إرفاق ملف للتحليل' : 'Attach text/code/CSV file'}
            >
              <Paperclip className="w-4 h-4" />
              <input
                type="file"
                accept=".txt,.md,.csv,.json,.ts,.tsx,.js,.py,.html,.xml,.log"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>

            <button
              type="button"
              onClick={() => void handleToggleMic()}
              className={`shrink-0 h-11 px-3.5 rounded-xl border flex items-center gap-2 text-xs font-medium transition-colors whitespace-nowrap ${
                micStatus === 'listening'
                  ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              aria-label={isAr ? 'التحدث بالميكروفون' : 'Voice Input'}
            >
              {micStatus === 'listening' ? (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>{isAr ? 'إيقاف وإرسال' : 'Stop & Send'}</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {settings.voiceSttLang === 'ar-SA' ? 'تحدث (عربي)' : 'Speak (EN)'}
                  </span>
                </>
              )}
            </button>

            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={
                isAr
                  ? 'اكتب سؤالك أو اضغط الميكروفون للتحدث...'
                  : 'Type your request or press the mic to speak...'
              }
              className="flex-1 min-h-11 max-h-36 resize-y rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              type="submit"
              disabled={sending || (!inputText.trim() && !interimText.trim())}
              className="shrink-0 h-11 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{isAr ? 'إرسال' : 'Send'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

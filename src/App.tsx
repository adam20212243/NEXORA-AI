import { Menu, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdminConsoleView } from './components/AdminConsoleView.tsx';
import { ChatWorkspace } from './components/ChatWorkspace.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { Sidebar, type ActiveView } from './components/Sidebar.tsx';
import { ToolsHubView } from './components/ToolsHubView.tsx';
import { apiClient, type PublicCapabilitiesResponse } from './services/apiClient.ts';
import { stopAllSpeech } from './services/voiceService.ts';
import { DEFAULT_SETTINGS } from './shared/constants.ts';
import type {
  AppSettings,
  AttachedDocumentInput,
  ChatMessage,
  Conversation,
  DeviceControlCommand,
  PersonalityStyleId,
} from './shared/types.ts';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [capabilities, setCapabilities] = useState<PublicCapabilitiesResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>(undefined);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);

  const isAr = settings.language === 'ar';

  useEffect(() => {
    const html = document.documentElement;
    html.lang = settings.language;
    html.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    if (settings.theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [settings.language, settings.theme]);

  const loadInitialData = async () => {
    try {
      const [capsData, convData, adminState] = await Promise.all([
        apiClient.getPublicCapabilities(),
        apiClient.listConversations(),
        apiClient.getAdminStatus(),
      ]);
      setCapabilities(capsData);
      setSettings(capsData.settings);
      setConversations(convData.conversations);
      setAdminAuthenticated(adminState.authenticated);
      if (convData.conversations.length > 0 && !activeConversationId) {
        const firstId = convData.conversations[0].id;
        setActiveConversationId(firstId);
        const msgRes = await apiClient.getMessages(firstId);
        setMessages(msgRes.messages);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed initializing NEXORA AI.');
    }
  };

  useEffect(() => {
    void loadInitialData();
  }, []);

  const handleSelectView = (view: ActiveView) => {
    // Stop TTS when leaving chat unless Background Reading mode is explicitly enabled
    if (activeView === 'chat' && view !== 'chat' && !settings.allowBackgroundTts) {
      stopAllSpeech();
    }
    setActiveView(view);
  };

  const handleSelectConversation = async (id: string) => {
    if (id !== activeConversationId) {
      stopAllSpeech();
    }
    setActiveConversationId(id);
    setChatError(null);
    try {
      const res = await apiClient.getMessages(id);
      setMessages(res.messages);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed loading conversation.');
    }
  };

  const handleNewConversation = () => {
    stopAllSpeech();
    setActiveConversationId(null);
    setMessages([]);
    setChatError(null);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await apiClient.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        stopAllSpeech();
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed deleting conversation.');
    }
  };

  const handleSendMessage = async (
    query: string,
    platform: DeviceControlCommand['targetPlatform'],
    attachments?: AttachedDocumentInput[]
  ) => {
    setSending(true);
    setChatError(null);
    try {
      const res = await apiClient.sendChatMessage({
        query,
        conversationId: activeConversationId ?? undefined,
        attachments,
        platform,
      });

      setActiveConversationId(res.conversationId);
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);

      const convList = await apiClient.listConversations();
      setConversations(convList.conversations);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed communicating with NEXORA MASTER.');
    } finally {
      setSending(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    const saved = await apiClient.updateSettings(updates);
    setSettings(saved);
    const refreshed = await apiClient.getPublicCapabilities();
    setCapabilities(refreshed);
  };

  const viewTitles: Record<ActiveView, { ar: string; en: string }> = {
    chat: { ar: 'NEXORA MASTER / المحادثة', en: 'NEXORA MASTER / Chat' },
    tools: { ar: 'الأدوات والقدرات', en: 'Tools & Capabilities' },
    settings: { ar: 'الإعدادات والصوت', en: 'Settings & Voice' },
    admin: { ar: 'الإدارة الداخلية المحمية', en: 'Protected System Admin' },
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        lang={settings.language}
        activeView={activeView}
        onSelectView={handleSelectView}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => void handleSelectConversation(id)}
        onNewConversation={handleNewConversation}
        onDeleteConversation={(id) => void handleDeleteConversation(id)}
        adminAuthenticated={adminAuthenticated}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar Contract */}
        <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={isAr ? 'فتح القائمة' : 'Open menu'}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
              {isAr ? viewTitles[activeView].ar : viewTitles[activeView].en}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                void handleUpdateSettings({
                  language: settings.language === 'ar' ? 'en' : 'ar',
                  voiceSttLang: settings.language === 'ar' ? 'en-US' : 'ar-SA',
                })
              }
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {settings.language === 'ar' ? 'English' : 'العربية'}
            </button>
            <button
              type="button"
              onClick={() =>
                void handleUpdateSettings({
                  theme: settings.theme === 'dark' ? 'light' : 'dark',
                })
              }
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label={isAr ? 'تبديل المظهر' : 'Toggle theme'}
            >
              {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {activeView === 'chat' && (
            <ChatWorkspace
              conversationId={activeConversationId}
              settings={settings}
              messages={messages}
              sending={sending}
              errorMsg={chatError}
              prefillText={prefillPrompt}
              onConsumePrefill={() => setPrefillPrompt(undefined)}
              onDismissError={() => setChatError(null)}
              onSendMessage={handleSendMessage}
              onChangePersonality={(style: PersonalityStyleId) =>
                void handleUpdateSettings({ personalityStyle: style })
              }
              onToggleAutoSpeak={() =>
                void handleUpdateSettings({ autoSpeakResponses: !settings.autoSpeakResponses })
              }
              onDisableWakeWord={() =>
                void handleUpdateSettings({ enableWakeWord: false })
              }
            />
          )}

          {activeView === 'tools' && (
            <ToolsHubView
              settings={settings}
              tools={capabilities?.tools ?? []}
              onUsePromptInChat={(prompt) => {
                setPrefillPrompt(prompt);
                setActiveView('chat');
              }}
              onUpdateSettings={handleUpdateSettings}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              settings={settings}
              providers={capabilities?.providers ?? []}
              onSaveSettings={handleUpdateSettings}
            />
          )}

          {activeView === 'admin' && (
            <AdminConsoleView
              lang={settings.language}
              onAuthChange={(authed) => setAdminAuthenticated(authed)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

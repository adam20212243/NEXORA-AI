import {
  Lock,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type { AppLanguage, Conversation } from '../shared/types.ts';

export type ActiveView = 'chat' | 'tools' | 'settings' | 'admin';

interface SidebarProps {
  lang: AppLanguage;
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  adminAuthenticated: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  lang,
  activeView,
  onSelectView,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  adminAuthenticated,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const isAr = lang === 'ar';

  const navItems: Array<{ id: ActiveView; labelAr: string; labelEn: string; icon: typeof MessageSquare }> = [
    { id: 'chat', labelAr: 'المحادثة الرئيسية', labelEn: 'Master Chat', icon: MessageSquare },
    { id: 'tools', labelAr: 'الأدوات والقدرات', labelEn: 'Tools & Tasks', icon: Wrench },
    { id: 'settings', labelAr: 'الإعدادات والصوت', labelEn: 'Settings & Voice', icon: Settings },
  ];

  const content = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 w-72">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <svg
            width="30"
            height="30"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="32" height="32" rx="8" className="fill-blue-600" />
            <path
              d="M9 22V10L16 17L23 10V22"
              stroke="white"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="22" r="1.75" fill="white" />
          </svg>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            NEXORA AI
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={isAr ? 'إغلاق القائمة' : 'Close menu'}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Primary Action */}
      <div className="p-4">
        <button
          type="button"
          onClick={() => {
            onNewConversation();
            onSelectView('chat');
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>{isAr ? 'محادثة جديدة' : 'New Conversation'}</span>
        </button>
      </div>

      {/* User Navigation (internal KB/DB hidden from normal user) */}
      <nav className="px-3 space-y-1" aria-label={isAr ? 'التنقل الرئيسي' : 'Main Navigation'}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectView(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{isAr ? item.labelAr : item.labelEn}</span>
            </button>
          );
        })}
      </nav>

      {/* Conversation History */}
      <div className="mt-5 px-4 pb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {isAr ? 'سجل المحادثات' : 'Conversation History'}
        </span>
        <span className="text-xs font-mono tabular-nums text-slate-400">
          {conversations.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {conversations.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400 dark:text-slate-500">
            {isAr ? 'لا توجد محادثات محفوظة بعد.' : 'No saved conversations yet.'}
          </p>
        ) : (
          conversations.map((conv) => {
            const isSelected = activeConversationId === conv.id && activeView === 'chat';
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectConversation(conv.id);
                    onSelectView('chat');
                    onCloseMobile();
                  }}
                  className="flex-1 text-start truncate font-medium"
                  title={conv.title}
                >
                  {conv.title}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteConversation(conv.id)}
                  className="opacity-60 hover:opacity-100 p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity shrink-0"
                  aria-label={isAr ? 'حذف المحادثة' : 'Delete conversation'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Quiet Password-Protected Admin Link */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            onSelectView('admin');
            onCloseMobile();
          }}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors whitespace-nowrap ${
            activeView === 'admin'
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
          }`}
        >
          <span className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            <span>{isAr ? 'الإدارة الداخلية' : 'System Admin'}</span>
          </span>
          {adminAuthenticated && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              {isAr ? 'مفتوح' : 'Unlocked'}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 h-full">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="relative z-10 h-full">{content}</div>
          <button
            type="button"
            aria-label="Close overlay"
            onClick={onCloseMobile}
            className="flex-1 bg-slate-950/50 backdrop-blur-xs"
          />
        </div>
      )}
    </>
  );
}

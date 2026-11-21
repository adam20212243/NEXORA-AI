export type KnowledgeSectionId =
  | 'science'
  | 'programming'
  | 'medicine'
  | 'history_culture'
  | 'logic_creativity';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ReviewStatus = 'verified' | 'needs_review' | 'rejected';

export type PersonalityStyleId =
  | 'friendly'
  | 'professional'
  | 'simple'
  | 'scientific'
  | 'expert'
  | 'analytical'
  | 'creative';

export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openai-compatible'
  | 'local';

export type AppLanguage = 'ar' | 'en';

export type AppTheme = 'light' | 'dark';

export interface KnowledgeRecord {
  id: string;
  section: KnowledgeSectionId;
  subcategory: string;
  title: string;
  detailed_content: string;
  simple_explanation: string;
  context: string;
  usage_limits: string;
  sources: string[];
  source_urls: string[];
  accessed_at: string;
  confidence_level: ConfidenceLevel;
  review_status: ReviewStatus;
  keywords: string[];
  dedup_key: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRecordInput {
  id?: string;
  section: KnowledgeSectionId;
  subcategory: string;
  title: string;
  detailed_content: string;
  simple_explanation: string;
  context: string;
  usage_limits: string;
  sources: string[];
  source_urls: string[];
  accessed_at?: string;
  confidence_level: ConfidenceLevel;
  review_status?: ReviewStatus;
  keywords: string[];
  dedup_key?: string;
}

export interface SectionStats {
  section: KnowledgeSectionId;
  targetCount: number;
  totalCount: number;
  verifiedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
}

export interface KnowledgeBaseStats {
  totalRecords: number;
  targetTotal: number;
  verifiedTotal: number;
  needsReviewTotal: number;
  sections: SectionStats[];
  lastUpdatedAt: string | null;
}

export interface BatchJob {
  id: string;
  section: KnowledgeSectionId;
  source_type: 'wikipedia' | 'curated' | 'ai_assisted' | 'import';
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  target_batch_size: number;
  processed_count: number;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  cursor_category_index: number;
  cursor_continue_token: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  publishedAt: string | null;
  accessedAt: string;
  reliabilityScore: number;
  provider: 'gemini_google_search' | 'wikipedia_api' | 'openalex_api';
}

export interface ExternalSearchReport {
  query: string;
  executed: boolean;
  providerUsed: string;
  results: ExternalSearchResult[];
  conflictsDetected: string[];
  error: string | null;
  durationMs: number;
}

export interface DeviceControlCommand {
  detected: boolean;
  action: 'open_app' | 'open_url' | 'system_setting' | 'none';
  rawQuery: string;
  extractedAppName: string | null;
  matchedAppId: string | null;
  matchedAppLabel: string | null;
  targetPlatform: 'android' | 'windows' | 'macos' | 'linux' | 'ios' | 'web';
  supportedOnCurrentPlatform: boolean;
  requiresConfirmation: boolean;
  autoLaunchRecommended: boolean;
  launchUri: string | null;
  androidPackage: string | null;
  androidIntentUri: string | null;
  windowsProtocol: string | null;
  messageAr: string;
  messageEn: string;
}

export interface ChatSourceWeb {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  reliabilityScore: number;
}

export interface ToolCapabilityDescriptor {
  id: string;
  category:
    | 'research'
    | 'writing'
    | 'coding'
    | 'math_science'
    | 'files'
    | 'productivity'
    | 'voice_device';
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  samplePromptAr: string;
  samplePromptEn: string;
}

export interface ToolExecutionTrace {
  toolId: string;
  toolNameAr: string;
  toolNameEn: string;
  success: boolean;
  summary: string;
}

export interface AttachedDocumentInput {
  fileName: string;
  mimeType: string;
  contentText: string;
}

export interface UserPreferenceItem {
  id: string;
  key: string;
  value: string;
  consented: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTaskItem {
  id: string;
  title: string;
  notes: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  created_at: string;
}

export interface MasterResponsePayload {
  answer: string;
  language: AppLanguage;
  personalityStyle: PersonalityStyleId;
  providerUsed: AIProviderId | 'kb_offline_synthesis';
  modelUsed: string;
  toolsExecuted: ToolExecutionTrace[];
  webSources: ChatSourceWeb[];
  uncertaintyLevel: 'low' | 'medium' | 'high';
  medicalDisclaimerIncluded: boolean;
  deviceCommand: DeviceControlCommand | null;
  externalSearchExecuted: boolean;
  externalSearchError: string | null;
  processingMs: number;
  // Internal telemetry (never rendered to regular users in chat UI)
  internalUsedKbCount?: number;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Partial<MasterResponsePayload>;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderStatus {
  id: AIProviderId;
  nameAr: string;
  nameEn: string;
  configured: boolean;
  modelDefault: string;
  availableModels: string[];
  freeTierNotesAr: string;
  freeTierNotesEn: string;
  supportsSearchGrounding: boolean;
}

export interface AppSettings {
  language: AppLanguage;
  theme: AppTheme;
  personalityStyle: PersonalityStyleId;
  activeProvider: AIProviderId;
  activeModel: string;
  enableExternalSearch: boolean;
  enableProviderFallback: boolean;
  voiceSttLang: 'ar-SA' | 'en-US';
  voiceInputDeviceId: string;
  voiceTtsEnabled: boolean;
  voiceTtsRate: number;
  voiceTtsVoiceName: string;
  autoSpeakResponses: boolean;
  autoSendVoiceTranscript: boolean;
  useServerTtsFallback: boolean;
  enableWakeWord: boolean;
  allowBackgroundTts: boolean;
  memoryConsentGranted: boolean;
}

export interface AdminAuthStatus {
  needsClaim: boolean;
  authenticated: boolean;
  envPasscodeActive: boolean;
}

export interface SessionUsage {
  used?: number
  size?: number
  credits?: number
  charged?: number
}

export interface SessionSummary {
  id: string
  title: string
  cwd: string
  model?: string
  mode?: string
  updatedAt: number
  usage?: SessionUsage
  messageCount?: number
}

export interface ModelInfo {
  id: string
  name: string
  credits: string
  multiplier: number
  maxInputTokens: number
  supportsImages?: boolean
  supportsReasoning?: boolean
  effortOptions?: { value: string; name: string }[]
}

export interface Quota {
  model?: string
  percent?: number
  resetAt?: number
  sharedModels?: string[]
}

export interface UsageSession {
  id: string
  title: string
  cwd: string
  credits: number
  charged: number
  updatedAt: number
  inWorkspace: boolean
}

export interface CliStats {
  totalSessions: number
  totalMessages: number
  totalDays: number
  activeDays: number
  modelUsage: Record<string, { inputTokens?: number; outputTokens?: number; displayName?: string }>
}

export interface UsageSummary {
  workspace: string
  totalCredits: number
  totalCharged: number
  todayCredits: number
  workspaceCredits: number
  workspaceCharged: number
  workspaceToday: number
  sessions: UsageSession[]
  quota: Quota
  model: string
  cliStats?: CliStats
}

export interface Workspace {
  id?: string
  path: string
  label: string
  source: string
  current?: boolean
  active?: boolean
  folders?: string[]
}

export interface WorkspaceRecord {
  id: string
  name: string
  folders: string[]
  createdAt?: number
  updatedAt?: number
}

export interface Bootstrap {
  demo: boolean
  cwd: string
  workspace: string
  workspaceId?: string
  workspaceName?: string
  workspaceFolders?: string[]
  fresh: boolean
  port: number
  agentReady: boolean
  agentError: string
  status: string
  model: string
  credits: number
  charged: number
  todayCredits: number
  quota: Quota
  sessions: SessionSummary[]
  projectNames?: Record<string, string>
  lastSessionId: string
  lastSeq: number
}

export interface CatalogSkill {
  name: string
  description?: string
  hint?: string
  source?: string
  path?: string
}

export interface Connector {
  name: string
  scope?: string
  type?: string
  target?: string
  url?: string
  args?: string[]
  disabled?: boolean
  configPath?: string
  description?: string
}

export interface CatalogPlugin {
  name: string
  marketplace: string
  description?: string
  version?: string
  category?: string
  author?: string
  installed: boolean
  enabled: boolean
  key: string
}

export interface Marketplace {
  name: string
  description?: string
  pluginCount: number
  installLocation?: string
}

export interface Catalog {
  skills: CatalogSkill[]
  connectors: Connector[]
  plugins: CatalogPlugin[]
  marketplaces: Marketplace[]
  codebuddyDir?: string
}

export interface AcpCommand {
  name: string
  description?: string
  hint?: string
}

export interface SessionDetail extends SessionSummary {
  events: { type: string; data: Record<string, unknown> }[]
  usage: SessionUsage & {
    quota?: Quota
    lastTurn?: { nominal: number; actual: number; at: number }
  }
}

export interface AcpEvent {
  seq: number
  type: string
  sessionId?: string
  data: Record<string, any>
}

export interface Attachment {
  name: string
  mime: string
  dataUrl: string
  data: string
}

export interface PlanEntry {
  content: string
  status: string
}

export interface PermissionData {
  requestId: string
  title: string
  kind?: string
  options: { optionId: string; name: string; kind?: string }[]
  resolvedOptionId?: string
}

export interface UsagePartData {
  used: number
  size: number
  nominal: number
  actual: number
  quota?: Quota
  tokens?: Record<string, number>
}

export type FileKind = 'image' | 'video' | 'audio' | 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'other'

export interface FileRef {
  path: string
  name: string
  ext: string
  kind: FileKind
}

export type WidgetKind = 'chart' | 'map' | 'form' | 'article'

export interface VisualTheme {
  primary: string
  accent: string
  background: string
  foreground: string
  muted: string
  fontFamily: string
  radius: number
  palette: string[]
}

export interface VisualTemplate {
  id: string
  name: string
  theme: VisualTheme
  builtin?: boolean
}

export interface ChartSeries {
  name?: string
  data: number[]
}

export interface ChartSpec {
  kind: 'bar' | 'line' | 'area' | 'pie'
  categories?: string[]
  series?: ChartSeries[]
  data?: { name: string; value: number }[]
  xLabel?: string
  yLabel?: string
  unit?: string
  horizontal?: boolean
  showLegend?: boolean
  showValues?: boolean
}

export interface MapMarker {
  name: string
  lng: number
  lat: number
  value?: number
  description?: string
}

export interface MapSpec {
  markers: MapMarker[]
  center?: [number, number]
  zoom?: number
  scope?: 'world'
  /** 自定义底图：GeoJSON 对象、GeoJSON 字符串，或返回 GeoJSON 的地址（如 /maps/wenzhou.json） */
  geojson?: unknown
}

export interface FormOption {
  label: string
  value: string
}

export interface FormField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'date'
  placeholder?: string
  options?: FormOption[]
  required?: boolean
  defaultValue?: string | number | boolean
  help?: string
}

export interface FormSpec {
  fields: FormField[]
  submitLabel?: string
  successMessage?: string
}

export interface ArticleSpec {
  markdown: string
  cover?: string
  tags?: string[]
  author?: string
}

export interface WidgetSpec {
  version?: number
  type: WidgetKind
  title?: string
  subtitle?: string
  template?: string
  theme?: Partial<VisualTheme>
  chart?: ChartSpec
  map?: MapSpec
  form?: FormSpec
  article?: ArticleSpec
}

export interface SavedWidget {
  id: string
  title: string
  spec: WidgetSpec
  createdAt: number
  updatedAt: number
}

export interface ToolArtifact {
  title?: string
  kind?: string
  status?: string
  content?: any[]
  rawInput?: unknown
  rawOutput?: unknown
  file?: FileRef
}

export type ChatPart =
  | { type: 'text'; id: string; text: string; status?: 'running' | 'complete' }
  | { type: 'reasoning'; id: string; text: string; status?: 'running' | 'complete' }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      argsText: string
      result?: unknown
      isError?: boolean
      artifact?: ToolArtifact
    }
  | { type: 'data-plan'; id: string; data: { entries: PlanEntry[] } }
  | { type: 'data-permission'; id: string; data: PermissionData }
  | { type: 'data-usage'; id: string; data: UsagePartData }
  | { type: 'data-error'; id: string; data: { message: string; kind?: string } }
  | { type: 'data-user-meta'; id: string; data: { connectors?: string[] } }
  | { type: 'image'; id: string; image: string; filename?: string }

export type ChatRole = 'user' | 'assistant'

export type ChatStatus =
  | { type: 'running' }
  | { type: 'complete'; reason: 'stop' | 'unknown' }
  | { type: 'incomplete'; reason: 'cancelled' | 'error' | 'other'; error?: string }

export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatPart[]
  status: ChatStatus
  createdAt: number
}

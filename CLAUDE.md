# FanFlow v2

SaaS CRM para creadores de contenido con asistente IA para gestionar conversaciones con fans.

> **Backlog de auditoría:** los bugs y mejoras pendientes identificados en la auditoría (2026-07-02) están en [`AUDITORIA_BACKLOG.md`](./AUDITORIA_BACKLOG.md), con IDs referenciables (`SEC-*`, `TEN-*`, `AI-*`, `WK-*`, `FE-*`, `ARCH-*`), ubicación `archivo:línea`, escenario y fix propuesto. Consúltalo antes de tocar auth, routers tRPC, workers/pollers o la capa realtime.

## Stack

- **Frontend:** Next.js 15 (App Router) + React 19 + TailwindCSS v4 + shadcn/ui
- **Backend:** tRPC + Drizzle ORM + PostgreSQL 16
- **Auth:** NextAuth v4 (credentials provider)
- **AI:** Multi-provider (Anthropic, OpenAI, Google, MiniMax, Kimi)
- **Cache/Queues:** Redis 7 + BullMQ
- **Infra:** Docker Compose, deploy en VPS con Portainer + Nginx Proxy Manager

## Commands

- `npm run dev` — development server (Turbopack)
- `npm run build` — production build
- `npm run db:push` — push schema to database
- `npm run db:generate` — generate migrations
- `npm run db:migrate` — run migrations
- `npm run db:studio` — Drizzle Studio (DB browser)

## Development

- `docker compose -f docker-compose.dev.yml up -d` — start Postgres + Redis locally
- Copy `.env.example` to `.env` and fill in values
- `npm run db:push` to sync schema
- `npm run dev` to start the app

## Architecture

- Multi-tenant via `creator_id` column on all business tables
- `protectedProcedure` in tRPC enforces auth and injects `creatorId`
- `managerProcedure` for actions requiring manager role (create/update/delete contacts)
- AI service in `src/server/services/ai.ts` handles prompt construction and API calls
- Personality configuration per platform stored as JSONB
- Team support with base roles (`owner`, `manager`, `chatter`) + custom roles with granular permissions
- `ownerProcedure` for owner-only actions, `permissionProcedure(...perms)` for permission-gated actions
- Real-time collaboration via SSE + Redis Pub/Sub (presence, typing, viewing indicators)
- Team audit log for tracking all team member actions

## AI System

### Multi-provider support (`src/server/services/ai.ts`)

Supports 5 providers via a unified `callAIProvider()` function:
- **Anthropic** — Claude Sonnet 4.6, Opus 4.6, Haiku 4.5
- **OpenAI** — GPT-4o, GPT-4o Mini, GPT-4 Turbo
- **Google** — Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash
- **MiniMax** — MiniMax-M2.7 (model ID: `MiniMax-M1`), M2.5, M2.5 Chat
- **Kimi** — Kimi K2, Moonshot V1 Auto, Moonshot V1 32K

MiniMax and Kimi use OpenAI-compatible endpoints with custom base URLs defined in `OPENAI_COMPATIBLE_BASES`.

Models are listed in `PROVIDER_MODELS` and shown in the settings UI for selection.

### Multi-model per task (`src/server/services/ai-config-resolver.ts`)

Each creator can configure different models for different tasks:
- `suggestion` — generating reply suggestions
- `analysis` — message analysis
- `summary` — conversation summaries
- `report` — contact reports
- `price_advice` — pricing recommendations
- `coaching` — negotiation coaching sessions
- `content_gap` — content gap analysis reports

### Prompt construction

`buildSystemPrompt()` assembles the prompt from:
1. Base system instructions (variant generation rules)
2. **Language instruction** (if configured — "Responde siempre en {language}")
3. Platform type
4. Platform-specific personality config (role, tone, style, message length, goals, restrictions, example messages, custom instructions)
5. **Conversation mode context** (OnlyFans only — mode name, description, type)
6. Global creator instructions
7. Contact profile (engagement, funnel stage, payment probability)
8. Creator notes about the contact

### Suggestion variants

Each AI response generates 3 variants with different approaches. The variant types change based on the contact's funnel stage and conversation mode. Variants are parsed from tagged format: `[CASUAL] message --- [SALES] message --- [RETENTION] message`.

### Multi-Language Support (`src/server/services/language-utils.ts`)

Creators can configure the language for AI responses and analysis output.

- **Supported languages:** es (Español), en (English), pt (Português), fr (Français), de (Deutsch), it (Italiano)
- **Storage:** `creators.settings.responseLanguage` and `creators.settings.analysisLanguage` (JSONB, no migration needed)
- **Integration:** Language instruction injected into all AI prompts — `buildSystemPrompt()` (suggestions), analysis, summaries, reports, price advice, coaching, content gap analysis
- **API:** `account.getLanguageSettings` / `account.saveLanguageSettings`
- Default: `"es"` (backward compatible — existing behavior unchanged when not configured)

### AI Negotiation Coaching (`src/server/services/negotiation-coach.ts`)

AI-powered coaching that analyzes conversations and provides strategic negotiation advice.

**Coaching types:**
- `negotiation` — pricing, exclusivity, value framing, buying signals
- `retention` — re-engagement, loyalty, fan recovery
- `upsell` — tier upgrades, premium content, exclusive experiences

**Output structure (JSONB):**
- `situationAssessment` — current negotiation state
- `fanProfile` — psychological profile of the fan
- `currentLeverage` — creator's leverage points
- `tactics[]` — 3-5 concrete tactics with name, description, example, riskLevel (low/medium/high)
- `suggestedNextMove` — best immediate action
- `risks[]` and `avoidList[]` — pitfalls to avoid

**API** (in `src/server/api/routers/ai.ts`):
- `getCoaching` mutation — generates coaching, saves to `coachingSessions`, logs usage
- `listCoachingSessions` — history per conversation
- `getCoachingSession` — single session detail

**Limits:** free=5/month, starter=20, pro=100, business=unlimited

**UI** (`src/components/conversations/coaching-panel.tsx`):
- "Coaching" button in chat panel header (next to manual mode toggle)
- Opens modal with coaching type selector (3 cards: Negociacion, Retencion, Upsell)
- Results view: situation assessment, fan profile, leverage, expandable tactics with risk badges, next move, risks/avoid lists
- Session history: load previous coaching sessions for the conversation

### Content Gap Analysis (`src/server/services/content-gap-analyzer.ts`)

Identifies content gaps by analyzing conversation patterns across all contacts.

**Two-phase architecture:**
1. **Aggregation (no AI):** `aggregateConversationData()` queries `contactProfiles.behavioralSignals.topicFrequency` across all contacts, computes topic frequencies, sentiment averages, engagement drop counts, platform breakdown
2. **AI Analysis:** `analyzeContentGaps()` sends pre-aggregated data (not raw messages) to AI for interpretation

**Output structure (JSONB):**
- `topRequestedTopics[]` — topics with frequency, avgSentiment, sampleQuotes
- `engagementDropPoints[]` — patterns where engagement drops + suggestions
- `contentOpportunities[]` — content to create with estimatedDemand/estimatedRevenue
- `platformBreakdown[]` — per-platform insights
- `trendingThemes[]` and `summary`

**API** (`src/server/api/routers/content-gaps.ts`):
- `generate` mutation — aggregates + AI analysis, saves to `contentGapReports` (Pro+ only)
- `list` / `get` — report history
- `getTopicTrends` query — free, no AI: top 20 topics from contact profiles

**UI** (`src/app/(dashboard)/content-gaps/page.tsx`):
- Sidebar link "Content Gaps" (manager access)
- 3 tabs: Topic Trends (free bar chart of most discussed topics), Reporte IA (generate + view report), Historial (past reports)
- Report view: executive summary, trending themes tags, top requested topics with sentiment + quotes, content opportunities grid, engagement drop points, platform breakdown
- Period selector (7/30/90 days) for report generation

### A/B Testing for Conversation Modes (`src/server/services/ab-experiment.ts`)

Test different conversation mode configurations against each other with statistical significance tracking.

**How it works:**
1. Creator creates an experiment with two mode config variants (A/B) for a specific mode type
2. Contacts are deterministically assigned to variants via hash (same contact always gets same variant)
3. Metrics recorded automatically: `fan_replied`, `conversion` (funnel stage change), `response_sent`, `tip_received`
4. Results include per-variant metrics and statistical confidence (z-test)
5. Winner can be applied to the actual conversation mode config

**Schema:**
- `conversationModeExperiments` — experiment definition with status lifecycle (draft → running → completed)
- `experimentAssignments` — deterministic contact-to-variant mapping
- `experimentMetrics` — per-event metric recording

**Constraint:** Only one running experiment per mode type per creator.

**API** (`src/server/api/routers/ab-experiments.ts`):
- `list`, `get`, `create`, `start`, `stop`, `getResults`, `applyWinner`

**Integration in AI router:** After resolving conversation mode, checks for running experiment and overrides personality config with the assigned variant's config.

**UI** (`src/components/settings/ab-experiments-settings.tsx`):
- Section at bottom of Settings > "Modos conversacion" tab
- Create form: name, mode type selector, traffic split slider, variant A/B config (tone, style, message length, objectives, instructions)
- Experiment list with status badges (draft/running/completed), lifecycle buttons (start/stop/declare winner/apply winner)
- Results panel: per-variant metrics (contacts, replies, conversions), statistical confidence percentage, suggested winner

### A/B Testing de Mensajes/Templates (`src/server/services/message-experiment.ts`)

Distinto del A/B de conversation modes: aquí se prueban variantes de **contenido de mensaje** (2-5 variantes con `{key, label, content}`) y se mide reply rate + conversión por variante.

**Cómo funciona:**
1. El creador crea un experimento con N variantes de contenido (página `/experiments`, acceso manager). Estados: `draft → running → completed`.
2. Al responder en el chat, un selector "🧪 A/B" lista los experimentos `running` de esa plataforma. Al elegir uno, `messageExperiments.pickForSend` elige una variante **aleatoria uniforme** (cada envío es independiente, no por-contacto), registra un `messageExperimentSends` y devuelve el contenido para rellenar el textarea (interpola `{{displayName}}`/`{{username}}`).
3. **Reply**: `messages.addFanMessage` llama `markExperimentReplyForContact` (fire-and-forget) → marca el send abierto más reciente del contacto como `replied`.
4. **Conversión**: `profile-updater.ts` llama `markExperimentConversionForContact` cuando el contacto avanza de funnel stage.
5. `calculateMessageExperimentResults` agrega por variante: sends, replies, replyRate, conversions, conversionRate, avgReplySentiment + confianza (z-test del líder vs runner-up). `applyWinner` fija la variante ganadora.

**Estadística compartida** (`src/server/services/ab-stats.ts`): `twoProportionConfidence` + `normalCDF`, usadas por ambos sistemas de A/B (se extrajeron de `ab-experiment.ts`).

**Schema:** `messageExperiments` (variants JSONB, status, winnerVariantKey) + `messageExperimentSends` (variantKey, replied/repliedAt/replySentiment, converted/convertedAt). **API:** `messageExperiments` router (list, get, listRunning, create, update, start, stop, applyWinner, delete, pickForSend). **UI:** página `/experiments` (sidebar "🧪 A/B Mensajes", manager) + selector en `chat-panel`.

## Conversation Modes (OnlyFans only)

### Overview

Conversation modes control how the AI generates responses for OnlyFans contacts. Each mode has its own tone, style, objectives, restrictions, and activation criteria. Modes are resolved automatically based on contact behavioral scoring.

**This only affects AI response generation, not contact scoring** (scoring is a separate system).

### Mode types (priority order)

| Mode | Priority | Description |
|------|----------|-------------|
| VIP | 40 | Paying, recurring, in premium dynamic |
| CONVERSION | 30 | Clear interest, asks deeper questions, payment profile |
| POTENCIAL_PREMIUM | 20 | Consistent, respectful, shows interest in dynamics |
| LOW_VALUE | 10 | Asks for free content, aggressive, pressures |
| BASE | 0 | Default fallback — new subscribers, superficial |

### How it works

1. **Resolution** (`src/server/services/conversation-mode-resolver.ts`):
   - `resolveConversationMode(modes, contactData)` evaluates modes by priority (highest first)
   - Checks activation criteria against contact data (engagement, payment probability, funnel stage, message count, sentiment trend, days since last interaction, total spent)
   - Falls back to BASE if no other mode matches

2. **Personality merge** (`mergePersonalityWithMode()`):
   - Mode overlays on top of base platform personality
   - Role always comes from the platform personality
   - Mode fields (tone, style, messageLength, objectives, restrictions, instructions) override base only when defined
   - Empty mode fields fall through to platform personality values

3. **Integration in AI router** (`src/server/api/routers/ai.ts`):
   - Both `suggest` and `regenerate` mutations resolve the mode for OnlyFans contacts
   - Loads custom modes from DB, falls back to `DEFAULT_CONVERSATION_MODES`
   - Merges personality, passes `conversationMode` context to prompt builder

### Storage

- **Table:** `conversation_modes` — per-creator mode configurations
- **Unique index:** `(creator_id, mode_type)` — one config per mode type per creator
- **Default modes** in `DEFAULT_CONVERSATION_MODES` used when creator hasn't customized

### API (`src/server/api/routers/conversation-modes.ts`)

- `list` — returns creator's modes (or defaults if none configured)
- `upsert` — create or update a mode by type
- `initDefaults` — saves all default modes to DB for customization
- `toggleActive` — enable/disable a mode (BASE cannot be disabled)
- `resolveForContact` — resolves the active mode for a specific contact (query, used in UI)

### UI

- **Settings tab** "Modos conversacion" (`src/components/settings/conversation-modes-settings.tsx`) — list, edit, toggle modes + A/B experiments section at bottom
- **Contact panel badge** (`ConversationModeBadge` in `src/components/conversations/contact-panel.tsx`) — shows active mode for OnlyFans contacts, refreshes on message send

## Conversation Management

### Conversation list (`src/components/conversations/conversation-list.tsx`)

Features:
- **Tabs:** Active / Archived — separates conversations by status
- **Search:** Filter by contact username or display name
- **Sorting:** By recent (default), engagement level, or payment probability
- **Quick filters:** Expandable panel with chips for platform and funnel stage filtering, with active filter counter and clear button
- **Pin conversations:** Pinned conversations always appear at top. Toggle via hover action on each conversation item. Stored in `is_pinned` column on `conversations` table
- **Archive conversations:** Move to archived tab via hover action. Restore from archived tab
- **Grouping:** Conversations grouped by platform with collapsible headers

### Conversation page layout (`src/app/(dashboard)/conversations/page.tsx`)

Three-panel responsive layout:
- **Left:** Conversation list (w-80 on desktop, full width on mobile)
- **Center:** Chat panel with AI suggestions + coaching button in header
- **Right:** Contact panel with stats, scoring, revenue, reports (w-80 on desktop, toggle on mobile)

### Keyboard Shortcuts (`src/hooks/use-conversation-shortcuts.ts`)

Global shortcuts active on `/conversations` while NOT typing in an input/textarea/contenteditable:

| Key | Action |
|-----|--------|
| `j` / `↓` | Next conversation |
| `k` / `↑` | Previous conversation |
| `r` | Focus the reply textarea (fires the `fanflow:focus-reply` window event; `chat-panel` listens) |
| `a` | Archive the selected conversation (`conversations.updateStatus` mutation, returns to list) |
| `?` | Open `ShortcutsCheatsheet` modal |

The `r` shortcut uses a custom window event rather than prop drilling so any consumer (chat-panel, future components) can subscribe.

### Slash Templates in Chat Input (`src/components/conversations/slash-template-menu.tsx`)

Inline command palette inside the manual-mode reply textarea:
- Triggered by `/word` anchored to start-of-input or after whitespace.
- Queries `trpc.templates.list({ platformType })` (templates without platform are included by the server).
- Filters live by name/category as the user types.
- Variable interpolation on insert: `{{displayName}}` and `{{username}}` from the conversation contact.
- Keyboard: `↑`/`↓` navigate, `Enter`/`Tab` insert, `Esc` closes (replaces the slash range with empty string).
- Mounted as `position: absolute` floating above the textarea.

### Sidebar Unread Badges (`SidebarBadge` in `src/components/layout/sidebar.tsx`)

Red pill (`99+` clamp) shown next to navigation items with pending work:
- **Conversaciones** — count of `RealtimeContext.newMessageConversations` (Set of conversation IDs that received `new_message` SSE events this session). Ephemeral: clears on logout / page reload.
- **Comentarios** — `socialComments.overview.unhandledCount` (persistent count from DB). Query enabled only for the comments item to avoid global polling; auto-invalidated by `useRealtime` when `new_comment` / `comment_handled` arrives.

## Contact Management

### Contacts page (`src/app/(dashboard)/contacts/page.tsx`)

- Paginated table (50 per page) with search, platform filter, funnel stage filter
- Create new contact + auto-create conversation
- Export contacts as CSV or JSON
- **Delete contact** with confirmation modal:
  - If the contact has any recorded transactions (tips, PPV, subscriptions) → **archived** instead of deleted
  - If no transactions → **hard deleted** (cascade removes profile, conversations, messages, notes)
  - Toast notification indicates whether contact was deleted or archived

### Contact API (`src/server/api/routers/contacts.ts`)

- `list` — paginated query with filters (platform, search, funnel stage). Chatters only see assigned contacts
- `getById` — single contact with profile, conversations, notes
- `create` — creates contact + empty profile, dispatches workflow event (manager only)
- `update` — update display name, tags, isArchived (manager only)
- `delete` — checks for transactions before deleting. Has-paid contacts get archived. No-payment contacts get hard deleted (manager only)

## Settings (`src/app/(dashboard)/settings/page.tsx`)

Tabs:
1. **Personalidad** — Per-platform personality configuration (role, tone, style, goals, restrictions, example messages). Includes a **Voice/Brand presets grid** at the top: 5 starter presets (`PERSONALITY_PRESETS` in `personality-presets.tsx` — Friendly / Professional / Quirky / Provocative / Mysterious) with predefined values for `tone`, `style`, `messageLength`, `goals`, `restrictions`, `customInstructions`. Click applies the values to the form for the creator to edit on top.
2. **Instrucciones globales** — Global AI instructions + language settings (response language + analysis language dropdowns)
3. **Modos conversacion** — OnlyFans conversation modes configuration + A/B experiments section
4. **Modelo IA** — AI provider and model selection per task
5. **Scoring** — Per-platform scoring weights, benchmarks, funnel thresholds, contact age factor
6. **Templates** — Message templates
7. **Auto-respuestas** — Per-platform auto-response configuration
8. **API & Webhooks** — API keys management + outgoing webhooks configuration
9. **Telegram** — Telegram bot integration settings
10. **Cuenta** — Account settings + email notification preferences (3 toggles)

## Contact Scoring

Contacts have behavioral profiles (`contactProfiles` table) with:
- `engagementLevel` (0-100)
- `paymentProbability` (0-100)
- `funnelStage` (cold → curious → interested → hot_lead → buyer → vip)
- `estimatedBudget` (low/medium/high/premium)
- `responseSpeed`, `conversationDepth`
- `behavioralSignals` (JSONB: message count, sentiment trend, topic frequency, etc.)
- `scoringHistory` (JSONB: historical engagement + payment probability snapshots)
- `churnScore` (0-100) — predicted churn risk
- `churnFactors` (JSONB: breakdown of 5 weighted factors)
- `churnUpdatedAt` (timestamp)

Scoring is updated asynchronously via BullMQ worker when messages are sent **or when public comments are received** (`AnalysisJobData.source` = `"message"` | `"comment"`). The worker dispatches `updateContactProfile()` with a target `{type, id}` so the resulting sentiment is written back to the correct table (`messages` or `socialComments`). This means a fan who only engages publicly via comments still accumulates engagement, sentiment trend and churn signals. Churn score is calculated in real-time during the scoring pipeline and recalculated in batch every 6 hours.

### Contextual Scoring by Platform

Scoring weights and benchmarks can be customized per platform via `platformScoringConfigs` table. Configuration merges in 3 layers: DEFAULT → PLATFORM_DEFAULT → creator override.

**Platform defaults** (`PLATFORM_SCORING_DEFAULTS` in `scoring.ts`):
- **OnlyFans**: maxMsgLength: 100, maxMessages: 15, intent weight: 0.35
- **Telegram**: maxMessages: 50, recencyHours: 336, convCount weight: 0.15
- **Twitter/Reddit**: depth weight: 0.10, sentiment weight: 0.25
- **Instagram**: global defaults (baseline)

**Contact age factor**: Optional boost for new contacts. When enabled, engagement is multiplied by a factor that decays linearly from `boostFactor` to 1.0 over `newContactDays`. Disabled by default.

**API** (`src/server/api/routers/scoring-config.ts`):
- `getByPlatform(platformType)` — merged config (defaults + override)
- `getDefaults(platformType)` — platform defaults (read-only)
- `upsert({ platformType, engagementWeights?, paymentWeights?, benchmarks?, funnelThresholds?, contactAgeFactor? })` — owner only
- `resetToDefaults(platformType)` — delete override, revert to defaults

## Churn Prediction

### Algorithm (`src/server/services/churn-prediction.ts`)

`calculateChurnScore(signals, profile, contact)` returns a score 0-100 based on 5 weighted factors:

| Factor | Weight | Logic |
|--------|--------|-------|
| Recency decay | 0.30 | Days inactive: 0d=0, 3d=15, 7d=35, 14d=60, 30d=90, 60d+=100 |
| Engagement drop | 0.25 | % drop from peak in scoringHistory |
| Sentiment trend | 0.15 | sentimentTrend [-1,1] mapped to [100,0] |
| Frequency decline | 0.15 | avgTimeBetweenMessages thresholds |
| Funnel stage | 0.15 | cold=80, curious=50, interested=30, hot_lead=15, buyer=10, vip=5 |

Risk levels: `low` (0-24), `medium` (25-49), `high` (50-74), `critical` (75-100)

### Integration
- **Real-time:** Calculated after `updateContactProfile()` in `profile-updater.ts`, stored in `contactProfiles`
- **Batch:** `computeAllChurnScores(db)` runs every 6 hours via worker scheduler, catches contacts with no recent messages
- **Alerts:** When VIP/buyer/hot_lead crosses into high risk → creates notification + sends churn alert email
- **Dashboard:** `ChurnPanel` component (`src/components/dashboard/churn-panel.tsx`) shows risk distribution bar + top at-risk contacts
- **API:** `intelligence.getChurnDashboard` (counts + top 20 at-risk), `intelligence.getContactChurnDetails` (per-contact factors + actions)
- `getSuggestedActions(funnelStage)` returns 3 retention actions per funnel stage

## Audience Insights

### Service (`src/server/services/audience-insights.ts`)

Per-platform analytics aggregated from data already accumulated by the scoring pipeline (DMs **and** comments — comment authors are auto-linked as contacts so their signals contribute equally).

`computeAudienceInsights(db, creatorId, { sinceDays })` runs three passes:
1. **Stats SQL aggregate** (`drizzle.sql`) — per platform: contact count, avg engagement / payment / churn, count per funnel stage (`COUNT(*) FILTER WHERE`).
2. **Revenue SQL aggregate** — per platform: `SUM(amount)` and `COUNT(*)` of `fanTransactions` since the window start.
3. **Top topics in JS** — pulls the top 500 profiles by `engagementLevel`, aggregates `behavioralSignals.topicFrequency` JSONB in memory. Capped to a known volume to avoid scanning the entire dataset.

Returns:
- `perPlatform[]` — `{platformType, contactCount, avgEngagement, avgPayment, avgChurn, funnelDistribution, conversionRate, revenueCents, transactionCount, topTopics[]}` ordered by contact count.
- `totals` — global rollup with weighted averages and overall conversion rate (% of contacts in `buyer` or `vip`).

### API (`src/server/api/routers/intelligence.ts`)

- `audienceInsights` query — accepts `{sinceDays: 1-365}` (default 30), returns the full payload above. No mutations.

### UI (`src/app/(dashboard)/insights/page.tsx`)

- Period selector (7/30/90 days) at the top.
- Top-line stat cards: total contacts, avg engagement, global conversion rate, revenue in window.
- Per-platform card grid: platform header, mini stats (engagement / payment / conversion / revenue), funnel distribution as a stacked colored bar with legend chips, top topics as indigo pills with frequency.
- Empty state when no data has been accumulated yet.
- Sidebar link "📈 Insights" (access: manager+).

## Unified Calendar

### API (`intelligence.unifiedCalendar`)

Single tRPC query that joins `scheduledPosts` + `scheduledMessages` for a given month and returns events with a discriminated `type`:
- `{type: "post", id, date, title, content, status, platforms[], isRecurring}` — from `scheduledPosts`.
- `{type: "message", id, date, title, content, status, platforms[], contactName}` — from `scheduledMessages` joined with `contacts` to surface the recipient name.

Sorted by date ascending. Limited per-month query keeps payloads small.

### UI (`src/app/(dashboard)/calendar/page.tsx`)

- Month grid 7×6, same shape as the scheduler calendar but rendering heterogeneous events.
- Chips are differentiated by icon (📅 post / 💬 message) plus platform glyph, status color, and the `↻` glyph for recurring posts.
- Click on a chip routes to `/scheduler` or `/scheduled` based on the event type.
- Filter pills at the top to toggle posts / messages.
- Sidebar link "🗓️ Calendario" (access: manager+).

## Sequences and Follow-Up

### Overview

Automated message sequences for nurturing new contacts and re-engaging inactive ones. Sequences are multi-step workflows with configurable delays and actions.

### Schema

- **`sequences`** — Per-creator sequence definitions with steps (JSONB), type (nurturing/followup/custom), enrollment criteria, counters (totalEnrolled/Completed/Converted)
- **`sequenceEnrollments`** — Tracks each contact's progress through a sequence (currentStep, status, nextStepAt)

### Engine (`src/server/services/sequence-engine.ts`)

- `enrollContact(db, sequenceId, contactId, creatorId)` — Creates enrollment, calculates first nextStepAt, prevents duplicate enrollment
- `processSequenceStep(db, enrollmentId)` — Executes current step action (send_message or create_notification), advances to next step or marks completed
- `cancelEnrollment(db, enrollmentId)` — Cancels active enrollment
- `checkSequenceSteps(db)` — Scheduler function: finds enrollments with `nextStepAt <= now`, enqueues for processing
- `getSequenceStats(db, sequenceId)` — Enrollment counts by status, conversion rate

### Step actions
- `send_message` — Sends message to contact's active conversation with variable interpolation (`{{displayName}}`, `{{username}}`)
- `create_notification` — Creates notification for the creator

### Templates (`src/server/services/sequence-templates.ts`)

- **FOLLOWUP_3_7_14** — 3 steps at 3, 7, 14 days for re-engagement
- **NURTURING_WELCOME** — 3 steps at 0, 3, 7 days for onboarding new contacts
- `createDefaultSequences(db, creatorId)` — Creates both templates (inactive by default)

### Auto-enrollment

`checkInactivityFollowups(db)` in `workflow-scheduler.ts` runs every 30 minutes:
- Finds active followup sequences with enrollment criteria
- Matches contacts inactive > X days in specified funnel stages
- Auto-enrolls matching contacts not already enrolled

### Workflow integration

Workflow engine supports `advance_sequence` action type:
- Action config: `{ sequenceId: string }`
- Enrolls the contact in the specified sequence
- Enables workflows like: trigger `new_contact` → action `advance_sequence` (auto-enroll in nurturing)

### Queue

`sequenceQueue` ("sequence-processing") with BullMQ:
- Job types: `process_step` (enrollment step execution), `enroll` (enrollment via queue)
- Worker concurrency: 3, attempts: 3, exponential backoff 5s

### Scheduler (in `worker.ts`)
- `checkSequenceSteps(db)` — every 5 minutes (each scheduler tick)
- `checkInactivityFollowups(db)` — every 30 minutes (every 6th tick)

### API (`src/server/api/routers/sequences.ts`)

- `list` — all sequences for the creator
- `getById` — sequence with stats + enrollments (top 50)
- `create` — create sequence with steps
- `update` — update name/description/steps/criteria
- `toggleActive` — activate/deactivate
- `getStats` — enrollment counts + conversion rate
- `getEnrollments` — paginated enrollments with contact info
- `cancelEnrollment` — cancel specific enrollment
- `enrollContact` — manual enrollment

### UI (`src/app/(dashboard)/sequences/page.tsx`)

- Sequence list with type badge, active status, step count, enrollment stats
- Create form with step builder (delay + action type + content per step)
- Expandable detail view per sequence: stats grid, steps timeline, enrollments list
- Activate/deactivate toggle

## Email Transactional (Resend)

### Service (`src/server/services/email.ts`)

Singleton Resend client with graceful degradation (no-op if `RESEND_API_KEY` not set).

Methods:
- `sendVerificationEmail(to, verifyUrl)` — account verification
- `sendPasswordResetEmail(to, resetUrl)` — password reset
- `sendDailySummary(to, data)` — daily summary: new contacts, messages, at-risk count
- `sendWeeklySummary(to, data)` — weekly summary: contacts, revenue, churn rate, top contacts
- `sendChurnAlert(to, data)` — churn risk alert with at-risk contact list
- `wrapTemplate(title, content)` — branded HTML wrapper with gradient header

### Queue and Worker

`emailQueue` ("email-send") with BullMQ, 3 attempts, exponential 2s backoff. Worker switches on job type and calls appropriate email service method.

### Email Summaries (`src/server/services/email-summary.ts`)

- `generateDailySummary(db, creatorId)` — queries new contacts, messages, at-risk count for today
- `generateWeeklySummary(db, creatorId)` — queries contacts, revenue, churn rate, top 5 contacts for the week
- `checkAndSendDailySummaries(db)` — finds creators with dailySummaryEnabled, enqueues emails
- `checkAndSendWeeklySummaries(db)` — finds creators with weeklySummaryEnabled, enqueues on Mondays
- Scheduler runs hourly, triggers at 9 UTC with Redis NX dedup keys

### Creator Preferences

3 columns on `creators` table:
- `emailNotificationsEnabled` (default true) — churn alerts and important notifications
- `dailySummaryEnabled` (default false) — daily activity summary
- `weeklySummaryEnabled` (default true) — weekly performance summary

UI: Settings → Cuenta tab, "Notificaciones por email" section with 3 toggles.

### Auth Integration

- Register (`/api/auth/register`) → enqueues verification email
- Forgot password (`/api/auth/forgot-password`) → enqueues password reset email

### Email Verification (obligatoria)

Verificar el email es **obligatorio** para acceder al dashboard.

- **Token con expiración:** `creators.emailVerificationToken` + `emailVerificationExpiresAt` (24h). Generado en el registro y en cada reenvío.
- **`/api/auth/verify-email`** valida el token, comprueba que no esté expirado (redirige a `/login?error=token-expired` si lo está), marca `emailVerified = true` y limpia token + expiry.
- **Gate en el dashboard** (`src/app/(dashboard)/layout.tsx`): si `!emailVerified`, renderiza `<EmailVerificationGate>` (`src/components/auth/email-verification-gate.tsx`) en vez del dashboard — pantalla de bloqueo con reenvío, "recargar" y cerrar sesión.
- **Reenvío:** `account.resendVerification` (tRPC) — regenera token+expiry y reencola el email. Rate limit `resendVerification` (3/10 min por usuario). `account.getVerificationStatus` expone `{email, emailVerified}`.
- **Grandfathering:** las cuentas previas a la feature quedarían bloqueadas (default `email_verified = false`). Ejecutar `npm run grandfather:email-verified` (idempotente, soporta `--dry-run` y `--before=YYYY-MM-DD`) tras el `db:push`.
- Nota: el registro ya no loguea la URL/token de verificación (SEC-1).

## Billing (Stripe)

- **Planes con self-checkout:** `starter`, `pro` y (opcional) `business`. Price IDs en `PLAN_PRICE_IDS` (`src/lib/stripe.ts`), leídos de `STRIPE_{STARTER,PRO,BUSINESS}_PRICE_ID`.
- **Business self-checkout condicional:** `isPlanCheckoutable("business")` es `true` solo si `STRIPE_BUSINESS_PRICE_ID` está configurado. Si lo está, `billing.createCheckoutSession` acepta `business` y la `PricingTable` muestra el botón de checkout; si no, Business cae al CTA "Contactar" (mailto) y el router rechaza el checkout con `BAD_REQUEST`. `billing.getPlan` expone `businessCheckoutEnabled` para que la UI decida.
- **Webhook** (`/api/webhooks/stripe`): `getPlanFromPriceId` mapea también `business`, así que la sincronización de plan funciona automáticamente al activar el price ID.
- El precio mostrado para Business en `pricing-table.tsx` (€99) debe coincidir con el price real configurado en Stripe.

## Revenue Tracking

- **Table:** `fanTransactions` — per-contact transaction records
- **Types:** tip, ppv, subscription, custom
- **Amount:** stored in cents (integer)
- **API:** `src/server/api/routers/revenue.ts` — CRUD, summaries, top spenders, ROI calculations, export
- **UI:** Revenue section in contact panel with inline transaction form

## Public API

### REST API (`/api/v1/`)

All endpoints require `Authorization: Bearer ff_live_xxx` header. API access is plan-gated: Pro (read-only), Business (full read/write). Rate limited per key: 60 req/min (Business), 30 req/min (Pro).

| Endpoint | Method | Description | Access |
|----------|--------|-------------|--------|
| `/api/v1/contacts` | GET | List contacts (paginated, filters: search, platform, funnel_stage) | Pro+ |
| `/api/v1/contacts` | POST | Create contact + empty profile | Business |
| `/api/v1/contacts/[id]` | GET | Contact detail + profile | Pro+ |
| `/api/v1/conversations` | GET | List conversations (paginated, filter by status) | Pro+ |
| `/api/v1/conversations/[id]/messages` | GET | Messages for a conversation (paginated) | Pro+ |
| `/api/v1/analytics/overview` | GET | Summary: totalContacts, revenue30d, avgEngagement, funnelDistribution | Pro+ |
| `/api/v1/comments` | GET | List public comments (filters: post_id, unhandled, paginated) | Pro+ |
| `/api/v1/comments` | POST | Ingest a public comment (auto-creates post if needed, idempotent by externalCommentId) | Business |

### API Keys (`src/server/services/api-keys.ts`)

- Key format: `ff_live_` + 32 hex chars (16 random bytes)
- Storage: SHA-256 hash for lookup + AES-256-GCM encrypted full key
- Key shown only once at creation, never retrievable after
- `createApiKey`, `validateApiKey` (by hash lookup), `revokeApiKey`, `listApiKeys`

### Auth Middleware (`src/server/api/middleware/api-key-auth.ts`)

- Extracts `Bearer` token, validates via `validateApiKey`
- Checks plan: Pro = readonly, Business = full, others = 403
- In-memory rate limiting per keyId with sliding window
- Returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers

### tRPC Routers

- `apiKeys` (`src/server/api/routers/api-keys.ts`) — list, create, revoke (ownerProcedure)
- `webhooksOutgoing` (`src/server/api/routers/webhooks-outgoing.ts`) — list, create, update, delete, getDeliveryLogs, testWebhook (ownerProcedure)

## Outgoing Webhooks

### Overview

Webhooks send HTTP POST notifications to external URLs when events occur in FanFlow. Each webhook config has a secret used for HMAC-SHA256 signature verification.

### Events

| Event | Trigger Location | Payload |
|-------|-----------------|---------|
| `contact.created` | `contacts.ts` router (create mutation) | contactId, username, platformType |
| `contact.updated` | `profile-updater.ts` (after scoring update) | contactId, engagementLevel, paymentProbability, funnelStage |
| `message.received` | `worker.ts` (message-analysis handler) | contactId, conversationId, messageId, sentiment, topics |
| `funnel_stage.changed` | `profile-updater.ts` (on stage change) | contactId, previousStage, newStage |
| `transaction.created` | `revenue.ts` router (create mutation) | transactionId, contactId, type, amount |
| `comment.received` | `social-comments.ts` router + `/api/v1/comments` | commentId, postId, platformType, authorUsername, authorContactId, content |
| `post.scheduled` | `scheduler.ts` router (create mutation) | scheduledPostId, targetPlatforms, scheduleAt |
| `post.publishing` | `worker.ts` (scheduledPost worker, webhook-routed platforms) | scheduledPostId, platform, title, content, mediaUrls, platformConfig |
| `post.published` | `worker.ts` (after native publish success) | scheduledPostId, platform, externalId, externalUrl |
| `post.failed` | `worker.ts` (on per-platform failure) | scheduledPostId, platform, error |

### Delivery

- `webhookDeliveryQueue` ("webhook-delivery") with BullMQ, 3 attempts, exponential 5s backoff
- Worker concurrency: 5
- Request headers: `X-FanFlow-Signature: sha256=HMAC(payload, secret)`, `X-FanFlow-Event`, `Content-Type: application/json`
- All deliveries logged in `webhookDeliveryLogs` (statusCode, responseBody, error, attempt)
- 10 second timeout per delivery

### Dispatcher (`src/server/services/webhook-dispatcher.ts`)

- `dispatchWebhookEvent(db, creatorId, event, payload)` — finds active configs with matching event, enqueues delivery (fire-and-forget)
- `generateWebhookSignature(payload, secret)` — HMAC-SHA256 signature
- `deliverWebhook(db, webhookConfigId, event, payload, url, secret, attempt)` — POST + log result

## Public Comments Inbox

### Overview

Unified inbox for public comments on creator posts (Reddit, Instagram, Twitter), separate from DM conversations. Reuses the same AI infrastructure but with a prompt calibrated for public visibility (no pricing, no DM nudging, brevity). Comments funnel through the same scoring/churn pipeline as DMs so a fan who only engages publicly can still advance.

### Schema

- **`socialPosts`** — creator posts with `commentsCount` and `unhandledCount` cached for fast list ordering. Unique by `(creatorId, platformType, externalPostId)`.
- **`socialComments`** — threaded via `parentCommentId`, optionally linked to a `contacts` row via `authorContactId` (matched by `platformUserId` or `username`). Tracks `isHandled` + `handledById` + `handledAt`. Deduplication by `(creatorId, platformType, externalCommentId)`. Creator replies stored as child comments with `role = "creator"`. `source` distinguishes `manual` / `api` / `polling`.

### Ingestion Helper (`src/server/services/social-comments-ingest.ts`)

Shared helper used by the tRPC router, the REST endpoint and the Reddit poller:
- `linkOrCreateCommentAuthor(db, creatorId, platformType, author)` — match priority `platformUserId` → `username` → create lightweight contact + empty profile + dispatch `contact.created` (with `metadata.source = "comment"`). This is what lets pure commenters accumulate signals.
- `enqueueCommentAnalysis({...})` — pushes a job into `analysisQueue` with `source: "comment"` so the worker writes the resulting sentiment back to `socialComments` rather than `messages`.

### Reddit Polling (`src/server/services/reddit-poller.ts`)

Pull-based ingestion for Reddit (no OAuth callback needed thanks to script-type apps):
- Worker scheduler (5-min tick in `worker.ts`) calls `pollRedditComments(db)`.
- For each native+active Reddit `socialAccount`, fetches a fresh OAuth token (cached for the cycle) and iterates the 30 most recent `socialPosts` with `externalPostId`.
- `GET /comments/{id}.json?depth=2&sort=new` → flatten the tree, dedupe by `externalCommentId` (`t1_xxx`), skip own-account replies.
- For each new comment: `linkOrCreateCommentAuthor` → insert with `source: "polling"` → `comment.received` webhook → `enqueueCommentAnalysis` → `publishEvent("new_comment")` SSE.
- Rate limit: ~55 req/min (1.1s sleep between posts) to stay under Reddit's 60/min OAuth quota.
- Native publishes from the scheduler are mirrored into `socialPosts` (`onConflictDoNothing`) so they automatically enter the polling pool.

### Twitter / X Polling (`src/server/services/twitter-poller.ts`)

Polling fallback for replies on tracked tweets:
- 5-min tick in `worker.ts` calls `pollTwitterComments(db)`.
- For each native+active Twitter `socialAccount`: `ensureFreshTwitterToken` (refresh + persist if expired), then iterate the 20 most recent `socialPosts` with `externalPostId`.
- `GET /2/tweets/search/recent?query=conversation_id:{id} -from:{selfId} -is:retweet` with `expansions=author_id` and `user.fields=username,name` for handle resolution.
- `start_time` derived from `lastCommentAt - 60s` to minimize payload without missing the polling window.
- 1.5s sleep between posts (~40 req/min — comfortably under Twitter v2 recent search quotas).
- Same ingest pipeline as Reddit: `linkOrCreateCommentAuthor` → insert (`source: "polling"`) → webhook → analysis → SSE.
- Tweets published from the scheduler are mirrored into `socialPosts` so they enter the polling pool automatically.

### Twitter / X Filtered Stream (real-time, opt-in)

When `TWITTER_BEARER_TOKEN` is set, a persistent worker subscribes to `/2/tweets/search/stream` for **real-time replies** (sub-second latency vs the 5-min poll cycle).

- **`twitter-stream-rules.ts`**: wraps `/2/tweets/search/stream/rules` with app-only bearer auth.
  - Tag encoding `c:{creatorId}:p:{postId}` — encodes the routing in the rule itself so we can dispatch the matched tweet without an extra DB lookup. `parseRuleTag()` reverses the encoding.
  - `syncStreamRules(db)` reconciles every 5 min: posts tracked locally but missing a rule → add; rules with stale or unknown tag → delete. Rule id persisted in `socialPosts.metadata.twitterStreamRuleId`.
  - `addStreamRuleForPost(db, args)` for immediate insertion right after a publish, so the rule is live before the first reply lands.
  - Batching: 25 rules per add request, 100 ids per delete request (Twitter limits).
- **`twitter-stream-worker.ts`**: singleton `TwitterStreamRunner` with persistent HTTP connection.
  - Reconnect with exponential backoff (2^n capped at 60 s) using `AbortController`.
  - Streaming JSON parser: decoder + line buffer + `indexOf("\n")` (Twitter emits one object per line plus keepalive heartbeats which are blank lines).
  - For each matched tweet: parse the rule tag → look up the target post → run the standard ingest pipeline with `source: "stream"`.
  - Skips own-account replies defensively (also filtered at the rule level).
- **Coexistence with the poller**: both paths run when the bearer is set. `socialComments.externalCommentId` is unique so the poller deduplicates automatically when the stream got the comment first (and vice-versa when the stream is reconnecting).
- **Disable**: simply unset `TWITTER_BEARER_TOKEN`. The stream worker becomes a no-op at boot; rules already in Twitter remain (the next `syncStreamRules` from a future deployment will clean them).

### Instagram Webhooks (`src/app/api/webhooks/instagram/route.ts`)

Push-based ingestion via Meta's webhooks:
- **GET** verification: matches `hub.verify_token` against `META_WEBHOOK_VERIFY_TOKEN`, echoes `hub.challenge` back. Configured once in the FB app's Webhooks dashboard.
- **POST** event delivery:
  1. Validates `X-Hub-Signature-256` (HMAC SHA-256 of the raw body using `META_WEBHOOK_APP_SECRET`) with a constant-time compare.
  2. For each `entry.id` (= Instagram Business Account id), looks up the matching `socialAccount` via `externalAccountId`. Multi-creator dispatch supported.
  3. For each `change.field === "comments"` event: lazy-creates the parent `socialPosts` row if the IG media was published outside FanFlow, deduplicates by `externalCommentId`, resolves `parent_id` for threaded replies, and runs the standard ingest pipeline (`source: "webhook"`).
- Meta delivers retries on 5xx; idempotency guaranteed by the unique index on `(creatorId, platformType, externalCommentId)`.

### AI Service (`src/server/services/ai-comment-suggester.ts`)

- `generateCommentSuggestion(config, input)` — public-context prompt with explicit restrictions (no prices, no DM nudge, short responses).
- 3 variants: CASUAL / ENGAGEMENT / RETENTION (no SALES variant for public surface).
- Reuses `callAIProvider()` so all 5 providers work without changes.

### API

**tRPC** (`src/server/api/routers/social-comments.ts`):
- `listPosts` — filters by platform and `onlyWithUnhandled`; ordered by unhandled count + recency.
- `getPost`, `listComments` (per post, optional `onlyUnhandled`, `includeHidden`). By default `hidden` comments are excluded; `reported` always show up so the creator can review them.
- `createPost` (manager) — manual post creation for testing/external workflows.
- `createComment` — auto-links author via `linkOrCreateCommentAuthor`, enqueues analysis, publishes SSE.
- `replyToComment` — inserts a `role = "creator"` child comment + auto-marks parent as handled + decrements `unhandledCount` + publishes SSE.
- `markHandled` — toggle handled state with delta on post counter + publishes SSE.
- `setModerationStatus` — sets `moderationStatus` to `visible | hidden | reported` with optional `reason`. Records `moderatedAt`/`moderatedById`, audit-logs the action, and adjusts `unhandledCount` when a pending comment is hidden/reported (so it stops counting as pending).
- `suggest` — generate AI variants for a specific comment.
- `coach` — public-thread coaching (see "Public-Thread Coaching" below).
- `overview` — counters for header (posts, comments, unhandled).

**REST** (`src/app/api/v1/comments/route.ts`):
- `GET /api/v1/comments` (Pro+) — list with filters `post_id`, `unhandled`, paginated.
- `POST /api/v1/comments` (Business) — idempotent ingest (auto-creates post by `externalPostId` if missing, dedupes by `externalCommentId`). Same auto-link + analysis + SSE pipeline as tRPC. **Endpoint-specific rate limit**: 30 req/min per API key (stricter than the global per-key limit) via `RATE_LIMITS.commentsIngest`. Returns 429 with `Retry-After` + `X-RateLimit-*` headers when exceeded.

### Realtime Events

`RealtimeEventType` extended with `new_comment` and `comment_handled`. Published from `createComment`, `replyToComment`, `markHandled`, the REST endpoint, and the Reddit poller. The shared `useRealtime` hook invalidates `socialComments.{listPosts,listComments,getPost,overview}` and shows a browser `Notification` when the tab is hidden and a fan (not creator) comments.

### Public-Thread Coaching (`src/server/services/public-thread-coach.ts`)

Strategic AI analysis for replying in public threads. Optimized for **brand reputation**, not private conversion — explicitly avoids price talk, DM nudges, anything that could be screenshotted against the creator.

- `generatePublicCoaching(config, input)` — input includes platform, post context (title/content/url), the recent thread (last 50 comments) and the focus comment. Output is a strict JSON parsed via the same tolerant `tryParseCoaching` pattern (strip `<think>`, accept ```` ```json ```` fences, slice between `{...}`).
- Output shape:
  - `situationRead` — 2-3 sentence read of the thread.
  - `audienceRisk` — `low | medium | high` (risk of damaging the brand if mishandled).
  - `suggestedTone` — short phrase (e.g. "cálido y breve", "asertivo sin defenderse", "ignorar").
  - `tactics[]` — 3-5 named tactics with `description`, `example` (literal copy-pasteable reply) and `riskLevel`.
  - `whatToAvoid[]` — 2-4 concrete things not to say.
  - `suggestedNextMove` — single recommended action ("respond now", "wait", "ignore", etc).
- The router endpoint `socialComments.coach` resolves AI config for task `"coaching"`, enforces `checkAIMessageLimit`, and logs token usage.
- UI: `CoachingPublicModal` with risk badge, expandable tactics with **"Usar este ejemplo"** button that fills the reply textarea, what-to-avoid card, and next-move highlight.

### Moderation

- Schema: `commentModerationStatusEnum = visible | hidden | reported` plus `moderatedAt`, `moderatedById`, `moderationReason`, **`platformModerationApplied: bool`** and **`platformModerationError: text`** columns.
- `hidden` removes the comment from default listings (creator-side default). `reported` keeps it visible with a 🚩 badge so the creator can review and decide.
- Setting a pending comment to `hidden`/`reported` decrements `unhandledCount` (so it stops counting as work to do); flipping back to `visible` increments it again.
- All transitions audit-logged (`comment.moderation_visible | hidden | reported`).
- UI: discrete buttons in the reply panel (Restaurar / 🚩 Reportar / 🔒 Ocultar with confirm). Comments themselves show 🚩/🔒 pills inline. A checkbox **"Aplicar también en {platform}"** lives below the buttons.

**Platform moderation actions (`platform-moderation.ts`)** — applied when the creator ticks the checkbox:
- **Twitter / X**: `PUT /2/tweets/{id}/hidden` toggles `{hidden: true|false}`. The creator hides replies on their own tweet thread. Delete is not supported (the reply isn't ours).
- **Instagram**: `DELETE /{comment-id}` (requires the new `instagram_manage_comments` scope on the OAuth token). No "hide" toggle exists for IG comments. Restoring a deleted comment is not possible via API.
- **Reddit**: not supported — Reddit's mod API requires being a moderator of the subreddit, which is rare for creators. The UI surfaces this with an explicit "— no soportado por la API" hint.
- Result is persisted on the comment: `platformModerationApplied = true` on success, `platformModerationError` filled on failure. Badges in the UI surface both.

### UI (`src/app/(dashboard)/comments/page.tsx`)

- 2-panel responsive layout: left `PostsList` with stats and filters; center `CommentThreadPanel`.
- Thread view: chronological with creator replies indented. Handled/pending badges, contact-linked indicator, profile chips (engagement / payment / funnel), moderation pills (🚩/🔒).
- Reply panel: 2-column header with **✨ Sugerir respuesta** (`suggest` mutation, 3 colored variants) and **🧭 Coaching IA** (full thread analysis modal). Reply textarea, Responder/Resuelto buttons, plus a moderation row.
- Sidebar link "🗨️ Comentarios" (access: all team members).
- Auto-refreshes via SSE — no manual reload needed when comments arrive from polling or external ingestion.

## Publishing Scheduler

### Overview

Schedule public posts to native APIs (**Reddit, Twitter / X, Instagram**) or to any platform via outgoing webhooks. **Multi-cuenta**: a creator can connect multiple accounts on the same platform; the composer picks one explicitly or falls back to the first active. Reddit uses script-type OAuth password grant; Twitter uses OAuth 2.0 PKCE; Instagram uses Facebook Login + Graph API.

### Schema

- **`socialAccounts`** — rows keyed by `(creatorId, platformType, externalAccountId)` (unique). Multiple rows per `(creator, platform)` are allowed for multi-account scenarios. `connectionType` is `native` (encrypted credentials and/or OAuth tokens) or `webhook` (no credentials, just a flag).
  - For Reddit native: `encryptedCredentials` holds the AES-256-GCM ciphertext of `{clientId, clientSecret, username, password}`.
  - For Twitter / Instagram OAuth: `encryptedOauthAccessToken`, `encryptedOauthRefreshToken` (twitter only — IG has no refresh), `oauthExpiresAt`, `oauthScopes[]`, `externalAccountId` (the platform's account id).
- **`scheduledPosts`** — scheduled posts with `targetPlatforms` array, `platformConfigs` JSONB (e.g. `{reddit: {subreddit, kind, url, flairId}, twitter: {tweet, thread[], accountId?}, instagram: {imageUrl, accountId?}}`), `status` enum (scheduled/processing/posted/partial/failed/cancelled), `attempts`, `lastError`, `externalPostIds` JSONB (`{platform: {id, url}}`), `jobId` (BullMQ job), `recurrenceRule` JSONB (optional), `recurrenceCount`.
- **`oauthPendingFlows`** — short-lived state for OAuth: `state` (unique CSRF token), `creatorId`, `provider`, `codeVerifier` (PKCE), `expiresAt` (10 min TTL). Consumed by the callback route.

### Reddit Publisher (`src/server/services/scheduler-publisher.ts`)

- `verifyRedditCredentials(creds)` — auth handshake + `/api/v1/me` check, returns `{ok, username}`.
- `publishToReddit(encryptedCreds, post, creatorId?)` — decrypts, OAuth password grant (cached when `creatorId` passed), `POST /api/submit`. Supports four kinds:
  - `kind: "self"` (default) — text post; sends `text` field with the content.
  - `kind: "link"` — link to an external URL; requires `url`. Sends `resubmit=true`.
  - `kind: "image"` — image post via public URL; requires `url`. Reddit accepts external public URLs (i.imgur, redd.it, S3...) directly without the `media/asset.json` upload flow. The URL must be publicly accessible or Reddit rejects the submission.
  - `kind: "video"` — native video; requires `url` (R2/CDN source) and `posterUrl` (public JPG/PNG thumbnail). Reddit only accepts videos hosted on its own CDN, so the publisher re-uploads through `reddit-video-upload.ts` first (see below).
  - Returns `{success, externalId, externalUrl, error}`. On 401, invalidates the cached token automatically.
- **`reddit-video-upload.ts`**: `uploadRedditVideoFromUrl({accessToken, videoUrl, userAgent?})` runs the asset-lease + S3 multipart dance:
  1. `POST /api/v1/media/asset.json?filepath=...&mimetype=...` → lease `{args: {action, fields[]}, asset: {asset_id}}`.
  2. Fetch source bytes (R2 / CDN), then multipart POST to `lease.args.action` with all lease fields (key first) + the file last — S3 enforces field order.
  3. Returns the final CDN URL `${action}/${key}` for use on `/api/submit?kind=video`.
  - 5-min timeout on the S3 upload (videos can be large). All errors bubble up with HTTP status context.
- Title trimmed to 300 chars; supports `flair_id`, `nsfw`, `spoiler` flags.
- User-Agent: `FanFlow/1.0 (by /u/fanflow)`.
- **OAuth token cache (Redis)**: `getRedditAccessTokenCached(creatorId, creds)` stores tokens with 50-min TTL (Reddit tokens last 60 min — 10-min cushion). Cache miss → fetch + store. Failures fall through to direct fetch silently. `invalidateRedditTokenCache(creatorId)` for forced refresh on 401. Both publisher and `reddit-poller` use the cached version, going from ~289 token fetches/day per account to ~30.
- Exports `getRedditAccessToken`, `getRedditAccessTokenCached`, `invalidateRedditTokenCache`, `decryptRedditCredentials`, `REDDIT_USER_AGENT`.

### Twitter / X Publisher (OAuth 2.0 PKCE)

- **`oauth-twitter.ts`**: PKCE S256 (`generatePkce`), `buildTwitterAuthorizationUrl`, `exchangeTwitterCode`, `refreshTwitterToken`, `getTwitterMe`. Scopes: `tweet.read tweet.write users.read offline.access` (offline → refresh token).
- **`twitter-publisher.ts`**: `publishToTwitter({accessToken, tweet, thread[], username, mediaUrls?})` chains real threads via `POST /2/tweets` with `reply.in_reply_to_tweet_id` linked to the previous tweet id. Each follow-up's id becomes the parent of the next. `mediaUrls` attach to the main tweet only — X allows either **1 video** OR **up to 4 images**, never both (the publisher throws a clear error if mixed).
- **`twitter-media-upload.ts`**: `uploadTwitterMediaFromUrl({accessToken, mediaUrl})` auto-routes by extension. Images → single-part multipart POST (≤5 MB). Videos → chunked flow `INIT → APPEND (4 MB chunks) → FINALIZE → STATUS poll` until `processing_info.state === "succeeded"` (Twitter transcodes async; referencing a still-processing media_id breaks the tweet). Polling honors `check_after_secs` hints, capped at 5 min total. `uploadTwitterImageFromUrl` kept as a thin alias for legacy callers.
- `ensureFreshTwitterToken({encryptedAccess, encryptedRefresh, expiresAt})` checks if the token expires within 60 s and uses the refresh token if so. The worker persists the new tokens on `socialAccounts` immediately so the next call uses them.
- Env vars: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` (optional for public clients), `APP_URL`.
- Redirect URI to register with developer.x.com: `{APP_URL}/api/oauth/twitter/callback`.

### Instagram Publisher (Facebook Login → Graph API)

- **`oauth-instagram.ts`**: full chain `code → short-lived token → long-lived token (~60 days) → enumerate Facebook Pages → resolve Instagram Business Account id per page`. Scopes: `pages_show_list pages_read_engagement instagram_basic instagram_content_publish instagram_manage_comments`. **Pre-condition**: creator must have an Instagram Business/Creator account linked to a Facebook Page (clear error messages otherwise).
- **Multi-page selection**: `exchangeInstagramCode` returns `accounts[]` with one entry per FB Page that has an IG Business account linked. The OAuth callback creates / updates one `socialAccount` per IG account (multi-account schema already supports it). The creator disables the ones they don't want from `/scheduler → Cuentas`.
- **`instagram-publisher.ts`**: `publishToInstagram({accessToken, igUserId, mediaUrls, caption})` accepts a 1-10 element array and auto-routes:
  - **Single image** (`mediaUrls.length === 1`, image URL): 2-step `media → media_publish`. Returns `/p/{id}/`.
  - **Single Reel** (length 1, video URL): `media?media_type=REELS&video_url=…` → poll `status_code` until `FINISHED` → `media_publish`. Returns `/reel/{id}/`. Polling: 5s interval, 5 min cap.
  - **Carousel** (length 2-10, images and/or videos mixed): N × `media?is_carousel_item=true` (caption omitted on children — it lives on the parent). Video children are polled to FINISHED before the parent is created. Then `media?media_type=CAROUSEL&children=id1,id2,…` → poll parent → `media_publish`. Returns `/p/{id}/`.
- The `platformConfigs.instagram` JSONB uses `mediaUrls: string[]`. Back-compat: the worker also accepts legacy `mediaUrl` (single string) and `imageUrl` (oldest) so already-queued posts keep working. Media URLs must be **publicly accessible** (Instagram fetches them server-side, rejects signed URLs that expire quickly). When R2 is configured (see "Media Storage (R2)"), uploads from the composer's `MediaUploader` land in R2 and the resulting `publicUrl`s are fed directly into `platformConfigs.instagram.mediaUrls`.
- Env vars: `FB_CLIENT_ID`, `FB_CLIENT_SECRET`, `APP_URL`.
- Redirect URI to register with developers.facebook.com: `{APP_URL}/api/oauth/instagram/callback`.

### OAuth Routes

- **`GET /api/oauth/[provider]/start`** — Authenticates the session, generates a CSRF `state` + PKCE `code_verifier` (twitter), inserts into `oauth_pending_flows`, redirects to the provider authorization URL.
- **`GET /api/oauth/[provider]/callback`** — Validates and consumes `state` (no-replay), exchanges `code`, encrypts tokens, **upserts** in `socialAccounts` by `(creatorId, platformType, externalAccountId)`. Same `externalAccountId` → re-auth (update); new → multi-account insert. Errors redirect to `/scheduler?oauth_error=...`.

### Recurrence (`src/server/services/recurrence.ts`)

Lightweight rule subset (no full RFC5545):

- `RecurrenceRule = {frequency, interval?, dayOfWeek?, dayOfMonth?, hour, minute, until?, maxCount?}`
- `frequency`: `"daily" | "weekly" | "monthly"`. `weekly` requires `dayOfWeek` (0-6, Sun=0). `monthly` requires `dayOfMonth` (1-31, capped to 28 to avoid month overflow).
- `computeNextOccurrence(rule, from, occurrencesSoFar)` — returns the next `Date` after `from`, or `null` if `until`/`maxCount` already exceeded.
- `validateRecurrenceRule(rule)` — throws on invalid input; called from the tRPC router before insert.
- The worker re-arms recurring posts: after a successful publish, if the rule still has a next occurrence the worker updates `scheduleAt` to that date, increments `recurrenceCount`, enqueues a fresh delayed BullMQ job, and keeps `status = "scheduled"`. When the series ends (`until` or `maxCount` exhausted), `status` flips to `"posted"` like a one-shot. Failed/partial outcomes still throw (BullMQ retries) and do NOT advance the recurrence.

### Queue and Worker

- `scheduledPostQueue` ("scheduled-post-publish") with delayed jobs (`delay = scheduleAt - now`).
- For each platform in `targetPlatforms`, the worker resolves the **target account**: if `platformConfigs.{platform}.accountId` is set it picks that specific account; otherwise it falls back to the first active account on that platform. Allows multi-account routing per post.
- Worker iterates `targetPlatforms`:
  - **`native` + `reddit`** → calls `publishToReddit` with `creatorId` for token caching. On success, mirrors the published post into `socialPosts` (`onConflictDoNothing`) so the comment poller can pick up replies without manual setup.
  - **`native` + `twitter`** → calls `ensureFreshTwitterToken` (refreshes + persists if expired in <60s), then `publishToTwitter`. Real threads via `reply.in_reply_to_tweet_id` chained.
  - **`native` + `instagram`** → reads `platformConfigs.instagram.imageUrl` (required, public URL), decrypts access token, calls `publishToInstagram` (media create + publish).
  - **`webhook`** → dispatches `post.publishing` webhook with full payload (including `platformConfigs.{platform}` so Zapier / Make can drive the actual publish).
- Aggregates results into `externalPostIds` and computes final status (`posted` / `partial` / `failed`).
- **Recurrence handling**: after computing the base status, if `recurrenceRule` is set and at least one platform succeeded, the worker calls `computeNextOccurrence`. If a next date exists, it updates `scheduleAt`, increments `recurrenceCount`, enqueues a new delayed job, and keeps the row in `status = "scheduled"` (no separate "active series" row — single record per series).
- Retries: 3 attempts, exponential 5s backoff. Worker concurrency: 3.

### API (`src/server/api/routers/scheduler.ts`)

- **Accounts** — `listAccounts`, `connectReddit` (owner, validates + encrypts), `enableWebhookConnection` (owner), `disconnectAccount` (owner).
- **Posts** — `list` (filters: status, date range), `getById`, `calendar` (per month), `create` (manager, validates active accounts for all target platforms), `cancel`, `reschedule` (removes old job, enqueues new delayed job).

### UI (`src/app/(dashboard)/scheduler/page.tsx`)

- 3 tabs: 📅 Calendario / 📋 Lista / 🔗 Cuentas.
- **Calendar** (`scheduler-calendar.tsx`): month grid 7×6, post chips colored by status, click chip opens detail, click empty day opens composer pre-filled with date. Recurring posts show a `↻` glyph in the chip.
- **List** — sortable table with status badges and inline detail view; recurring posts show a `↻` purple pill next to the title.
- **Composer** (`post-composer.tsx`): platform selector (disabled if not connected), title, content, datetime-local picker.
  - **Multi-account selector**: when a platform has >1 active accounts, a dropdown appears letting the creator pick which account to publish from. Default is "Primera disponible (auto)" → the worker picks the first active. The choice is persisted as `platformConfigs.{platform}.accountId`.
  - **Reddit block**: subreddit input, kind selector (Texto / Enlace / Imagen) with conditional URL field for link/image.
  - **Twitter / X block**: main tweet textarea (270 char counter) + editable thread list with "+ Añadir al hilo" / ✕ delete per row. `platformConfigs.twitter = {tweet, thread[]}` rides intact in the `post.publishing` webhook payload so Zapier / Make can post as a native thread on X.
  - **Per-platform preview** (`post-preview.tsx`): toggle row with one button per selected platform; click renders an approximate preview in the platform's native style — Reddit subreddit card with title + body / link / image, Twitter / X numbered thread with avatar and per-tweet char count, Instagram caption + handle + media placeholder.
  - **Recurrence**: "Repetir publicación" toggle reveals a recurrence form (frequency tabs, day-of-week / day-of-month picker, hour/minute UTC, optional `until` datetime and/or `maxCount` cap).
- **Accounts** (`accounts-panel.tsx`): per-platform card; Reddit form for native (4-field credentials), **"Conectar OAuth"** link (Twitter / Instagram) that starts the OAuth flow at `/api/oauth/{provider}/start`, and "Vía webhook" for the rest.
- Sidebar link "📅 Scheduler" (access: manager+).
- **`PostComposer`** accepts an optional `initialValues` prop (`{title?, content?, platforms?, redditSubreddit?, twitterTweet?, twitterThread?}`) so other pages (notably Blog-to-Social) can open it pre-filled. Twitter drafts open with the thread editable as separate tweets, not flatten text.

## Media Storage (R2)

### Overview

Cloudflare R2 (S3-compatible) is the production storage backend for media that needs a **public URL** consumable by external platforms (Reddit accepts external image URLs in `/api/submit`, Instagram fetches the image server-side via `image_url`, Twitter pulls bytes for `/2/media/upload`). When R2 isn't configured, uploads fall back to the local filesystem under `uploads/{creatorId}/...` and the platform publishers fail with "URL not public" — so R2 is **required for native publishing of images** in any non-dev environment.

### Service (`src/server/services/r2-storage.ts`)

Thin wrapper over `@aws-sdk/client-s3` pointed at R2's S3-compatible endpoint (same code works against AWS S3, MinIO or DO Spaces by swapping the endpoint).

- `isR2Configured()` — all 5 env vars present (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`).
- `buildR2Key({creatorId, originalName, mimeType})` — namespaced key `creators/{creatorId}/{YYYY-MM-DD}/{12 random hex}.{ext}`. Stable, collision-free, easy to sweep per tenant.
- `uploadBuffer({key, body, mimeType, immutable})` — `PutObjectCommand` with `Cache-Control: public, max-age=31536000, immutable` when `immutable=true` (recommended for hashed-name media).
- `deleteObject(key)` — `DeleteObjectCommand`.
- `publicUrlFor(key)` — derive URL without uploading (for backfill / migration scripts).

### Upload Pipeline (`src/app/api/media/upload/route.ts`)

1. Auth check, MIME validation (`image/jpeg|png|gif|webp`, `video/mp4|quicktime|webm`), 50MB size cap.
2. Plan limits (`checkMediaFileLimit` + `checkMediaStorageLimit`).
3. `sharp` optimization for images (resize to 2048px max dim + format-specific quality).
4. **R2 upload** — when `isR2Configured()`. Applies to all media types (images, GIFs, videos); only images run through sharp first, videos travel as the original buffer. Persists `r2Key` on the `mediaItems` row. `publicUrl` is persisted UNLESS the upload set `isPrivate=true` (form field), in which case the row keeps `publicUrl=null` and `isPrivate=true` so no consumer accidentally uses a stable URL — `/api/media/[id]` signs at request time instead.
   - **Magic-byte check**: before optimizing or uploading, `bufferMatchesMime(buffer, file.type)` in `@/lib/file-magic` validates that the first bytes match the declared MIME. Closes the "PDF disguised as image" path — the client-sent `Content-Type` header is not trusted on its own.
5. **Always writes a local copy** at `uploads/{creatorId}/{fileId}.{ext}` — kept until the legacy `storagePath` consumers (thumbnail generation, FS-only items) are migrated.
6. Thumbnail (200×200 WebP) generated locally only — not uploaded to R2 (internal to Media Vault, never exposed to external platforms).

### Serving (`src/app/api/media/[id]/route.ts`)

- Auth check first.
- `?thumb=1` → reads thumbnail from FS local (thumbnails aren't in R2).
- **`isPrivate=true` item with `r2Key`** → `getSignedUrlForKey({key, expiresInSec: 3600})` from `r2-storage`, then `302 redirect` to the presigned URL. The URL expires in 1h — not indexable nor cacheable long-term. If signing fails or R2 isn't configured, falls through to FS.
- **Public item with `publicUrl`** → `302 redirect` to the R2 CDN (1-year `immutable` cache).
- Otherwise → falls back to `readFile` from FS (legacy items uploaded before R2 was configured).

### Deletion (`src/server/api/routers/media.ts`)

Both `delete` and `bulkDelete` mutations:
1. Delete the row from `mediaItems`.
2. `unlink` the local file + thumbnail (silent on failure).
3. If `item.r2Key` and `isR2Configured()` → `deleteObject(item.r2Key)`, wrapped in try/catch with `log.warn` on failure (orphan in R2 is recoverable; orphan DB row pointing to deleted media is worse, so DB delete happens first).

### Composer Integration (`src/components/scheduler/media-uploader.tsx`)

`<MediaUploader>` is the shared file picker / paste-URL component used in `PostComposer`. Drag-and-drop or click-to-upload posts to `/api/media/upload` and pipes the response's `publicUrl` back to the parent. Falls back to `/api/media/{id}` when only `storagePath` is returned (FS-only deployments).

**Props:**
- `value: string[]`, `onChange(urls)`, `max` (default 4).
- `kinds?: ("image" | "video")[]` (default `["image"]`) — toggles the `<input accept>` string and the preview element (`<img>` vs `<video muted playsInline preload="metadata">`).
- `videoConstraints?: { minSec?, maxSec?, label? }` — when set, every video added is probed via `getVideoDuration(url)` from `@/lib/media`. If `video.duration` falls outside the range, an amber chip appears below the thumbnail ("12.3s — Reels acepta hasta 90s"). **Advisory only — does not block submit; the platform gives the final reject.** The helper creates a hidden `<video>`, listens for `loadedmetadata`, 15s timeout, returns `null` defensively in SSR / on CORS failure.

**Wiring in `PostComposer`:**
- **Reddit `kind=image`** → `max=1, kinds=["image"]` → `platformConfigs.reddit.url`.
- **Reddit `kind=video`** → two uploaders: video (`max=1, kinds=["video"], videoConstraints={maxSec: 900, label: "Reddit"}`) + poster image (`max=1`) → `platformConfigs.reddit.{url, posterUrl}`.
- **Twitter** → `max=4, kinds=["image","video"], videoConstraints={maxSec: 140, label: "X / Twitter"}` → `platformConfigs.twitter.mediaUrls[]`. The publisher enforces the X rule of 1 video XOR ≤4 images.
- **Instagram** → `max=10, kinds=["image","video"], videoConstraints={minSec: 3, maxSec: 90, label: "Reels"}` → `platformConfigs.instagram.mediaUrls[]`. 1 item → photo/Reel; 2-10 → carousel.

`isVideoUrl(url)` in `@/lib/media` is the shared URL-extension heuristic (`.mp4|.mov|.m4v|.webm` + optional query/fragment); used by both the uploader preview and the publishers to route image vs video paths.

### Backfill

`scripts/backfill-media-to-r2.ts` (run via `npm run backfill:media-r2`) walks `mediaItems WHERE r2_key IS NULL`, reads the local file, uploads to R2 and persists `r2Key` + `publicUrl`. Idempotent and resumable. Flags: `--dry-run`, `--limit N`, `--include-archived`. Tolerates missing local files (skips + logs). Used after enabling R2 on a previously FS-only deployment.

### Private media (opt-in)

`mediaItems.isPrivate` (default `false`) toggles per-item privacy. Set the form field `isPrivate=1` on `/api/media/upload` to enable. Effects:
- Upload to R2 happens as usual but `publicUrl` is stored as `NULL` in the DB so no consumer (composer, tRPC list, etc.) ever shows it.
- `/api/media/[id]` calls `getSignedUrlForKey({key, expiresInSec: 3600})` and redirects to the resulting signed URL each request. Default 1h expiry — long enough for browser sessions and platform fetchers (Reddit/IG/X typically download in seconds), short enough to die before being cached publicly.
- Falls back to FS gracefully when R2 isn't configured or the presigner throws.

### Limitations / future work

- **No automatic cleanup** of orphaned R2 objects if a `mediaItems` row is deleted via raw SQL bypassing the tRPC router. The router-driven path (`delete` / `bulkDelete`) does call `deleteObject` — but manual DB edits would leak.
- **Public URL is enumerable** (12 random hex bytes per path) for non-private items. Same trust model as the rest of the publishing pipeline. For media that needs stronger privacy, mark with `isPrivate=true` so the URL is signed and short-lived.

## Blog-to-Social (AI repurposing)

### Overview

Take a blog URL (or pasted article text) and generate ready-to-post adaptations for Reddit, Twitter / X and Instagram. Drafts are ephemeral — edit inline and either schedule via the existing scheduler or discard. No new tables.

### Service (`src/server/services/blog-to-social.ts`)

- `extractContent(url)` — `fetch` capped to 500KB, no extra dependencies. Pulls `<title>` (with `og:title` fallback), `og:description` / `<meta name="description">` for excerpt, and paragraphs from `<article>` → `<main>` → `<body>` (in that order). Output truncated to 10K chars.
- `generatePostsForPlatforms(config, content, platforms, {language})` — calls `callAIProvider` with a strict-JSON system prompt:
  - **Reddit**: `{title (≤300), body (1500-3000 chars conversational)}`
  - **Twitter**: `{tweet (≤270), thread[] (each ≤270, can be empty)}`
  - **Instagram**: `{caption (≤2200), hashtags[] (5-10 specific tags, separated from caption)}`
- `tryParseDrafts(text)` is tolerant: strips `<think>` blocks, accepts ```` ```json ```` fences, and slices between the first `{` and last `}`. Per-platform char limits are re-applied at parse time as a safety net.

### API (`src/server/api/routers/blog-to-social.ts`)

- `extract({url})` — manager. Returns `{title, excerpt, content, url}`. Errors if extracted body < 50 chars (with a hint to paste manually).
- `generate({title?, excerpt?, url?, content, platforms})` — manager. Resolves AI config for task `"suggestion"`, enforces `checkAIMessageLimit`, logs token usage to `aiUsageLog`. Throws if the model returns no parseable JSON.

### UI (`src/app/(dashboard)/blog-to-social/page.tsx`)

- Input panel: URL field + Extract button (or paste content directly), title, content textarea, platform multi-select.
- "✨ Generar posts con IA" button.
- Drafts rendered as platform-specific cards with inline editable fields:
  - Reddit: title + body textarea + char counters.
  - Twitter: main tweet textarea + per-thread textarea blocks (`maxLength=270`).
  - Instagram: caption textarea + hashtag pills.
- Each card has **"↻ Regenerar"** (re-runs generation with current input) and **"📅 Programar"** (opens `PostComposer` pre-filled with the draft — for Twitter/IG it concatenates `tweet + thread` and `caption + hashtags`).
- Sidebar link "✨ Blog → Social" (manager+).

## Team Audit Log

### Helper (`src/server/services/team-audit.ts`)

`logTeamAction(db, {creatorId, userId, userName, action, entityType, entityId?, details?})` — fire-and-forget insert into `teamAuditLog`. Wraps the insert in try/catch so audit failures never break the main flow.

Most routers gate on `if (ctx.teamRole)` before calling — single-tenant solo creators don't need entries (they are the only actor). Multi-tenant deployments and delegated `manager` / `chatter` roles get full traceability.

### Actions logged

Tabla viva, no exhaustiva:

| Action | Module | Details |
|--------|--------|---------|
| `message.sent` | messages router | conversationId |
| `social_account.connected` | scheduler router | platform, connectionType (native/webhook), username if Reddit |
| `social_account.disconnected` | scheduler router | platform |
| `scheduled_post.created` | scheduler router | targetPlatforms, scheduleAt, recurring boolean |
| `scheduled_post.cancelled` | scheduler router | — |
| `scheduled_post.rescheduled` | scheduler router | newScheduleAt |
| `comment.replied` | social-comments router | postId, replyId, platform |
| `comment.marked_handled` / `comment.marked_pending` | social-comments router | postId |
| `comment.moderation_visible` / `comment.moderation_hidden` / `comment.moderation_reported` | social-comments router | postId, previous status, reason, alsoOnPlatform, platformApplied, platformError |
| (plus the existing team / billing / contact / message actions) | various | — |

When adding a new mutation, follow the same pattern: import `logTeamAction`, gate on `ctx.teamRole`, fire after the DB write succeeds.

## Testing

### Stack

- **Vitest** for unit tests under `__tests__/unit/`.
- **Mocks**: services that touch `db`, `fetch`, BullMQ queues or webhook dispatcher are mocked at the module boundary (`vi.mock("@/...")`) so tests stay deterministic and fast.
- Pre-commit hook (lint-staged → `vitest run --run`) executes the test suite on every commit; commits with failing tests are rejected before reaching git history.

### Recently added coverage

- **`recurrence.test.ts`** — `validateRecurrenceRule` (hour/minute/dayOfWeek/dayOfMonth/interval bounds) and `computeNextOccurrence` for daily/weekly/monthly with interval > 1, `until`, `maxCount`.
- **`blog-to-social.test.ts`** — `extractContent` mocking `fetch`: `<title>`, `og:description` fallback, paragraph extraction from `<article>`, strip of `<script>` / `<style>`, HTML entity decoding, non-2xx error path.
- **`social-comments-ingest.test.ts`** — `linkOrCreateCommentAuthor` matching by `platformUserId` vs creating a lightweight contact (with `contact.created` webhook); `enqueueCommentAnalysis` asserting `source: "comment"` payload.
- **`reddit-poller.test.ts`** — `flattenComments` recursive flattening with skips for `kind=more`, `[deleted]` authors, missing body, and Reddit's `replies: ""` empty-string convention. Deeply nested threads handled correctly.
- **`audience-insights.test.ts`** — `computeAudienceInsights` with mocked DB shape: empty data, conversion rate calculation, revenue merge, weighted average global totals, top topics scoped per platform (no cross-platform leak), platform ordering by contact count.
- **`scheduler.test.ts` (router logic)** — schedule date validation with 30s clock-skew window, missing-account detection, cancellable status transitions, BullMQ delay computation, post-publish recurrence advancement (rule + ≥1 success), final status computation.
- **`social-comments.test.ts` (router logic)** — unhandled count delta on `markHandled`, post counter delta on creator reply, authoring strategy priority (`platformUserId` → `username` → create new), AI suggest variant tags differing for public vs private surfaces.
- **`r2-storage.test.ts`** — `isR2Configured`, `buildR2Key` (extension priority, namespacing, uniqueness), `uploadBuffer` (PutObjectCommand shape, `immutable` vs default cache-control, trailing-slash strip on `R2_PUBLIC_URL`, throws when unconfigured), `deleteObject`, `publicUrlFor`. Uses `vi.mock("@aws-sdk/client-s3")` + `vi.resetModules()` + dynamic import to reset the cached client between cases with different env.
- **`api-media-serve.test.ts`** — `GET /api/media/[id]` happy/error paths: 401 / 404, 302 redirect to `publicUrl`, `thumb=1` never redirects (thumbnails live in FS), FS fallback for legacy items, 404 on `readFile` error.
- **`api-media-upload.test.ts`** — `POST /api/media/upload`: 401, 400 on missing file / disallowed MIME / >50MB (stubs `request.formData()` to dodge the `Object.defineProperty(file, "size")` round-trip), R2 happy path persists `r2Key + publicUrl`, FS-only path when R2 off, videos DO go to R2 when configured, graceful FS fallback when `uploadBuffer` throws.
- **`media.test.ts` (`@/lib/media`)** — `isVideoUrl` (extensions, case, queries/fragments, mid-path false positives), `getVideoDuration` returns `null` in SSR (no `document`).
- **`instagram-publisher.test.ts`** — 11 cases covering: single image (no polling), single Reel (polling until `FINISHED`), carousel 3 images (caption only on parent, `children=` URL-encoded with commas), carousel mixed (video children polled before parent), child container 400 (fail-fast, no parent or publish), child video `ERROR` status (abort before parent), parent `ERROR` status (abort before publish), >10 items rejected, empty list rejected, container `ERROR` propagated, `/media` non-2xx surfaced.
- **`twitter-media-upload.test.ts`** — image single-part (≤5 MB), video chunked end-to-end (INIT + 3 APPEND chunks for a 10 MB buffer + FINALIZE + STATUS polling until `succeeded`), video `processing_info.state = failed` throws, image >5 MB throws size error.
- **`reddit-video-upload.test.ts`** — happy path 3-fetch (source → asset lease → S3 multipart), FormData field order (`key` first, `file` last — S3 requires it), malformed lease throws, S3 non-2xx surfaced with status, `.mov` → `video/quicktime` MIME detection.
- **`scheduler-publisher-reddit-video.test.ts`** — `publishToReddit({kind: "video"})` E2E: happy path uses Reddit-hosted URL (not the R2 source) in `/api/submit` plus `video_poster_url`, missing `posterUrl` / `url` short-circuits before the upload helper, upload failure surfaces as `PublishResult.error` (no submit attempted), Reddit-level `json.errors[]` surfaced.

When adding new pure helpers (no DB), prefer this pattern: pure logic in a service file, module-level `vi.mock` for transitive deps, no test fixtures in DB. For routers, extract decisional logic as small predicates and test those — avoids mocks of DB + queue + SSE that are brittle.

**Note on transitive imports**: a test that only needs a tiny pure helper from a module can still drag a chain that opens Redis / BullMQ / queue clients (`webhook-dispatcher.test.ts` was doing this via `@/server/queues`). The result was a `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` at the end of the run. Mock the heavy import at the test (`vi.mock("@/server/queues", () => ({…}))`) when the symbol under test doesn't need it.

### E2E tests with real Postgres (`__tests__/e2e/`)

For DB-level invariants that module mocks cannot exercise (unique indexes, FK cascade, transactional state), the suite ships an **opt-in E2E folder** that runs real SQL against a dedicated test database.

- Skipped automatically via `e2eDescribe` (= `describe.skip` when `TEST_DATABASE_URL` is missing). Default `npm test` stays green without extra setup.
- Test isolation: each test wraps its work in `withTx(fn)` which throws a `RollbackSentinel` after the callback — drizzle rolls back, the DB stays clean.
- Setup: see `__tests__/e2e/README.md` (createdb + run migrations against the test URL + `TEST_DATABASE_URL=... npx vitest run __tests__/e2e`).
- Current coverage (9 tests, 4 files):
  - `comments-ingest.e2e.test.ts` — `externalCommentId` unique enforcement, linking comment author to existing contact.
  - `scheduler-create.e2e.test.ts` — multi-account allowed on `(creator, platform)` when `externalAccountId` differs; rejects true duplicates; `platformConfigs.{platform}.accountId` survives the JSONB round-trip.
  - `moderation-delta.e2e.test.ts` — hiding a pending comment decrements `unhandledCount`; restoring increments back.
  - `oauth-flow.e2e.test.ts` — `state` uniqueness, `expiresAt` filter for cleanup.

E2E tests do NOT cover external APIs (mocked), BullMQ enqueue (mocked) or HTTP middleware (covered by integration-with-mocks under `__tests__/integration/`).

## Landing Page & Onboarding

### Landing (`src/app/page.tsx`)

Public homepage when `getServerSession` returns null. Authenticated users redirect to `/conversations`.

Section order (top to bottom):
1. **`Hero`** — main pitch + CTA + capability stats grid (8 platforms, 5 AI providers, <2s latency) + dashboard mockup mockup illustrating chat panel + AI suggestions + scoring pills.
2. **`SocialProof`** (`src/components/landing/social-proof.tsx`) — capability stats with detail (5 AI models, 9 webhook events, 6 languages, <2s latency) + supported-platform chips. Numbers reflect product capabilities, not customer counts (no fabricated adoption metrics).
3. **`Features`** — feature cards.
4. **`Showcase`** — visual showcase.
5. **`Testimonials`** (`src/components/landing/testimonials.tsx`) — 4 representative quotes about real use cases (conversation modes, Reddit polling, team + audit log, blog-to-social). Visibly tagged with an amber **"Ejemplos de uso · pre-launch"** badge and an explicit subheader explaining they will be replaced by verified testimonials with explicit permission post-launch. **No fabricated names or photos.**
6. **`PricingTable`** — pricing grid (free / starter / pro / business).
7. **`FAQ`** — frequently asked questions.
8. **`Footer`**.

JSON-LD schema for `SoftwareApplication` is rendered inline for SEO. Canonical URL, OG tags and meta description come from the `seoConfig` singleton row (admin-editable).

### Onboarding Wizard (`src/app/(dashboard)/onboarding/page.tsx`)

Mounted at `/onboarding`. Triggered by `/register` redirect for new accounts and gated by `creators.onboardingCompleted` (guarded in `(dashboard)/layout.tsx`).

3-step wizard (`OnboardingWizard` in `src/components/onboarding/`):
1. **Plataforma** — pick primary platform.
2. **IA** — connect AI provider + model.
3. **Primer contacto** — add the first contact.

"Skip all" available at every step. On finish (or skip): `billing.completeOnboarding` mutation + session refresh + redirect to `/conversations`.

### Welcome Banner (`src/components/dashboard/welcome-banner.tsx`)

Dismissible card at the top of `/dashboard` showing 4 next-step suggestions with direct links:
- ✨ Personality presets
- 📅 First scheduled post
- 👥 Import contacts
- 📝 Blog-to-social

Dismissal persists in `localStorage` (`fanflow:welcome-dismissed = "1"`) so it never reappears for that browser. Independent from `creators.onboardingCompleted` — the wizard is the gate to enter the dashboard; this banner is the "what's next" guide once inside.

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `creators` | User accounts with settings (JSONB), subscription plan, email prefs |
| `contacts` | Fans/contacts per creator, with `isArchived` flag |
| `contactProfiles` | Scoring data, behavioral signals, funnel stage, churn score/factors |
| `conversations` | Per-contact conversations with `isPinned`, status (active/paused/archived) |
| `messages` | Chat messages (role: fan/creator) |
| `platforms` | Platform configs per creator with personality JSONB |
| `platformScoringConfigs` | Per-platform scoring weight/benchmark overrides per creator |
| `conversationModes` | OnlyFans conversation mode configs per creator |
| `aiConfigs` | AI provider/model config per creator per task |
| `fanTransactions` | Revenue tracking per contact |
| `notes` | Creator notes about contacts |
| `aiUsageLog` | Token usage tracking |
| `templates` | Message templates |
| `conversationAssignments` | Team member → conversation assignments |
| `sequences` | Automated message sequences (nurturing/followup/custom) |
| `sequenceEnrollments` | Contact enrollment tracking for sequences |
| `autoResponseConfigs` | Per-platform auto-response settings |
| `apiKeys` | API keys per creator (hash + encrypted key, prefix, last used, active/revoked) |
| `webhookConfigs` | Outgoing webhook configs per creator (url, events, encrypted secret) |
| `webhookDeliveryLogs` | Webhook delivery attempts with status, response, errors |
| `customRoles` | Custom team roles with granular permissions (14 dot-separated) per creator |
| `teamAuditLog` | Audit trail for team actions (who did what, with details JSONB) |
| `conversationModeExperiments` | A/B test experiments for conversation modes (variants A/B config, traffic split, lifecycle) |
| `messageExperiments` | A/B experiments for message/template content (2-5 content variants, status lifecycle, winner) |
| `messageExperimentSends` | Per-send record for message A/B (variantKey, replied/converted metrics, reply sentiment) |
| `experimentAssignments` | Contact-to-variant assignments for A/B experiments |
| `experimentMetrics` | Metric events (response_sent, fan_replied, conversion, etc.) per experiment variant |
| `coachingSessions` | AI coaching session results (negotiation/retention/upsell) per conversation |
| `contentGapReports` | Content gap analysis reports with aggregated topic/engagement data |
| `socialPosts` | Public posts the creator owns (Reddit/IG/Twitter), with cached `commentsCount` and `unhandledCount` for inbox sorting |
| `socialComments` | Public comments threaded by `parentCommentId`, optionally linked to `contacts`, with `isHandled` state and AI suggestions |
| `socialAccounts` | Multiple rows per `(creator, platform)` allowed; unique by `(creator, platform, externalAccountId)`. Native (encrypted credentials + OAuth tokens) or webhook connection mode. OAuth columns: `encryptedOauthAccessToken`, `encryptedOauthRefreshToken`, `oauthExpiresAt`, `oauthScopes[]`, `externalAccountId` |
| `scheduledPosts` | Publishing jobs with `targetPlatforms` array, status lifecycle, BullMQ `jobId`, `externalPostIds` map, optional recurrence rule + count. `platformConfigs` accepts `accountId` per platform for multi-account routing |
| `oauthPendingFlows` | Short-lived OAuth state (CSRF token + PKCE verifier) with 10-min TTL, consumed by callback route |
| `mediaItems` | Per-creator media library (images/videos/gifs). `storagePath` is the local FS path; `r2Key` + `publicUrl` populated when uploaded to Cloudflare R2 (all media types). `isPrivate` toggles signed-URL serving (publicUrl stored as NULL). Powers the Media Vault + composer uploader |

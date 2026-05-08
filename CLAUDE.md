# FanFlow v2

SaaS CRM para creadores de contenido con asistente IA para gestionar conversaciones con fans.

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

### AI Service (`src/server/services/ai-comment-suggester.ts`)

- `generateCommentSuggestion(config, input)` — public-context prompt with explicit restrictions (no prices, no DM nudge, short responses).
- 3 variants: CASUAL / ENGAGEMENT / RETENTION (no SALES variant for public surface).
- Reuses `callAIProvider()` so all 5 providers work without changes.

### API

**tRPC** (`src/server/api/routers/social-comments.ts`):
- `listPosts` — filters by platform and `onlyWithUnhandled`; ordered by unhandled count + recency.
- `getPost`, `listComments` (per post, optional `onlyUnhandled`).
- `createPost` (manager) — manual post creation for testing/external workflows.
- `createComment` — auto-links author via `linkOrCreateCommentAuthor`, enqueues analysis, publishes SSE.
- `replyToComment` — inserts a `role = "creator"` child comment + auto-marks parent as handled + decrements `unhandledCount` + publishes SSE.
- `markHandled` — toggle handled state with delta on post counter + publishes SSE.
- `suggest` — generate AI variants for a specific comment.
- `overview` — counters for header (posts, comments, unhandled).

**REST** (`src/app/api/v1/comments/route.ts`):
- `GET /api/v1/comments` (Pro+) — list with filters `post_id`, `unhandled`, paginated.
- `POST /api/v1/comments` (Business) — idempotent ingest (auto-creates post by `externalPostId` if missing, dedupes by `externalCommentId`). Same auto-link + analysis + SSE pipeline as tRPC.

### Realtime Events

`RealtimeEventType` extended with `new_comment` and `comment_handled`. Published from `createComment`, `replyToComment`, `markHandled`, the REST endpoint, and the Reddit poller. The shared `useRealtime` hook invalidates `socialComments.{listPosts,listComments,getPost,overview}` and shows a browser `Notification` when the tab is hidden and a fan (not creator) comments.

### UI (`src/app/(dashboard)/comments/page.tsx`)

- 2-panel responsive layout: left `PostsList` with stats and filters; center `CommentThreadPanel`.
- Thread view: chronological with creator replies indented. Handled/pending badges, contact-linked indicator, profile chips (engagement / payment / funnel).
- Reply panel: AI suggest button → 3 colored variants → click to apply → textarea → publish or mark handled.
- Sidebar link "🗨️ Comentarios" (access: all team members).
- Auto-refreshes via SSE — no manual reload needed when comments arrive from polling or external ingestion.

## Publishing Scheduler

### Overview

Schedule public posts to native APIs (Reddit) or to any platform via outgoing webhooks (Twitter, Instagram, future). One account per platform per creator. Reddit uses script-type OAuth password grant; other platforms route through `post.publishing` webhooks (Zapier / Make / custom endpoints).

### Schema

- **`socialAccounts`** — one row per `(creatorId, platformType)`. `connectionType` is `native` (credentials cifrados via AES-256-GCM in `encryptedCredentials`) or `webhook` (no credentials, just a flag). `accountUsername` populated after `verifyRedditCredentials()`.
- **`scheduledPosts`** — scheduled posts with `targetPlatforms` array, `platformConfigs` JSONB (e.g. `{reddit: {subreddit, kind, url, flairId, nsfw, spoiler}}`), `status` enum (scheduled/processing/posted/partial/failed/cancelled), `attempts`, `lastError`, `externalPostIds` JSONB (`{platform: {id, url}}`), `jobId` (BullMQ job), `recurrenceRule` JSONB (optional), `recurrenceCount` (incremented on each publish of a recurring series).

### Reddit Publisher (`src/server/services/scheduler-publisher.ts`)

- `verifyRedditCredentials(creds)` — auth handshake + `/api/v1/me` check, returns `{ok, username}`.
- `publishToReddit(encryptedCreds, post, creatorId?)` — decrypts, OAuth password grant (cached when `creatorId` passed), `POST /api/submit`. Supports three kinds:
  - `kind: "self"` (default) — text post; sends `text` field with the content.
  - `kind: "link"` — link to an external URL; requires `url`. Sends `resubmit=true`.
  - `kind: "image"` — image post via public URL; requires `url`. Reddit accepts external public URLs (i.imgur, redd.it, S3...) directly without the `media/asset.json` upload flow. The URL must be publicly accessible or Reddit rejects the submission.
  - Returns `{success, externalId, externalUrl, error}`. On 401, invalidates the cached token automatically.
- Title trimmed to 300 chars; supports `flair_id`, `nsfw`, `spoiler` flags.
- User-Agent: `FanFlow/1.0 (by /u/fanflow)`.
- **OAuth token cache (Redis)**: `getRedditAccessTokenCached(creatorId, creds)` stores tokens with 50-min TTL (Reddit tokens last 60 min — 10-min cushion). Cache miss → fetch + store. Failures fall through to direct fetch silently. `invalidateRedditTokenCache(creatorId)` for forced refresh on 401. Both publisher and `reddit-poller` use the cached version, going from ~289 token fetches/day per account to ~30.
- Exports `getRedditAccessToken`, `getRedditAccessTokenCached`, `invalidateRedditTokenCache`, `decryptRedditCredentials`, `REDDIT_USER_AGENT`.

### Recurrence (`src/server/services/recurrence.ts`)

Lightweight rule subset (no full RFC5545):

- `RecurrenceRule = {frequency, interval?, dayOfWeek?, dayOfMonth?, hour, minute, until?, maxCount?}`
- `frequency`: `"daily" | "weekly" | "monthly"`. `weekly` requires `dayOfWeek` (0-6, Sun=0). `monthly` requires `dayOfMonth` (1-31, capped to 28 to avoid month overflow).
- `computeNextOccurrence(rule, from, occurrencesSoFar)` — returns the next `Date` after `from`, or `null` if `until`/`maxCount` already exceeded.
- `validateRecurrenceRule(rule)` — throws on invalid input; called from the tRPC router before insert.
- The worker re-arms recurring posts: after a successful publish, if the rule still has a next occurrence the worker updates `scheduleAt` to that date, increments `recurrenceCount`, enqueues a fresh delayed BullMQ job, and keeps `status = "scheduled"`. When the series ends (`until` or `maxCount` exhausted), `status` flips to `"posted"` like a one-shot. Failed/partial outcomes still throw (BullMQ retries) and do NOT advance the recurrence.

### Queue and Worker

- `scheduledPostQueue` ("scheduled-post-publish") with delayed jobs (`delay = scheduleAt - now`).
- Worker iterates `targetPlatforms`:
  - **`native`** + `reddit` → calls `publishToReddit`. On success, mirrors the published post into `socialPosts` (`onConflictDoNothing`) so the comment poller can pick up replies without manual setup.
  - **`webhook`** → dispatches `post.publishing` webhook with full payload.
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
  - **Reddit block**: subreddit input, kind selector (Texto / Enlace / Imagen) with conditional URL field for link/image.
  - **Twitter / X block**: main tweet textarea (270 char counter) + editable thread list with "+ Añadir al hilo" / ✕ delete per row. `platformConfigs.twitter = {tweet, thread[]}` rides intact in the `post.publishing` webhook payload so Zapier / Make can post as a native thread on X.
  - **Recurrence**: "Repetir publicación" toggle reveals a recurrence form (frequency tabs, day-of-week / day-of-month picker, hour/minute UTC, optional `until` datetime and/or `maxCount` cap).
- **Accounts** (`accounts-panel.tsx`): per-platform card; Reddit form for native (4-field credentials), button "Vía webhook" for the rest.
- Sidebar link "📅 Scheduler" (access: manager+).
- **`PostComposer`** accepts an optional `initialValues` prop (`{title?, content?, platforms?, redditSubreddit?, twitterTweet?, twitterThread?}`) so other pages (notably Blog-to-Social) can open it pre-filled. Twitter drafts open with the thread editable as separate tweets, not flatten text.

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

When adding new pure helpers (no DB), prefer this pattern: pure logic in a service file, module-level `vi.mock` for transitive deps, no test fixtures in DB.

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
| `experimentAssignments` | Contact-to-variant assignments for A/B experiments |
| `experimentMetrics` | Metric events (response_sent, fan_replied, conversion, etc.) per experiment variant |
| `coachingSessions` | AI coaching session results (negotiation/retention/upsell) per conversation |
| `contentGapReports` | Content gap analysis reports with aggregated topic/engagement data |
| `socialPosts` | Public posts the creator owns (Reddit/IG/Twitter), with cached `commentsCount` and `unhandledCount` for inbox sorting |
| `socialComments` | Public comments threaded by `parentCommentId`, optionally linked to `contacts`, with `isHandled` state and AI suggestions |
| `socialAccounts` | One row per `(creator, platform)`; native (encrypted credentials) or webhook (Zapier/Make) connection mode |
| `scheduledPosts` | One-shot publishing jobs with `targetPlatforms` array, status lifecycle, BullMQ `jobId`, and `externalPostIds` map after publishing |

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
- Team support with roles: `manager` (full access) and `chatter` (only assigned conversations)

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

### Prompt construction

`buildSystemPrompt()` assembles the prompt from:
1. Base system instructions (variant generation rules)
2. Platform type
3. Platform-specific personality config (role, tone, style, message length, goals, restrictions, example messages, custom instructions)
4. **Conversation mode context** (OnlyFans only — mode name, description, type)
5. Global creator instructions
6. Contact profile (engagement, funnel stage, payment probability)
7. Creator notes about the contact

### Suggestion variants

Each AI response generates 3 variants with different approaches. The variant types change based on the contact's funnel stage and conversation mode. Variants are parsed from tagged format: `[CASUAL] message --- [SALES] message --- [RETENTION] message`.

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

- **Settings tab** "Modos conversacion" (`src/components/settings/conversation-modes-settings.tsx`) — list, edit, toggle modes
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
- **Center:** Chat panel with AI suggestions
- **Right:** Contact panel with stats, scoring, revenue, reports (w-80 on desktop, toggle on mobile)

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
1. **Personalidad** — Per-platform personality configuration (role, tone, style, goals, restrictions, example messages)
2. **Instrucciones globales** — Global AI instructions applied to all platforms
3. **Modos conversacion** — OnlyFans conversation modes configuration
4. **Modelo IA** — AI provider and model selection per task
5. **Templates** — Message templates
6. **Telegram** — Telegram bot integration settings
7. **Cuenta** — Account settings + email notification preferences (3 toggles)

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

Scoring is updated asynchronously via BullMQ worker when messages are sent. Churn score is calculated in real-time during scoring pipeline and recalculated in batch every 6 hours.

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

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `creators` | User accounts with settings (JSONB), subscription plan, email prefs |
| `contacts` | Fans/contacts per creator, with `isArchived` flag |
| `contactProfiles` | Scoring data, behavioral signals, funnel stage, churn score/factors |
| `conversations` | Per-contact conversations with `isPinned`, status (active/paused/archived) |
| `messages` | Chat messages (role: fan/creator) |
| `platforms` | Platform configs per creator with personality JSONB |
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

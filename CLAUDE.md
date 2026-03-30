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
7. **Cuenta** — Account settings

## Contact Scoring

Contacts have behavioral profiles (`contactProfiles` table) with:
- `engagementLevel` (0-100)
- `paymentProbability` (0-100)
- `funnelStage` (cold → curious → interested → hot_lead → buyer → vip)
- `estimatedBudget` (low/medium/high/premium)
- `responseSpeed`, `conversationDepth`
- `behavioralSignals` (JSONB: message count, sentiment trend, topic frequency, etc.)
- `scoringHistory` (JSONB: historical engagement + payment probability snapshots)

Scoring is updated asynchronously via BullMQ worker when messages are sent.

## Revenue Tracking

- **Table:** `fanTransactions` — per-contact transaction records
- **Types:** tip, ppv, subscription, custom
- **Amount:** stored in cents (integer)
- **API:** `src/server/api/routers/revenue.ts` — CRUD, summaries, top spenders, ROI calculations, export
- **UI:** Revenue section in contact panel with inline transaction form

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `creators` | User accounts with settings (JSONB), subscription plan |
| `contacts` | Fans/contacts per creator, with `isArchived` flag |
| `contactProfiles` | Scoring data, behavioral signals, funnel stage |
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

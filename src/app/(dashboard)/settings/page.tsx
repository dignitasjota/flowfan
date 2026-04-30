"use client";

import { useState } from "react";
import { PlatformSettings } from "@/components/settings/platform-settings";
import { AIModelSettings } from "@/components/settings/ai-model-settings";
import { TemplateSettings } from "@/components/settings/template-settings";
import { AccountSettings } from "@/components/settings/account-settings";
import { TelegramSettings } from "@/components/settings/telegram-settings";
import { GlobalInstructionsSettings } from "@/components/settings/global-instructions-settings";
import { ConversationModesSettings } from "@/components/settings/conversation-modes-settings";
import { AutoResponseSettings } from "@/components/settings/auto-response-settings";

const tabs = [
  { id: "personality", label: "Personalidad" },
  { id: "global", label: "Instrucciones globales" },
  { id: "conversation-modes", label: "Modos conversacion" },
  { id: "ai-model", label: "Modelo IA" },
  { id: "templates", label: "Templates" },
  { id: "auto-responses", label: "Auto-respuestas" },
  { id: "telegram", label: "Telegram" },
  { id: "account", label: "Cuenta" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("personality");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Configuracion</h2>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-gray-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 px-6 py-6">
        {activeTab === "personality" && <PlatformSettings />}
        {activeTab === "global" && <GlobalInstructionsSettings />}
        {activeTab === "conversation-modes" && <ConversationModesSettings />}
        {activeTab === "ai-model" && <AIModelSettings />}
        {activeTab === "templates" && <TemplateSettings />}
        {activeTab === "auto-responses" && <AutoResponseSettings />}
        {activeTab === "telegram" && <TelegramSettings />}
        {activeTab === "account" && <AccountSettings />}
      </div>
    </div>
  );
}

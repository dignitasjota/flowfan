"use client";

import { useState } from "react";
import { PlatformSettings } from "@/components/settings/platform-settings";
import { AIModelSettings } from "@/components/settings/ai-model-settings";

const tabs = [
  { id: "personality", label: "Personalidad" },
  { id: "ai-model", label: "Modelo IA" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("personality");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Configuración</h2>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
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
        {activeTab === "ai-model" && <AIModelSettings />}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { StepPlatform } from "./step-platform";
import { StepAIConfig } from "./step-ai-config";
import { StepFirstContact } from "./step-first-contact";

const steps = [
  { title: "Plataforma", description: "Configura tu plataforma principal" },
  { title: "IA", description: "Conecta tu proveedor de IA" },
  { title: "Primer contacto", description: "Anade tu primer fan" },
];

export function OnboardingWizard() {
  const router = useRouter();
  const { update } = useSession();
  const [currentStep, setCurrentStep] = useState(0);
  const completeMutation = trpc.billing.completeOnboarding.useMutation();

  async function handleFinish() {
    await completeMutation.mutateAsync();
    await update({ onboardingCompleted: true });
    router.push("/conversations");
  }

  async function handleSkipAll() {
    await completeMutation.mutateAsync();
    await update({ onboardingCompleted: true });
    router.push("/conversations");
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Skip all button */}
      <div className="mb-4 text-right">
        <button
          onClick={handleSkipAll}
          disabled={completeMutation.isPending}
          className="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          {completeMutation.isPending
            ? "Redirigiendo..."
            : "Saltar todo e ir al dashboard"}
        </button>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between">
          {steps.map((step, i) => (
            <div key={i} className="flex flex-1 flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                  i < currentStep
                    ? "bg-indigo-600 text-white"
                    : i === currentStep
                      ? "bg-indigo-500/20 text-indigo-400 ring-2 ring-indigo-500"
                      : "bg-gray-800 text-gray-500"
                )}
              >
                {i < currentStep ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className="mt-2 text-xs text-gray-400">{step.title}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= currentStep ? "bg-indigo-500" : "bg-gray-800"
              )}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        {currentStep === 0 && (
          <StepPlatform onComplete={() => setCurrentStep(1)} />
        )}
        {currentStep === 1 && (
          <StepAIConfig onComplete={() => setCurrentStep(2)} />
        )}
        {currentStep === 2 && (
          <StepFirstContact onComplete={handleFinish} />
        )}
      </div>
    </div>
  );
}

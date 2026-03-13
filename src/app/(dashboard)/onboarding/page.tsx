"use client";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">
            Bienvenido a FanFlow
          </h1>
          <p className="mt-2 text-gray-400">
            Configura tu cuenta en 3 sencillos pasos.
          </p>
        </div>
        <OnboardingWizard />
      </div>
    </div>
  );
}

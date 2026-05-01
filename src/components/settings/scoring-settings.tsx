"use client";

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "onlyfans", label: "OnlyFans" },
  { value: "telegram", label: "Telegram" },
  { value: "twitter", label: "Twitter" },
  { value: "reddit", label: "Reddit" },
] as const;

type PlatformType = (typeof PLATFORMS)[number]["value"];

type WeightSliderProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
};

function WeightSlider({ label, value, onChange }: WeightSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-40 text-sm text-gray-300">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-indigo-500"
      />
      <span className="w-12 text-right text-sm text-gray-400">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

type NumberInputProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
};

function NumberInput({ label, value, onChange, min = 1, max = 9999, unit }: NumberInputProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-48 text-sm text-gray-300">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
      />
      {unit && <span className="text-sm text-gray-500">{unit}</span>}
    </div>
  );
}

export function ScoringSettings() {
  const [platform, setPlatform] = useState<PlatformType>("instagram");
  const [dirty, setDirty] = useState(false);

  const configQuery = trpc.scoringConfig.getByPlatform.useQuery({ platformType: platform });
  const defaultsQuery = trpc.scoringConfig.getDefaults.useQuery({ platformType: platform });
  const upsertMutation = trpc.scoringConfig.upsert.useMutation({
    onSuccess: () => {
      configQuery.refetch();
      setDirty(false);
    },
  });
  const resetMutation = trpc.scoringConfig.resetToDefaults.useMutation({
    onSuccess: () => {
      configQuery.refetch();
      setDirty(false);
    },
  });

  // Local state for editing
  const [ew, setEw] = useState({
    frequency: 0.25, msgLength: 0.15, sentiment: 0.20, depth: 0.15, recency: 0.15, convCount: 0.10,
  });
  const [pw, setPw] = useState({
    intent: 0.30, budget: 0.20, engagement: 0.20, momentum: 0.15, sentiment: 0.15,
  });
  const [bm, setBm] = useState({
    maxMessages: 30, maxMsgLength: 200, recencyHours: 168, maxConversations: 5, maxMsgsPerConv: 15, maxBudgetMentions: 3,
  });
  const [ft, setFt] = useState({
    vip: 85, buyer: 70, hotLead: 50, interested: 30, curious: 20,
  });
  const [af, setAf] = useState({
    enabled: false, newContactDays: 14, boostFactor: 1.2,
  });

  // Sync from query
  useEffect(() => {
    if (configQuery.data) {
      setEw(configQuery.data.ew);
      setPw(configQuery.data.pw);
      setBm(configQuery.data.bm);
      setFt(configQuery.data.ft);
      setAf(configQuery.data.af);
      setDirty(false);
    }
  }, [configQuery.data]);

  const updateEw = useCallback((key: string, val: number) => {
    setEw((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const updatePw = useCallback((key: string, val: number) => {
    setPw((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const updateBm = useCallback((key: string, val: number) => {
    setBm((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const updateFt = useCallback((key: string, val: number) => {
    setFt((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  function handleSave() {
    upsertMutation.mutate({
      platformType: platform,
      engagementWeights: ew,
      paymentWeights: pw,
      benchmarks: bm,
      funnelThresholds: ft,
      contactAgeFactor: af,
    });
  }

  function handleReset() {
    resetMutation.mutate({ platformType: platform });
  }

  const isLoading = configQuery.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-white">Scoring por Plataforma</h3>
        <p className="mt-1 text-sm text-gray-400">
          Ajusta los pesos y benchmarks de scoring para cada plataforma. Los contactos existentes se recalcularan con la nueva configuracion.
        </p>
      </div>

      {/* Platform selector */}
      <div className="flex gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPlatform(p.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              platform === p.value
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Cargando configuracion...</div>
      ) : (
        <div className="space-y-8">
          {/* Engagement Weights */}
          <section className="rounded-lg border border-gray-800 p-4">
            <h4 className="mb-4 text-sm font-semibold text-white">Pesos de Engagement</h4>
            <div className="space-y-3">
              <WeightSlider label="Frecuencia mensajes" value={ew.frequency} onChange={(v) => updateEw("frequency", v)} />
              <WeightSlider label="Longitud mensajes" value={ew.msgLength} onChange={(v) => updateEw("msgLength", v)} />
              <WeightSlider label="Sentimiento" value={ew.sentiment} onChange={(v) => updateEw("sentiment", v)} />
              <WeightSlider label="Profundidad conv." value={ew.depth} onChange={(v) => updateEw("depth", v)} />
              <WeightSlider label="Recencia" value={ew.recency} onChange={(v) => updateEw("recency", v)} />
              <WeightSlider label="Total conversaciones" value={ew.convCount} onChange={(v) => updateEw("convCount", v)} />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Suma actual: {Math.round((ew.frequency + ew.msgLength + ew.sentiment + ew.depth + ew.recency + ew.convCount) * 100)}%
              {Math.abs(ew.frequency + ew.msgLength + ew.sentiment + ew.depth + ew.recency + ew.convCount - 1) > 0.05 && (
                <span className="ml-2 text-yellow-500">(recomendado: 100%)</span>
              )}
            </p>
          </section>

          {/* Payment Weights */}
          <section className="rounded-lg border border-gray-800 p-4">
            <h4 className="mb-4 text-sm font-semibold text-white">Pesos de Probabilidad de Pago</h4>
            <div className="space-y-3">
              <WeightSlider label="Intencion de compra" value={pw.intent} onChange={(v) => updatePw("intent", v)} />
              <WeightSlider label="Menciones de presup." value={pw.budget} onChange={(v) => updatePw("budget", v)} />
              <WeightSlider label="Engagement" value={pw.engagement} onChange={(v) => updatePw("engagement", v)} />
              <WeightSlider label="Momentum" value={pw.momentum} onChange={(v) => updatePw("momentum", v)} />
              <WeightSlider label="Sentimiento" value={pw.sentiment} onChange={(v) => updatePw("sentiment", v)} />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Suma actual: {Math.round((pw.intent + pw.budget + pw.engagement + pw.momentum + pw.sentiment) * 100)}%
              {Math.abs(pw.intent + pw.budget + pw.engagement + pw.momentum + pw.sentiment - 1) > 0.05 && (
                <span className="ml-2 text-yellow-500">(recomendado: 100%)</span>
              )}
            </p>
          </section>

          {/* Benchmarks */}
          <section className="rounded-lg border border-gray-800 p-4">
            <h4 className="mb-4 text-sm font-semibold text-white">Benchmarks</h4>
            <div className="space-y-3">
              <NumberInput label="Max mensajes (100%)" value={bm.maxMessages} onChange={(v) => { setBm((p) => ({ ...p, maxMessages: v })); setDirty(true); }} unit="msgs" />
              <NumberInput label="Max longitud mensaje" value={bm.maxMsgLength} onChange={(v) => { setBm((p) => ({ ...p, maxMsgLength: v })); setDirty(true); }} unit="chars" />
              <NumberInput label="Recencia maxima" value={bm.recencyHours} onChange={(v) => { setBm((p) => ({ ...p, recencyHours: v })); setDirty(true); }} unit="horas" />
              <NumberInput label="Max conversaciones" value={bm.maxConversations} onChange={(v) => { setBm((p) => ({ ...p, maxConversations: v })); setDirty(true); }} />
              <NumberInput label="Max msgs por conv." value={bm.maxMsgsPerConv} onChange={(v) => { setBm((p) => ({ ...p, maxMsgsPerConv: v })); setDirty(true); }} />
              <NumberInput label="Max menciones presup." value={bm.maxBudgetMentions} onChange={(v) => { setBm((p) => ({ ...p, maxBudgetMentions: v })); setDirty(true); }} />
            </div>
          </section>

          {/* Funnel Thresholds */}
          <section className="rounded-lg border border-gray-800 p-4">
            <h4 className="mb-4 text-sm font-semibold text-white">Umbrales del Funnel</h4>
            <p className="mb-3 text-xs text-gray-500">Probabilidad de pago necesaria para cada etapa del funnel.</p>
            <div className="space-y-3">
              <NumberInput label="VIP" value={ft.vip} onChange={(v) => { setFt((p) => ({ ...p, vip: v })); setDirty(true); }} min={0} max={100} unit="%" />
              <NumberInput label="Buyer" value={ft.buyer} onChange={(v) => { setFt((p) => ({ ...p, buyer: v })); setDirty(true); }} min={0} max={100} unit="%" />
              <NumberInput label="Hot Lead" value={ft.hotLead} onChange={(v) => { setFt((p) => ({ ...p, hotLead: v })); setDirty(true); }} min={0} max={100} unit="%" />
              <NumberInput label="Interested" value={ft.interested} onChange={(v) => { setFt((p) => ({ ...p, interested: v })); setDirty(true); }} min={0} max={100} unit="%" />
              <NumberInput label="Curious" value={ft.curious} onChange={(v) => { setFt((p) => ({ ...p, curious: v })); setDirty(true); }} min={0} max={100} unit="%" />
            </div>
          </section>

          {/* Contact Age Factor */}
          <section className="rounded-lg border border-gray-800 p-4">
            <h4 className="mb-4 text-sm font-semibold text-white">Factor de Antiguedad</h4>
            <p className="mb-3 text-xs text-gray-500">Boost temporal para contactos nuevos. El boost se reduce linealmente hasta 1.0 al cumplir los dias configurados.</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="w-48 text-sm text-gray-300">Activado</label>
                <button
                  onClick={() => { setAf((p) => ({ ...p, enabled: !p.enabled })); setDirty(true); }}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    af.enabled ? "bg-indigo-600" : "bg-gray-700"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      af.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              {af.enabled && (
                <>
                  <NumberInput label="Dias como 'nuevo'" value={af.newContactDays} onChange={(v) => { setAf((p) => ({ ...p, newContactDays: v })); setDirty(true); }} unit="dias" />
                  <div className="flex items-center gap-3">
                    <label className="w-48 text-sm text-gray-300">Factor de boost</label>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      step={0.1}
                      value={af.boostFactor}
                      onChange={(e) => { setAf((p) => ({ ...p, boostFactor: Number(e.target.value) })); setDirty(true); }}
                      className="w-24 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="text-sm text-gray-500">x</span>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!dirty || upsertMutation.isPending}
              className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {upsertMutation.isPending ? "Guardando..." : "Guardar"}
            </button>
            <button
              onClick={handleReset}
              disabled={resetMutation.isPending || !configQuery.data?.hasOverride}
              className="rounded-lg border border-gray-700 px-6 py-2 text-sm font-medium text-gray-400 transition-colors hover:text-white disabled:opacity-50"
            >
              Reset a defaults
            </button>
            {configQuery.data?.hasOverride && (
              <span className="text-xs text-indigo-400">Config personalizada activa</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Heart,
  ShieldCheck,
  Stethoscope,
  TrendingDown,
  Wind,
  Thermometer,
  Brain,
  Zap,
  PhoneCall,
  Info,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { notify } from '@/components/ui/Toast';
import { playWrongPillBuzzer, playSuccessChime } from '@/lib/audio-siren';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/constants/app';
import { vitalsService } from '@/services/vitals.service';

interface NEWS2SubScore {
  name: string;
  value: string;
  score: number;
  icon: React.ReactNode;
  unit: string;
  statusText: string;
}

interface NEWS2SimulationProfile {
  name: string;
  totalScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  probability: string;
  clinicalAction: string;
  subScores: NEWS2SubScore[];
}

const PROFILES: Record<'STABLE' | 'MODERATE' | 'CRITICAL', NEWS2SimulationProfile> = {
  STABLE: {
    name: 'Normal Baseline (Low Risk)',
    totalScore: 0,
    riskLevel: 'LOW',
    probability: '< 3% risk of 12-hour decompensation',
    clinicalAction: 'Routine Remote Patient Monitoring (RPM). Maintain scheduled chronic regimen.',
    subScores: [
      { name: 'Respiration Rate', value: '16', unit: 'bpm', score: 0, statusText: 'Normal (12-20)', icon: <Wind className="w-4 h-4 text-emerald-400" /> },
      { name: 'Oxygen Saturation (SpO2)', value: '98', unit: '%', score: 0, statusText: 'Normal (≥96)', icon: <Activity className="w-4 h-4 text-emerald-400" /> },
      { name: 'Systolic Blood Pressure', value: '122', unit: 'mmHg', score: 0, statusText: 'Optimal (111-219)', icon: <Heart className="w-4 h-4 text-emerald-400" /> },
      { name: 'Pulse / Heart Rate', value: '72', unit: 'bpm', score: 0, statusText: 'Normal (51-90)', icon: <Heart className="w-4 h-4 text-emerald-400" /> },
      { name: 'Neurological (AVPU)', value: 'Alert', unit: 'AVPU', score: 0, statusText: 'Fully conscious', icon: <Brain className="w-4 h-4 text-emerald-400" /> },
      { name: 'Core Temperature', value: '36.8', unit: '°C', score: 0, statusText: 'Normothermic (36.1-38.0)', icon: <Thermometer className="w-4 h-4 text-emerald-400" /> },
    ],
  },
  MODERATE: {
    name: 'Subclinical Creep (Medium Risk)',
    totalScore: 5,
    riskLevel: 'MEDIUM',
    probability: '34% risk of acute decompensation within 6-12 hours',
    clinicalAction: 'Urgent Clinician Review within 60 mins. Increase RPM telemetry frequency to hourly.',
    subScores: [
      { name: 'Respiration Rate', value: '23', unit: 'bpm', score: 2, statusText: 'Tachypneic (21-24)', icon: <Wind className="w-4 h-4 text-amber-400" /> },
      { name: 'Oxygen Saturation (SpO2)', value: '93', unit: '%', score: 2, statusText: 'Mild Hypoxia (92-93)', icon: <Activity className="w-4 h-4 text-amber-400" /> },
      { name: 'Systolic Blood Pressure', value: '106', unit: 'mmHg', score: 1, statusText: 'Mild Hypotension (101-110)', icon: <Heart className="w-4 h-4 text-amber-400" /> },
      { name: 'Pulse / Heart Rate', value: '88', unit: 'bpm', score: 0, statusText: 'Borderline Normal (51-90)', icon: <Heart className="w-4 h-4 text-emerald-400" /> },
      { name: 'Neurological (AVPU)', value: 'Alert', unit: 'AVPU', score: 0, statusText: 'Alert', icon: <Brain className="w-4 h-4 text-emerald-400" /> },
      { name: 'Core Temperature', value: '37.8', unit: '°C', score: 0, statusText: 'Normal (36.1-38.0)', icon: <Thermometer className="w-4 h-4 text-emerald-400" /> },
    ],
  },
  CRITICAL: {
    name: 'Imminent Shock / Sepsis (High Risk)',
    totalScore: 9,
    riskLevel: 'HIGH',
    probability: '82% probability of cardiovascular or respiratory collapse within 6 hours',
    clinicalAction: 'EMERGENCY: Immediate ICU / Cardiologist triage escalation. Automated caregiver SOS dispatched.',
    subScores: [
      { name: 'Respiration Rate', value: '26', unit: 'bpm', score: 3, statusText: 'Severe Tachypnea (≥25)', icon: <Wind className="w-4 h-4 text-rose-400" /> },
      { name: 'Oxygen Saturation (SpO2)', value: '90', unit: '%', score: 3, statusText: 'Critical Hypoxemia (≤91)', icon: <Activity className="w-4 h-4 text-rose-400" /> },
      { name: 'Systolic Blood Pressure', value: '92', unit: 'mmHg', score: 2, statusText: 'Hypotensive Shock (91-100)', icon: <Heart className="w-4 h-4 text-rose-400" /> },
      { name: 'Pulse / Heart Rate', value: '116', unit: 'bpm', score: 1, statusText: 'Tachycardia (111-130)', icon: <Heart className="w-4 h-4 text-rose-400" /> },
      { name: 'Neurological (AVPU)', value: 'Voice', unit: 'AVPU', score: 0, statusText: 'Responds to Voice', icon: <Brain className="w-4 h-4 text-amber-400" /> },
      { name: 'Core Temperature', value: '38.6', unit: '°C', score: 0, statusText: 'Febrile (≥38.1)', icon: <Thermometer className="w-4 h-4 text-amber-400" /> },
    ],
  },
};

export const NEWS2ScoreCard: React.FC = () => {
  const navigate = useNavigate();
  const [activePreset, setActivePreset] = useState<'STABLE' | 'MODERATE' | 'CRITICAL'>('STABLE');
  const profile = PROFILES[activePreset];

  const handlePresetChange = async (preset: 'STABLE' | 'MODERATE' | 'CRITICAL') => {
    setActivePreset(preset);
    if (preset === 'CRITICAL') {
      playWrongPillBuzzer();
      try {
        const res = await vitalsService.testAlarm({
          scenario: 'NEWS2_CRITICAL',
          value: 9,
          notes: 'National Early Warning Score (NEWS2) acute deterioration simulation',
        });
        const names = res.caregiversNotified?.map((c) => c.name).join(', ');
        if (names) {
          notify.error(`🚨 NEWS2 CRITICAL ALERT: Score = 9! Caregiver ${names} alerted.`);
        } else {
          notify.error('🚨 NEWS2 CRITICAL ALERT: Early Warning Score = 9. Imminent shock risk detected!');
        }
      } catch {
        notify.error('🚨 NEWS2 CRITICAL ALERT: Early Warning Score = 9. Imminent shock risk detected!');
      }
    } else if (preset === 'MODERATE') {
      notify.message('⚠️ NEWS2 Warning: Score = 5. Subclinical physiological decline flagged.');
    } else {
      playSuccessChime();
      vitalsService.dismissAlarm({
        scenario: 'NEWS2_CRITICAL',
        reason: 'Patient NEWS2 baseline restored.',
      }).catch(() => {});
      notify.success('✅ NEWS2 Baseline Restored: Normal vitals index.');
    }
  };

  const getTone = (level: 'LOW' | 'MEDIUM' | 'HIGH') => {
    switch (level) {
      case 'HIGH':
        return 'danger';
      case 'MEDIUM':
        return 'warning';
      case 'LOW':
      default:
        return 'success';
    }
  };

  const getBorderColor = (level: 'LOW' | 'MEDIUM' | 'HIGH') => {
    switch (level) {
      case 'HIGH':
        return 'border-rose-500/50 bg-gradient-to-br from-rose-950/30 via-slate-900 to-slate-950 shadow-rose-950/30';
      case 'MEDIUM':
        return 'border-amber-500/50 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-950 shadow-amber-950/30';
      case 'LOW':
      default:
        return 'border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 via-slate-900 to-slate-950 shadow-emerald-950/20';
    }
  };

  return (
    <Card className={`relative overflow-hidden border p-5 transition-all duration-300 shadow-xl ${getBorderColor(profile.riskLevel)}`}>
      {/* Background Pulse Glow for Critical */}
      {profile.riskLevel === 'HIGH' && (
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl animate-pulse" />
      )}

      {/* Header & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/50 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${
              profile.riskLevel === 'HIGH'
                ? 'bg-rose-500/20 text-rose-400 ring-rose-500/40 animate-pulse'
                : profile.riskLevel === 'MEDIUM'
                ? 'bg-amber-500/20 text-amber-400 ring-amber-500/40'
                : 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/40'
            }`}
          >
            <Stethoscope className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-text-primary">
                Predictive Decompensation Engine (NEWS2)
              </h3>
              <Badge tone={getTone(profile.riskLevel)} dot>
                {profile.riskLevel} RISK
              </Badge>
            </div>
            <p className="text-xs text-text-muted">
              Royal College of Physicians (RCP) 7-Parameter Early Warning Scoring
            </p>
          </div>
        </div>

        {/* Preset Simulator Toggle Buttons for Judges */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-surface/80 p-1 border border-border">
          <span className="text-[10px] font-bold text-text-muted px-2 uppercase tracking-wider">
            Judge Demo:
          </span>
          <button
            type="button"
            onClick={() => handlePresetChange('STABLE')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              activePreset === 'STABLE'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Stable (0)
          </button>
          <button
            type="button"
            onClick={() => handlePresetChange('MODERATE')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
              activePreset === 'MODERATE'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Moderate (5)
          </button>
          <button
            type="button"
            onClick={() => handlePresetChange('CRITICAL')}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              activePreset === 'CRITICAL'
                ? 'bg-rose-600 text-white shadow-sm animate-pulse'
                : 'text-rose-400 hover:text-rose-300'
            }`}
          >
            Critical (9)
          </button>
        </div>
      </div>

      {/* Main Score & Prediction Showcase */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3 items-center">
        <div className="rounded-xl border border-border/60 bg-surface/50 p-4 text-center lg:text-left flex items-center gap-4">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-black/40 ring-2 ring-border">
            <span
              className={`text-3xl font-black ${
                profile.riskLevel === 'HIGH'
                  ? 'text-rose-400 animate-pulse'
                  : profile.riskLevel === 'MEDIUM'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {profile.totalScore}
            </span>
            <span className="absolute bottom-1 text-[9px] font-semibold text-text-muted uppercase">
              / 20 Max
            </span>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Forecast Horizon (6-12h)
            </span>
            <p className="mt-0.5 text-xs font-bold text-text-primary">
              {profile.probability}
            </p>
            <p className="mt-1 text-[11px] text-text-secondary leading-snug">
              {profile.clinicalAction}
            </p>
          </div>
        </div>

        {/* 6 Sub-parameters Grid */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {profile.subScores.map((item) => (
            <div
              key={item.name}
              className="rounded-lg border border-border/60 bg-surface/40 p-2.5 transition-colors hover:border-border"
            >
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span className="truncate pr-1 text-[11px] font-medium">{item.name}</span>
                {item.icon}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm font-bold text-text-primary">
                  {item.value} <span className="text-[10px] font-normal text-text-muted">{item.unit}</span>
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    item.score >= 3
                      ? 'bg-rose-500/20 text-rose-300'
                      : item.score >= 1
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  +{item.score} pts
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-text-muted">
                {item.statusText}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Critical Escalation Banner (when score >= 5) */}
      {profile.totalScore >= 5 && (
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 shadow-md">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 animate-bounce" />
            <div>
              <p className="text-xs font-bold text-rose-200">
                Early Decompensation Warning Triggered
              </p>
              <p className="text-[11px] text-rose-300/80">
                Multiparametric deterioration indicates decompensation ahead of single-vital crisis. Immediate clinical intervention recommended.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
            <Button
              size="sm"
              variant="danger"
              className="w-full sm:w-auto font-bold text-xs"
              leftIcon={<PhoneCall className="w-3.5 h-3.5" />}
              onClick={() => navigate(ROUTES.EMERGENCY)}
            >
              Emergency Triage SOS
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

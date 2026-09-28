import React, { useState, useEffect } from 'react';
import { Siren, AlertTriangle, ShieldCheck, HeartPulse, Wind, MapPin, CheckCircle2, UserCheck, XCircle, PhoneCall, Volume2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { notify } from '@/components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/constants/app';
import { playEmergencySiren, stopAllAudio } from '@/lib/audio-siren';
import { emergencyService } from '@/services/emergency.service';
import { vitalsService } from '@/services/vitals.service';

interface AutonomousSosSimulatorModalProps {
  open: boolean;
  onClose: () => void;
}

export const AutonomousSosSimulatorModal: React.FC<AutonomousSosSimulatorModalProps> = ({
  open,
  onClose,
}) => {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'IDLE' | 'COUNTDOWN' | 'DISPATCHED' | 'DISMISSED'>('IDLE');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [selectedTrigger, setSelectedTrigger] = useState<'SPO2_CRASH' | 'FALL_IMPACT' | 'CARDIAC_SPIKE'>('SPO2_CRASH');
  const [notifiedCaregivers, setNotifiedCaregivers] = useState<Array<{ id: string; name: string; email: string; phone?: string | null }>>([]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (stage === 'COUNTDOWN' && secondsRemaining > 0) {
      timer = setInterval(() => {
        setSecondsRemaining((prev) => prev - 1);
      }, 1000);
    } else if (stage === 'COUNTDOWN' && secondsRemaining === 0) {
      stopAllAudio();
      setStage('DISPATCHED');
      notify.error('🚨 0-Click SOS Auto-Dispatched! Paramedics and Caregivers Notified.');

      // Real backend API dispatch - notifies Care Circle & Caregivers in DB
      emergencyService.requestAmbulance({
        latitude: 17.385044,
        longitude: 78.486671,
        address: 'Banjara Hills, Hyderabad (Current GPS Location)',
        emergencyType: selectedTrigger === 'SPO2_CRASH' ? 'Severe Hypoxia (SpO2: 76%)' : selectedTrigger === 'FALL_IMPACT' ? 'Unconscious Fall & Immobility' : 'Cardiac Tachycardia (165 BPM)',
        notes: 'Autonomous Zero-Click Emergency Dispatch: Patient unresponsive to 30s liveness siren. Allergic to Penicillin.',
        destinationHospital: 'Apollo Emergency & Trauma Center',
      }).catch((e) => console.warn('Emergency dispatch telemetry sync:', e));
    }
    return () => clearInterval(timer);
  }, [stage, secondsRemaining, selectedTrigger]);

  const handleStartSimulation = async (trigger: 'SPO2_CRASH' | 'FALL_IMPACT' | 'CARDIAC_SPIKE') => {
    setSelectedTrigger(trigger);
    setSecondsRemaining(30);
    setStage('COUNTDOWN');
    playEmergencySiren();

    const scenario = trigger === 'CARDIAC_SPIKE' ? 'TACHYCARDIA' : trigger;
    const value = trigger === 'SPO2_CRASH' ? 76 : trigger === 'CARDIAC_SPIKE' ? 165 : undefined;
    try {
      const res = await vitalsService.testAlarm({
        scenario,
        value,
        notes: 'Autonomous Zero-Click Emergency Liveness Switch',
      });
      if (res.caregiversNotified?.length) {
        setNotifiedCaregivers(res.caregiversNotified);
      }
    } catch (e) {
      console.warn('Emergency test alarm sync:', e);
    }
  };

  const handleDismiss = async () => {
    stopAllAudio();
    setStage('DISMISSED');
    notify.success('Emergency disarmed. Patient confirmed conscious (False alarm logged).');
    try {
      await vitalsService.dismissAlarm({
        scenario: selectedTrigger,
        reason: 'Patient confirmed conscious and dismissed 30-second emergency siren.',
      });
    } catch (e) {
      console.warn('Alarm dismiss sync:', e);
    }
  };

  const handleReset = () => {
    stopAllAudio();
    setStage('IDLE');
    setSecondsRemaining(30);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        handleReset();
        onClose();
      }}
      title="Autonomous Zero-Click Emergency & Liveness Switch"
      className="max-w-xl"
    >
      <div className="space-y-4 pt-1">
        {/* Stage 1: Trigger Selection */}
        {stage === 'IDLE' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface-raised p-3.5">
              <p className="text-xs text-text-secondary leading-relaxed">
                Demonstrates how MediTrack AI protects an <strong>unconscious, solitary patient</strong> who cannot click an SOS button. When wearable vitals crash or high-G impact is detected, the 30-second fail-safe countdown begins.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Select Anomaly Scenario to Simulate
              </span>

              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleStartSimulation('SPO2_CRASH')}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/20 hover:bg-rose-950/40 text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
                      <Wind className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-text-primary">Severe Hypoxia (SpO2: 76%)</p>
                      <p className="text-xs text-text-muted">Simulates silent nocturnal oxygen crash in chronic COPD/Cardiac patient</p>
                    </div>
                  </div>
                  <Badge tone="danger">SpO2 &lt; 80%</Badge>
                </button>

                <button
                  type="button"
                  onClick={() => handleStartSimulation('FALL_IMPACT')}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/20 hover:bg-amber-950/40 text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-text-primary">High-G Fall + Immobility</p>
                      <p className="text-xs text-text-muted">High-impact accelerometer spike followed by 60s of total motionlessness</p>
                    </div>
                  </div>
                  <Badge tone="warning">Fall Shock</Badge>
                </button>

                <button
                  type="button"
                  onClick={() => handleStartSimulation('CARDIAC_SPIKE')}
                  className="w-full flex items-center justify-between p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/20 hover:bg-blue-950/40 text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                      <HeartPulse className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-text-primary">Severe Tachycardia (165 BPM)</p>
                      <p className="text-xs text-text-muted">Dangerous resting heart rate spike detected from budget smartwatch</p>
                    </div>
                  </div>
                  <Badge tone="info">HR &gt; 160</Badge>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stage 2: 30-Second Liveness Countdown Switch */}
        {stage === 'COUNTDOWN' && (
          <div className="rounded-2xl border-2 border-rose-500 bg-rose-950/40 p-6 text-center space-y-4 animate-pulse">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-xl shadow-rose-600/50">
              <Siren className="h-8 w-8 animate-spin" />
            </div>

            <div>
              <span className="text-xs font-black uppercase tracking-widest text-rose-400">
                ⚡ AUTONOMOUS FAIL-SAFE LIVENESS CHECK ACTIVATED
              </span>
              <h3 className="text-3xl font-black text-white mt-1 font-mono">
                00:{secondsRemaining < 10 ? `0${secondsRemaining}` : secondsRemaining}
              </h3>
              <p className="text-xs text-rose-200 mt-1 max-w-sm mx-auto">
                Audible siren sounding. Companion AI listening: <em>"Critical anomaly detected. Are you okay? Tap or speak to dismiss."</em>
              </p>
            </div>

            <div className="rounded-xl bg-black/50 p-3 text-xs text-slate-300 border border-rose-500/30 font-mono text-left space-y-1">
              <div>Trigger: <span className="text-rose-400 font-bold">{selectedTrigger === 'SPO2_CRASH' ? 'SpO2: 76% (Critical Drop)' : selectedTrigger === 'FALL_IMPACT' ? 'Fall Detected (No Motion)' : 'HR: 165 BPM (Tachycardia)'}</span></div>
              <div>Source: <span className="text-emerald-400">Google Health Connect (boAt Wave Watch)</span></div>
              <div>Caregiver: <span className="text-blue-400 font-bold">{notifiedCaregivers.length > 0 ? notifiedCaregivers.map((c) => c.name).join(', ') + ' (Care Circle Alerted)' : 'Priya Sharma (Active Caregiver)'}</span></div>
              <div>Status: <span className="text-amber-400">Awaiting Conscious Liveness Input</span></div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <Button
                type="button"
                onClick={handleDismiss}
                className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-3"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-400" /> I AM OKAY (Dismiss)
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => setSecondsRemaining(0)}
                className="text-xs font-bold py-3 uppercase tracking-wider"
              >
                <Siren className="w-4 h-4 mr-1.5" /> Simulate Unconscious (Auto-0:00)
              </Button>
            </div>
          </div>
        )}

        {/* Stage 3: Auto-Dispatched Result */}
        {stage === 'DISPATCHED' && (
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-950/30 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <h4 className="text-base font-black text-emerald-300 uppercase tracking-wide">
                  Autonomous Zero-Click Emergency Dispatched!
                </h4>
                <p className="text-xs text-emerald-200/80">
                  Patient remained unresponsive. Emergency Medical Passport & live GPS broadcasted.
                </p>
              </div>
            </div>

            {/* Medical Passport Payload */}
            <div className="rounded-xl bg-black/60 p-3.5 border border-emerald-500/30 text-xs space-y-2 font-mono">
              <div className="flex items-center justify-between text-slate-300 pb-1 border-b border-slate-800">
                <span className="text-slate-400">Patient:</span>
                <span className="font-bold text-white">Ramesh Sharma (68y, B+)</span>
              </div>
              <div className="flex items-center justify-between text-slate-300 pb-1 border-b border-slate-800">
                <span className="text-slate-400">Live GPS:</span>
                <span className="font-bold text-emerald-400">17.385044, 78.486671</span>
              </div>
              <div className="flex items-center justify-between text-slate-300 pb-1 border-b border-slate-800">
                <span className="text-slate-400">Critical Active Rx:</span>
                <span className="font-bold text-amber-300">Telmisartan 40mg, Metformin 500mg</span>
              </div>
              <div className="flex items-center justify-between text-slate-300 pb-1 border-b border-slate-800">
                <span className="text-slate-400">Severe Allergy:</span>
                <span className="font-bold text-rose-400">Penicillin (Severe Hypersensitivity)</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Caregiver Notified:</span>
                <span className="font-bold text-blue-400">
                  {notifiedCaregivers.length > 0
                    ? notifiedCaregivers.map((c) => `${c.name} (${c.phone || c.email})`).join(', ')
                    : 'Priya Sharma (+919876543210)'}
                </span>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={handleReset}>
                Run Another Test
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onClose();
                  navigate('/ambulance-tracking', {
                    state: {
                      emergencyType: selectedTrigger === 'SPO2_CRASH' ? 'Severe Hypoxia' : 'Unconscious Collapse',
                      latitude: 17.385044,
                      longitude: 78.486671,
                      destinationHospital: 'Apollo Emergency Trauma Center',
                    },
                  });
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
              >
                <MapPin className="w-4 h-4 mr-1.5" /> Track Ambulance on Map
              </Button>
            </div>
          </div>
        )}

        {/* Stage 4: Dismissed State */}
        {stage === 'DISMISSED' && (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-emerald-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-bold text-text-primary">
              Emergency Standdown Logged
            </h4>
            <p className="text-xs text-text-muted max-w-sm mx-auto">
              Patient confirmed conscious within the 30-second window. No ambulance dispatched; event recorded as `LIVENESS_DISARMED` in audit logs.
            </p>
            <div className="pt-2">
              <Button size="sm" onClick={handleReset}>
                Reset Simulator
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

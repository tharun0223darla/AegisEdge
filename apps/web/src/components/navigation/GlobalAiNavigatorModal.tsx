import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoiceSession } from '@/hooks/useVoice';
import {
  Sparkles,
  Bot,
  User,
  Send,
  Mic,
  X,
  Compass,
  ArrowRight,
  Pill,
  ScanLine,
  Siren,
  UsersRound,
  FileText,
  Syringe,
  BarChart3,
  CalendarClock,
  ShieldAlert,
  Building2,
  PackageSearch,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ROUTES } from '@/constants/app';

interface Message {
  role: 'assistant' | 'user';
  text: string;
  actionRoute?: string;
  actionLabel?: string;
}

interface AppRouteGuide {
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  color: string;
}

const APP_ROUTES: AppRouteGuide[] = [
  {
    title: 'Dashboard & Vitals',
    description: 'Today’s schedule, wearable RPM telemetry, streak & live vitals.',
    route: ROUTES.DASHBOARD,
    icon: BarChart3,
    badge: 'Home',
    color: 'from-blue-600 to-indigo-600',
  },
  {
    title: 'Medicine Library',
    description: 'All 18+ active medicines, generic details & pill master records.',
    route: ROUTES.MEDICINES,
    icon: Pill,
    badge: 'Inventory',
    color: 'from-emerald-600 to-teal-600',
  },
  {
    title: 'Point-of-Care Blister OCR',
    description: 'Scan medicine packaging & blister strips to prevent wrong pills.',
    route: ROUTES.PRESCRIPTIONS,
    icon: ScanLine,
    badge: 'Vision AI',
    color: 'from-purple-600 to-pink-600',
  },
  {
    title: 'Dose Timeline & Alarms',
    description: 'Take, snooze, verify strips, and confirm daily dosage timestamps.',
    route: ROUTES.DOSE_LOGS,
    icon: CalendarClock,
    badge: 'Timeline',
    color: 'from-amber-600 to-orange-600',
  },
  {
    title: 'Autonomous 0-Click SOS',
    description: '30s liveness countdown, ambulance dispatch & GPS family alert.',
    route: ROUTES.EMERGENCY,
    icon: Siren,
    badge: 'Emergency',
    color: 'from-rose-600 to-red-600',
  },
  {
    title: 'Care Circle Portal',
    description: 'Link caregivers with real-time missed dose escalations.',
    route: ROUTES.CARE,
    icon: UsersRound,
    badge: 'Family Care',
    color: 'from-cyan-600 to-blue-600',
  },
  {
    title: 'Doctor Visit Reports (PDF)',
    description: '30-day clinical correlation PDFs for physician appointments.',
    route: ROUTES.DOCTOR_REPORTS,
    icon: FileText,
    badge: 'Doctor PDF',
    color: 'from-indigo-600 to-violet-600',
  },
  {
    title: 'Vaccination Passport',
    description: 'Vaccine records, CDC/WHO schedule & nearby vaccination centers.',
    route: ROUTES.VACCINATIONS,
    icon: Syringe,
    badge: 'Immunity',
    color: 'from-emerald-600 to-green-600',
  },
  {
    title: 'Stock Refills',
    description: 'Remaining tablet inventory counts & 1-click pharmacy reorders.',
    route: ROUTES.REFILLS,
    icon: PackageSearch,
    badge: 'Pharmacy',
    color: 'from-orange-600 to-amber-600',
  },
];

const QUICK_NAVIGATION_PROMPTS = [
  { text: 'How do I scan my blister strip to verify a pill?', route: ROUTES.PRESCRIPTIONS, label: 'Open Prescriptions & OCR' },
  { text: 'Where is the 30-Second Emergency SOS & Ambulance dispatch?', route: ROUTES.EMERGENCY, label: 'Open Emergency SOS' },
  { text: 'How do I link my family caregiver or daughter?', route: ROUTES.CARE, label: 'Open Care Circle' },
  { text: 'How do I download a PDF health report for my doctor?', route: ROUTES.DOCTOR_REPORTS, label: 'Open Doctor Reports' },
  { text: 'Where do I find all my active medicines?', route: ROUTES.MEDICINES, label: 'Open Medicine Library' },
  { text: 'Where can I see today\'s dose alarms and logs?', route: ROUTES.DOSE_LOGS, label: 'Open Dose Timeline' },
];

interface GlobalAiNavigatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalAiNavigatorModal: React.FC<GlobalAiNavigatorModalProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const { startSession, respondToSession, isResponding } = useVoiceSession();

  const [activeTab, setActiveTab] = useState<'chat' | 'sitemap'>('chat');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [typedMessage, setTypedMessage] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleNavigate = (route: string) => {
    onClose();
    navigate(route);
  };

  const handleSendMessage = useCallback(
    async (rawText: string, suggestedRoute?: string, suggestedLabel?: string) => {
      const userText = rawText.trim();
      if (!userText) return;

      let currentId = activeSessionId;
      if (!currentId) {
        try {
          const newSession = await startSession();
          currentId = newSession.id;
          setActiveSessionId(newSession.id);
        } catch {
          // ignore
        }
      }

      setTranscript((prev) => [
        ...prev,
        { role: 'user', text: userText },
      ]);

      // Detect relevant navigation route from query
      let matchedRoute = suggestedRoute;
      let matchedLabel = suggestedLabel;
      const lower = userText.toLowerCase();

      if (!matchedRoute) {
        if (lower.includes('strip') || lower.includes('ocr') || lower.includes('scan') || lower.includes('prescription')) {
          matchedRoute = ROUTES.PRESCRIPTIONS;
          matchedLabel = '🚀 Jump to Prescriptions & OCR';
        } else if (lower.includes('emergency') || lower.includes('sos') || lower.includes('ambulance') || lower.includes('siren')) {
          matchedRoute = ROUTES.EMERGENCY;
          matchedLabel = '🚨 Open Emergency SOS';
        } else if (lower.includes('caregiver') || lower.includes('family') || lower.includes('daughter') || lower.includes('circle')) {
          matchedRoute = ROUTES.CARE;
          matchedLabel = '👨‍👩‍👧 Open Care Circle';
        } else if (lower.includes('doctor') || lower.includes('report') || lower.includes('pdf')) {
          matchedRoute = ROUTES.DOCTOR_REPORTS;
          matchedLabel = '📄 Open Doctor Reports';
        } else if (lower.includes('vaccine') || lower.includes('vaccination') || lower.includes('immunization')) {
          matchedRoute = ROUTES.VACCINATIONS;
          matchedLabel = '💉 Open Vaccine Passport';
        } else if (lower.includes('refill') || lower.includes('pharmacy') || lower.includes('stock')) {
          matchedRoute = ROUTES.REFILLS;
          matchedLabel = '📦 Open Stock Refills';
        } else if (lower.includes('medicine') || lower.includes('pills') || lower.includes('drugs') || lower.includes('all my')) {
          matchedRoute = ROUTES.MEDICINES;
          matchedLabel = '💊 Open Medicine Library';
        } else if (lower.includes('schedule') || lower.includes('alarm') || lower.includes('dose') || lower.includes('today')) {
          matchedRoute = ROUTES.DOSE_LOGS;
          matchedLabel = '⏰ Open Dose Timeline';
        }
      }

      if (currentId) {
        try {
          const res = await respondToSession({ sessionId: currentId, message: userText });
          const newTranscript = res.transcript as Message[];
          const lastMsg = newTranscript[newTranscript.length - 1];
          if (lastMsg?.role === 'assistant') {
            setTranscript((prev) => [
              ...prev,
              {
                role: 'assistant',
                text: lastMsg.text,
                actionRoute: matchedRoute,
                actionLabel: matchedLabel,
              },
            ]);
            if (autoSpeak && synthRef.current) {
              const u = new SpeechSynthesisUtterance(lastMsg.text);
              synthRef.current.speak(u);
            }
          }
        } catch {
          setTranscript((prev) => [
            ...prev,
            {
              role: 'assistant',
              text: `You can access this directly through MediTrack navigation. Click below to navigate directly:`,
              actionRoute: matchedRoute,
              actionLabel: matchedLabel,
            },
          ]);
        }
      }
    },
    [activeSessionId, autoSpeak, respondToSession, startSession],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  useEffect(() => {
    if (isOpen && transcript.length === 0) {
      setTranscript([
        {
          role: 'assistant',
          text: `👋 Welcome to MediTrack AI! I am your intelligent app navigator & clinical companion.\n\nYou can ask me ANY medical question, or ask how to use any feature (e.g. "How do I scan a medicine blister?", "Where is Emergency SOS?"). Where would you like to go?`,
        },
      ]);
    }
  }, [isOpen, transcript.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          className="relative w-full max-w-4xl h-[88vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand-600 via-rose-600 to-indigo-600 text-white shadow-lg shadow-brand-500/20">
                <Sparkles className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-white tracking-tight">
                    MediTrack AI App Navigator & Clinical Guide
                  </h3>
                  <span className="rounded-full bg-brand-500/10 border border-brand-500/30 px-2 py-0.5 text-[10px] font-black uppercase text-brand-400">
                    Interactive Tour
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Instant guidance for patients and caregivers across all features.
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* Tab Selector */}
              <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('chat')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'chat'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  AI Assistant
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('sitemap')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'sitemap'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Feature Map ({APP_ROUTES.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`p-2 rounded-xl border transition-colors ${
                  autoSpeak
                    ? 'bg-slate-800 border-slate-700 text-rose-400'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
                title={autoSpeak ? 'Audio Speech ON' : 'Audio Speech OFF'}
              >
                {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Tab 1: AI Chat with Action Navigation Links */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
              {/* Conversation stream */}
              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {transcript.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-start gap-3 ${
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white shadow-sm mt-1">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-brand-600 to-indigo-600 text-white shadow-md rounded-br-none'
                          : 'bg-slate-950 border border-slate-800 text-slate-200 rounded-bl-none shadow-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.text}</div>

                      {/* Actionable Deep Link Navigation Button */}
                      {msg.actionRoute && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => handleNavigate(msg.actionRoute!)}
                            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-md transition-all group"
                          >
                            <span>{msg.actionLabel || 'Navigate to Page'}</span>
                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </button>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-300 border border-slate-700 mt-1">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </motion.div>
                ))}

                {isResponding && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-white animate-pulse">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="rounded-2xl bg-slate-950 border border-slate-800 px-4 py-2.5 text-xs text-slate-400 flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-brand-400 animate-ping" />
                      Finding best clinical answer & application route...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Quick Guidance Chips */}
              <div className="mt-3 pt-2 border-t border-slate-800/80">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5 text-brand-400" />
                  <span>1-Tap App Feature Guide:</span>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {QUICK_NAVIGATION_PROMPTS.map((prompt, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => void handleSendMessage(prompt.text, prompt.route, prompt.label)}
                      className="whitespace-nowrap rounded-xl border border-slate-800 bg-slate-950/80 hover:bg-slate-800 hover:border-brand-500/40 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-all shrink-0 text-left"
                    >
                      {prompt.text}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = typedMessage;
                  setTypedMessage('');
                  void handleSendMessage(t);
                }}
                className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800"
              >
                <input
                  type="text"
                  value={typedMessage}
                  onChange={(e) => setTypedMessage(e.target.value)}
                  placeholder="Ask any question (e.g. 'How to scan blister strip', 'Where are my doctor reports?')..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
                />
                <button
                  type="submit"
                  disabled={!typedMessage.trim() || isResponding}
                  className="px-5 py-3 bg-gradient-to-r from-brand-600 to-indigo-600 hover:brightness-110 text-white rounded-xl disabled:opacity-40 font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Ask AI</span>
                </button>
              </form>
            </div>
          )}

          {/* Tab 2: Visual Interactive Feature Map */}
          {activeTab === 'sitemap' && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="mb-4">
                <h4 className="text-sm font-black text-white">
                  MediTrack AI Application Navigation Directory
                </h4>
                <p className="text-xs text-slate-400">
                  Click on any feature below to navigate directly to that section of the platform.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {APP_ROUTES.map((item, rIdx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={rIdx}
                      type="button"
                      onClick={() => handleNavigate(item.route)}
                      className="p-4 rounded-2xl border border-slate-800 bg-slate-950/70 hover:bg-slate-800/90 hover:border-brand-500/50 text-left transition-all group flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr ${item.color} text-white shadow-sm`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            {item.badge}
                          </span>
                        </div>
                        <h5 className="text-xs font-bold text-white group-hover:text-brand-300 transition-colors">
                          {item.title}
                        </h5>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          {item.description}
                        </p>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-brand-400 font-bold">
                        <span>Open Screen</span>
                        <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

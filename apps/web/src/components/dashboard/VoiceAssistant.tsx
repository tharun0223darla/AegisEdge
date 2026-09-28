import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoiceSession } from '@/hooks/useVoice';
import { HeartPulse, Mic, Send, Square, Globe, Sparkles, Volume2, VolumeX, ShieldCheck, Copy, Check, Maximize2, Minimize2, Trash2, Bot, User, RefreshCw, AlertTriangle, ArrowRight, Ambulance, Pill, RefreshCw as RefillIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ROUTES } from '@/constants/app';

const cleanMarkdownForSpeech = (text: string): string => {
  return text
    .replace(/[*#`_~]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[-•]\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

interface Message {
  role: 'assistant' | 'user';
  text: string;
  isError?: boolean;
}

type SpeechRecognitionEventLike = {
  results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
};

type SpeechRecognitionErrorLike = {
  error?: string;
  message?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type SupportedLanguage = 'en-IN' | 'hi-IN' | 'te-IN' | 'ta-IN';

const LANGUAGE_DATA: Record<SupportedLanguage, { label: string; name: string; placeholder: string; greeting: string }> = {
  'en-IN': {
    label: 'English (IN)',
    name: 'English',
    placeholder: 'Ask any medical question (e.g., "Explain how ACE inhibitors work", "Diabetic diet guide")...',
    greeting: 'Hello. I am your MediTrack Clinical AI Assistant. You can ask me any medical, pharmacological, or health question. How can I help you today?',
  },
  'hi-IN': {
    label: 'हिंदी (Hindi)',
    name: 'Hindi',
    placeholder: 'कोई भी स्वास्थ्य या दवा संबंधी सवाल पूछें...',
    greeting: 'नमस्ते। मैं आपका मेडीट्रैक क्लिनिकल एआई सहायक हूँ। आप मुझसे किसी भी बीमारी, दवा या स्वास्थ्य से जुड़ा सवाल पूछ सकते हैं।',
  },
  'te-IN': {
    label: 'తెలుగు (Telugu)',
    name: 'Telugu',
    placeholder: 'ఏదైనా వైద్య లేదా ఔషధ సంబంధిత ప్రశ్న అడగండి...',
    greeting: 'నమస్కారం. నేను మీ మెడిట్రాక్ క్లినికల్ ఏఐ సహాయకుడిని. మీరు నన్ను ఏదైనా ఆరోగ్య లేదా మందుల ప్రశ్న అడగవచ్చు.',
  },
  'ta-IN': {
    label: 'தமிழ் (Tamil)',
    name: 'Tamil',
    placeholder: 'மருத்துவ அல்லது மருந்து தொடர்பான கேள்விகளைக் கேளுங்கள்...',
    greeting: 'வணக்கம். நான் உங்கள் மெடிட்ராக் மருத்துவ AI உதவியாளர். நீங்கள் என்னிடம் எந்த மருத்துவ கேள்வியையும் கேட்கலாம்.',
  },
};

const SUGGESTED_QUERIES = [
  'What medicines do I have in my profile?',
  'Can I take Dolo 650 with my blood pressure medicine?',
  'How does Telmisartan protect kidneys in diabetes?',
  'What should I do if I feel dizzy after morning medication?',
  'What are the best Indian foods for Type 2 Diabetes?',
  'Why is my blood sugar higher in the morning (Dawn Phenomenon)?',
  'मेरी दवा खाने के पहले लेनी है या बाद में?',
  'నా బీపీ మందుతో పాటు పారాసిటమాల్ తీసుకోవచ్చా?',
];

export const VoiceAssistant: React.FC = () => {
  const navigate = useNavigate();
  const {
    startSession,
    respondToSession,
    isResponding,
  } = useVoiceSession();

  const [language, setLanguage] = useState<SupportedLanguage>('en-IN');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [typedMessage, setTypedMessage] = useState('');
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [statusText, setStatusText] = useState('MediTrack Clinical AI • Multi-Model Failover & Live RAG Active');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const speak = useCallback((text: string) => {
    if (!synthRef.current || !autoSpeak) return;
    synthRef.current.cancel();
    const cleanText = cleanMarkdownForSpeech(text);
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = language;
    utterance.rate = 0.95;
    synthRef.current.speak(utterance);
  }, [language, autoSpeak]);

  const handleUserMessage = useCallback(
    async (rawText: string) => {
      const userText = rawText.trim();
      if (!userText) return;

      // Direct intent navigation triggers
      const lower = userText.toLowerCase();
      if (
        (lower.includes('emergency') && (lower.includes('open') || lower.includes('take me') || lower.includes('go to') || lower.includes('trigger'))) ||
        lower.includes('call ambulance') ||
        lower.includes('call 108') ||
        lower.includes('అత్యవసరం')
      ) {
        speak('Opening Emergency S O S immediately.');
        navigate(ROUTES.EMERGENCY);
        return;
      }
      if (
        lower.includes('show hospitals') ||
        lower.includes('nearby hospitals') ||
        lower.includes('find hospital') ||
        lower.includes('ఆసుపత్రి')
      ) {
        speak('Opening nearby hospitals map.');
        navigate(ROUTES.HOSPITALS);
        return;
      }
      if (
        lower.includes('open refills') ||
        lower.includes('jan aushadhi') ||
        lower.includes('generic refill')
      ) {
        speak('Opening Jan Aushadhi generic auto refills.');
        navigate(ROUTES.REFILLS);
        return;
      }
      if (
        lower.includes('dose logs') ||
        lower.includes('verify strip') ||
        lower.includes('verify medicine')
      ) {
        speak('Opening dose timeline and strip verification.');
        navigate(ROUTES.DOSE_LOGS);
        return;
      }

      setLastFailedText(null);
      let currentId = activeSessionId;
      if (!currentId) {
        try {
          const newSession = await startSession();
          currentId = newSession.id;
          setActiveSessionId(newSession.id);
        } catch {
          setStatusText('Could not connect to session. Retrying...');
        }
      }

      setTranscript((prev) => [...prev, { role: 'user', text: userText }]);
      setStatusText('Clinical AI is analyzing your medical inquiry...');

      try {
        if (!currentId) {
          throw new Error('Session could not be initialized');
        }
        const res = await respondToSession({
          sessionId: currentId,
          message: userText,
        });
        const newTranscript = res.transcript as Message[];
        setTranscript(newTranscript);

        const lastMsg = newTranscript[newTranscript.length - 1];
        if (lastMsg?.role === 'assistant') {
          speak(lastMsg.text);
        }
        setStatusText('Ready for your next medical query.');
      } catch {
        setLastFailedText(userText);
        const fallbackReply = `I am reviewing your clinical records. Always verify acute symptoms with your doctor. Tap "Retry" below to re-query the clinical AI.`;
        setTranscript((prev) => [...prev, { role: 'assistant', text: fallbackReply, isError: true }]);
        speak(fallbackReply);
        setStatusText('Network hiccup. Tap Retry or re-enter your question.');
      }
    },
    [activeSessionId, navigate, respondToSession, speak, startSession],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
    }

    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechRecognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = language;

      rec.onstart = () => {
        setIsListening(true);
        setStatusText(`Listening in ${LANGUAGE_DATA[language].name}...`);
      };

      rec.onresult = (event) => {
        const userText = event.results?.[0]?.[0]?.transcript ?? '';
        void handleUserMessage(userText);
      };

      rec.onerror = () => {
        setIsListening(false);
        setStatusText('Microphone paused. Tap mic to speak again.');
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    } else {
      recognitionRef.current = null;
    }

    return () => {
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, [handleUserMessage, language]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const handleToggleMic = () => {
    if (!recognitionRef.current) {
      setStatusText('Speech recognition not available. Please type your query below.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (synthRef.current) synthRef.current.cancel();
      try {
        recognitionRef.current.lang = language;
        recognitionRef.current.start();
      } catch {
        setIsListening(false);
        setStatusText('Microphone could not start.');
      }
    }
  };

  const handleTypedSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = typedMessage;
    setTypedMessage('');
    void handleUserMessage(message);
  };

  const handleClearChat = () => {
    if (synthRef.current) synthRef.current.cancel();
    setTranscript([]);
    setActiveSessionId(null);
    setLastFailedText(null);
    setStatusText('Chat cleared. Start a new medical query anytime.');
  };

  const getActionCards = (text: string) => {
    const t = text.toLowerCase();
    const actions: Array<{ label: string; sub: string; onClick: () => void; color: string }> = [];

    if (
      t.includes('emergency') ||
      t.includes('108') ||
      t.includes('ambulance') ||
      t.includes('hospital') ||
      t.includes('chest pain') ||
      t.includes('shortness of breath') ||
      t.includes('severe')
    ) {
      actions.push({
        label: '🚨 Emergency SOS (108)',
        sub: 'Launch emergency response',
        onClick: () => navigate(ROUTES.EMERGENCY),
        color: 'bg-rose-600 hover:bg-rose-500 text-white border-rose-500/40',
      });
      actions.push({
        label: '🏥 Nearby Hospitals',
        sub: '24/7 care centres',
        onClick: () => navigate(ROUTES.HOSPITALS),
        color: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
      });
    }

    if (
      t.includes('refill') ||
      t.includes('jan aushadhi') ||
      t.includes('generic') ||
      t.includes('pmbjp')
    ) {
      actions.push({
        label: '🔄 Jan Aushadhi Refills',
        sub: 'Up to 85% savings',
        onClick: () => navigate(ROUTES.REFILLS),
        color: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/40',
      });
    }

    if (
      t.includes('verify') ||
      t.includes('counterfeit') ||
      t.includes('fake') ||
      t.includes('strip') ||
      t.includes('dose') ||
      t.includes('take') ||
      t.includes('schedule')
    ) {
      actions.push({
        label: '🛡️ Verify Strip & Dose Log',
        sub: 'CDSCO & GS1 verification',
        onClick: () => navigate(ROUTES.DOSE_LOGS),
        color: 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500/40',
      });
    }

    if (
      t.includes('medicines') ||
      t.includes('medication list') ||
      t.includes('profile')
    ) {
      actions.push({
        label: '📋 View All Medications',
        sub: 'Full active medicine library',
        onClick: () => navigate(ROUTES.MEDICINES),
        color: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700',
      });
    }

    return actions;
  };

  const handleCopyText = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-slate-100 flex flex-col transition-all duration-300 ${
      isExpanded ? 'fixed inset-4 z-50 h-[calc(100vh-2rem)] p-6 bg-slate-950/95 backdrop-blur-2xl' : 'h-[620px] p-5'
    }`}>
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-rose-600 to-indigo-600 text-white shadow-md">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-white tracking-tight">
                MediTrack Clinical Medical AI
              </h3>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live RAG • High-Resilience
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Ask any medical, pharmacological, disease, or dietary question freely.
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {(Object.keys(LANGUAGE_DATA) as SupportedLanguage[]).map((langKey) => (
              <button
                key={langKey}
                type="button"
                onClick={() => setLanguage(langKey)}
                className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                  language === langKey
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {LANGUAGE_DATA[langKey].label}
              </button>
            ))}
          </div>

          {/* Audio TTS Toggle */}
          <button
            type="button"
            onClick={() => {
              if (autoSpeak && synthRef.current) synthRef.current.cancel();
              setAutoSpeak(!autoSpeak);
            }}
            className={`p-2 rounded-xl border transition-colors ${
              autoSpeak
                ? 'bg-slate-800 border-slate-700 text-rose-400 hover:text-rose-300'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-400'
            }`}
            title={autoSpeak ? 'Voice Audio Enabled' : 'Voice Audio Muted'}
          >
            {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          {/* Clear Chat */}
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={handleClearChat}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Clear Conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          {/* Expand/Collapse Fullscreen */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition-colors"
            title={isExpanded ? 'Minimize' : 'Expand Fullscreen'}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Empty State Welcome */}
      {transcript.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-rose-500/20 via-brand-500/20 to-indigo-500/20 border border-rose-500/30 text-rose-400">
            <Sparkles className="h-8 w-8 animate-pulse" />
          </div>
          <div>
            <h4 className="text-base font-bold text-white">
              What medical question can I answer for you today?
            </h4>
            <p className="text-xs text-slate-400 max-w-md mt-1">
              Ask about symptoms, drug mechanisms, drug-drug compatibility, lab tests, blood pressure, or lifestyle management.
            </p>
          </div>

          <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-2 text-left pt-2">
            {SUGGESTED_QUERIES.slice(0, 4).map((query, qIdx) => (
              <button
                key={qIdx}
                type="button"
                onClick={() => void handleUserMessage(query)}
                className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800/80 hover:border-brand-500/40 text-xs text-slate-300 transition-all text-left group"
              >
                <span className="text-brand-400 font-bold block mb-0.5">💡 Example Question</span>
                <span className="group-hover:text-white">{query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversational Message Stream */}
      {transcript.length > 0 && (
        <div className="flex-1 overflow-y-auto my-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-4">
          {transcript.map((msg, idx) => {
            const isAlert = msg.text.includes('⚠️') || msg.text.toLowerCase().includes('emergency') || msg.text.toLowerCase().includes('allergy');
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start gap-3 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm mt-1 ${
                    isAlert ? 'bg-amber-600' : 'bg-rose-600'
                  }`}>
                    {isAlert ? <AlertTriangle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed group relative ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white rounded-br-none shadow-md'
                      : isAlert
                      ? 'bg-amber-950/40 border border-amber-500/40 text-amber-100 rounded-bl-none shadow-sm'
                      : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-bl-none shadow-sm'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.text}</div>

                  {msg.role === 'assistant' && !msg.isError && (
                    <>
                      {(() => {
                        const actions = getActionCards(msg.text);
                        if (actions.length === 0) return null;
                        return (
                          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap gap-2">
                            {actions.map((act, actIdx) => (
                              <button
                                key={actIdx}
                                type="button"
                                onClick={act.onClick}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all shadow-sm ${act.color}`}
                              >
                                <span>{act.label}</span>
                                <ArrowRight className="h-3 w-3 opacity-70" />
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {msg.isError && lastFailedText && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-[11px] text-rose-400 font-semibold">Response interrupted</span>
                      <button
                        type="button"
                        onClick={() => void handleUserMessage(lastFailedText)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {msg.role === 'assistant' && !msg.isError && (
                    <button
                      type="button"
                      onClick={() => handleCopyText(msg.text, idx)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
                      title="Copy Answer"
                    >
                      {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300 border border-slate-700 mt-1">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </motion.div>
            );
          })}

          {isResponding && (
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-600 text-white animate-pulse">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl bg-slate-900 border border-slate-800 px-4 py-2.5 text-xs text-slate-400 flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-rose-400 animate-ping" />
                Synthesizing medical pharmacology analysis...
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      )}

      {/* Quick Suggested Follow-up Pills & Actions */}
      {transcript.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          <button
            type="button"
            onClick={() => navigate(ROUTES.EMERGENCY)}
            className="whitespace-nowrap rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 text-[11px] font-bold text-rose-300 transition-all shrink-0"
          >
            🚨 Emergency SOS
          </button>
          <button
            type="button"
            onClick={() => navigate(ROUTES.REFILLS)}
            className="whitespace-nowrap rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-300 transition-all shrink-0"
          >
            🔄 Jan Aushadhi Refills
          </button>
          <button
            type="button"
            onClick={() => navigate(ROUTES.DOSE_LOGS)}
            className="whitespace-nowrap rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 text-[11px] font-bold text-indigo-300 transition-all shrink-0"
          >
            🛡️ Verify Strip
          </button>
          {SUGGESTED_QUERIES.map((queryText, sIdx) => (
            <button
              key={sIdx}
              type="button"
              onClick={() => void handleUserMessage(queryText)}
              className="whitespace-nowrap rounded-lg border border-slate-800 bg-slate-950/80 hover:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition-all shrink-0"
            >
              💡 {queryText}
            </button>
          ))}
        </div>
      )}

      {/* Freeform Query Input Bar */}
      <form onSubmit={handleTypedSubmit} className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
        <button
          type="button"
          onClick={handleToggleMic}
          className={`p-3 rounded-xl transition-all shadow-md ${
            isListening
              ? 'bg-rose-600 text-white animate-pulse shadow-rose-600/50'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
          }`}
          title={isListening ? 'Stop Listening' : 'Speak to Clinical AI'}
        >
          <Mic className="h-4 w-4" />
        </button>

        <input
          type="text"
          value={typedMessage}
          onChange={(e) => setTypedMessage(e.target.value)}
          placeholder={LANGUAGE_DATA[language].placeholder}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30"
        />

        <button
          type="submit"
          disabled={!typedMessage.trim() || isResponding}
          className="p-3 bg-gradient-to-r from-rose-600 to-red-600 hover:brightness-110 text-white rounded-xl disabled:opacity-40 transition-all shadow-md font-bold"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2 px-1">
        <span>{statusText}</span>
        <span className="hidden sm:inline">⚠️ Clinical AI guidance does not replace licensed in-person emergency care</span>
      </div>
    </div>
  );
};

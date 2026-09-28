import { http } from '@/lib/api-client';

export interface ChatMessage {
  role: 'assistant' | 'user';
  text: string;
}

export interface VoiceSession {
  id: string;
  userId: string;
  sessionDate: string;
  transcript: ChatMessage[];
  summary?: string;
  extractedVitals?: any;
  sentimentScore?: number;
  recoveryProgress?: number;
  createdAt: string;
}

export interface AiCompanionStatus {
  configured: boolean;
  configuredProviders: Array<'groq' | 'ollama'>;
  preferredProvider: 'groq' | 'ollama' | null;
  lastSuccessfulProvider: 'groq' | 'ollama' | null;
  activeModel: string;
  fallbackUsed: boolean;
}

export const voiceService = {
  getStatus: () => http.get<AiCompanionStatus>('/ai-voice/status'),

  startSession: () => http.post<VoiceSession>('/ai-voice/session', {}),

  respondToSession: (sessionId: string, message: string) =>
    http.post<VoiceSession, { message: string }>(
      `/ai-voice/session/${sessionId}/respond`,
      { message },
    ),

  completeSession: (sessionId: string) =>
    http.post<VoiceSession>(`/ai-voice/session/${sessionId}/complete`, {}),

  getLogs: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    return http.get<VoiceSession[]>(`/ai-voice/logs?${params.toString()}`);
  },
};

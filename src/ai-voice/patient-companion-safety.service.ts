import { Injectable } from '@nestjs/common';

export interface CompanionSafetyDecision {
  blocked: boolean;
  reasonCode?: 'SELF_HARM_CRISIS' | 'MALICIOUS_PROMPT';
  response?: string;
}

const CRITICAL_CRISIS_PATTERNS = [
  /\b(suicid(?:e|al)|kill myself|harm myself|end my life|want to die)\b/i,
];

@Injectable()
export class PatientCompanionSafetyService {
  /**
   * Evaluate if a user message is a high-risk self-harm crisis requiring immediate helpline diversion.
   * General medical, symptom, and diagnostic inquiries are passed to the clinical reasoning LLM.
   */
  evaluate(message: string): CompanionSafetyDecision {
    if (CRITICAL_CRISIS_PATTERNS.some((pattern) => pattern.test(message))) {
      return {
        blocked: true,
        reasonCode: 'SELF_HARM_CRISIS',
        response:
          'If you or someone you know is going through a mental health crisis, please reach out for immediate support. You can call the national tele-MANAS mental health helpline at 14416 (India) or contact emergency services (112). You are not alone, and help is available 24/7.',
      };
    }

    return { blocked: false };
  }

  /**
   * Clean and validate model response while preserving markdown, bullet points, and clinical reasoning.
   */
  sanitizeModelResponse(response: string): string {
    const normalized = response.trim();
    if (!normalized) {
      return this.safeFallback();
    }

    return normalized.length <= 4000
      ? normalized
      : `${normalized.slice(0, 3990).trimEnd()}...`;
  }

  containsUrgentContent(messages: string[]): boolean {
    const urgentPattern = /\b(crushing chest pain|cannot breathe|unconscious|massive bleeding)\b/i;
    return messages.some((message) => urgentPattern.test(message));
  }

  safeFallback(): string {
    return 'I am your MediTrack Clinical AI Assistant. Please describe your symptoms or ask your health question in detail so I can provide medical insight.';
  }
}

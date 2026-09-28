import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

type AiProviderName = 'groq' | 'ollama';
type ResponseMode = 'text' | 'json';

interface ProviderFailureState {
  failures: number;
  retryAfter: number;
}

const PROVIDER_FAILURE_THRESHOLD = 3;
const PROVIDER_COOLDOWN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

@Injectable()
export class CoreAIService implements OnModuleInit {
  private readonly logger = new Logger(CoreAIService.name);
  private readonly groqApiKey?: string;
  private readonly groqBaseUrl: string;
  private readonly groqModel: string;
  private readonly ollamaUrl?: string;
  private readonly configuredOllamaModel: string;
  private readonly providerOrder: AiProviderName[];
  private readonly requestTimeoutMs: number;
  private readonly failureState = new Map<
    AiProviderName,
    ProviderFailureState
  >();
  private activeOllamaModel: string;
  private lastSuccessfulProvider?: AiProviderName;
  private fallbackUsed = false;

  constructor(private readonly configService: ConfigService) {
    this.groqApiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    this.groqBaseUrl = this.normalizeGroqBaseUrl(
      this.configService.get<string>('GROQ_BASE_URL'),
    );
    this.groqModel =
      this.configService.get<string>('GROQ_MODEL')?.trim() || 'qwen/qwen3.8-27b';
    this.ollamaUrl = this.configService.get<string>('OLLAMA_URL')?.trim();
    this.configuredOllamaModel =
      this.configService.get<string>('OLLAMA_MODEL')?.trim() ||
      'mistral:7b-instruct';
    this.activeOllamaModel = this.configuredOllamaModel;
    this.requestTimeoutMs = this.parseTimeout(
      this.configService.get<string>('AI_REQUEST_TIMEOUT_MS'),
    );
    this.providerOrder = this.parseProviderOrder(
      this.configService.get<string>('AI_PROVIDER_ORDER'),
    );

    this.logger.log(
      `AI providers configured: ${this.configuredProviders().join(', ') || 'none'}; preferred: ${this.providerOrder[0]}`,
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.ollamaUrl || this.groqApiKey) return;

    try {
      const response = await axios.get(`${this.ollamaUrl}/api/tags`, {
        timeout: Math.min(this.requestTimeoutMs, 5_000),
      });
      const modelNames = Array.isArray(response.data?.models)
        ? response.data.models
            .map((model: unknown) => this.readStringProperty(model, 'name'))
            .filter((name): name is string => Boolean(name))
        : [];

      if (modelNames.includes(this.configuredOllamaModel)) {
        this.activeOllamaModel = this.configuredOllamaModel;
      } else if (modelNames.length > 0) {
        this.activeOllamaModel = modelNames[0];
        this.logger.warn(
          `Configured Ollama model is unavailable; using ${this.activeOllamaModel}.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Ollama discovery unavailable: ${this.safeErrorMessage(error)}`,
      );
    }
  }

  getModelMetadata() {
    const providers = this.configuredProviders();
    const preferredProvider = this.providerOrder.find((provider) =>
      providers.includes(provider),
    );
    const modelProvider = this.lastSuccessfulProvider ?? preferredProvider;

    return {
      configured: providers.length > 0,
      configuredProviders: providers,
      preferredProvider: preferredProvider ?? null,
      lastSuccessfulProvider: this.lastSuccessfulProvider ?? null,
      provider: modelProvider || 'none',
      activeModel:
        modelProvider === 'ollama' ? this.activeOllamaModel : this.groqModel,
      fallbackUsed: this.fallbackUsed,
    };
  }

  async generate(prompt: string, systemInstruction?: string): Promise<string> {
    return this.execute('text', prompt, systemInstruction);
  }

  async generateJSON<T>(
    prompt: string,
    systemInstruction?: string,
  ): Promise<T> {
    const response = await this.execute('json', prompt, systemInstruction);
    return this.parseJsonResponse<T>(response);
  }

  private async execute(
    mode: ResponseMode,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string> {
    const attempted: AiProviderName[] = [];
    let lastError: unknown;

    for (const provider of this.providerOrder) {
      if (!this.isConfigured(provider) || this.isCircuitOpen(provider))
        continue;
      attempted.push(provider);

      try {
        const response =
          provider === 'groq'
            ? await this.generateWithGroq(mode, prompt, systemInstruction)
            : await this.generateWithOllama(mode, prompt, systemInstruction);
        if (!response.trim())
          throw new Error('Provider returned an empty response.');

        this.recordSuccess(provider);
        this.lastSuccessfulProvider = provider;
        this.fallbackUsed = attempted.length > 1;
        return response.trim();
      } catch (error) {
        lastError = error;
        this.recordFailure(provider);
        this.logger.warn(
          `AI provider ${provider} failed: ${this.safeErrorMessage(error)}`,
        );
      }
    }

    const attemptedLabel = attempted.join(', ') || 'none';
    throw new Error(
      `No AI provider completed the request (attempted: ${attemptedLabel}). ${this.safeErrorMessage(lastError)}`,
    );
  }

  private async generateWithGroq(
    mode: ResponseMode,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string> {
    const messages = [
      ...(systemInstruction
        ? [{ role: 'system' as const, content: systemInstruction }]
        : []),
      { role: 'user' as const, content: prompt },
    ];

    const targetTokens = mode === 'json' ? 500 : 512;

    try {
      const response = await axios.post(
        `${this.groqBaseUrl}/chat/completions`,
        {
          model: this.groqModel,
          messages,
          temperature: mode === 'json' ? 0 : 0.2,
          max_tokens: targetTokens,
          ...(mode === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        },
        {
          timeout: this.requestTimeoutMs,
          headers: {
            Authorization: `Bearer ${this.groqApiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return String(response.data?.choices?.[0]?.message?.content ?? '');
    } catch (error: any) {
      const isModelSpecificError =
        error?.response?.data?.error?.code === 'model_not_found' ||
        error?.response?.data?.error?.type === 'invalid_request_error' ||
        error?.response?.data?.error?.code === 'rate_limit_exceeded' ||
        error?.response?.status === 429;

      if (isModelSpecificError) {
        const candidateModels = [
          'openai/gpt-oss-120b',
          'qwen/qwen3.6-27b',
          'openai/gpt-oss-20b',
          'qwen/qwen3.8-27b',
        ].filter((m) => m !== this.groqModel);

        for (const candidate of candidateModels) {
          try {
            const res = await axios.post(
              `${this.groqBaseUrl}/chat/completions`,
              {
                model: candidate,
                messages,
                temperature: mode === 'json' ? 0 : 0.2,
                max_tokens: 450,
                ...(mode === 'json'
                  ? { response_format: { type: 'json_object' } }
                  : {}),
              },
              {
                timeout: this.requestTimeoutMs,
                headers: {
                  Authorization: `Bearer ${this.groqApiKey}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            const content = res.data?.choices?.[0]?.message?.content;
            if (content) {
              return String(content);
            }
          } catch {
            // try next candidate
          }
        }
      }
      throw error;
    }
  }

  private async generateWithOllama(
    mode: ResponseMode,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string> {
    const response = await axios.post(
      `${this.ollamaUrl}/api/generate`,
      {
        model: this.activeOllamaModel,
        prompt,
        system: systemInstruction,
        stream: false,
        ...(mode === 'json' ? { format: 'json' } : {}),
        options: { temperature: mode === 'json' ? 0 : 0.2 },
      },
      { timeout: this.requestTimeoutMs },
    );
    return String(response.data?.response ?? '');
  }

  private configuredProviders(): AiProviderName[] {
    return this.providerOrder.filter((provider) => this.isConfigured(provider));
  }

  private isConfigured(provider: AiProviderName): boolean {
    return provider === 'groq'
      ? Boolean(this.groqApiKey)
      : Boolean(this.ollamaUrl);
  }

  private isCircuitOpen(provider: AiProviderName): boolean {
    const state = this.failureState.get(provider);
    return Boolean(state && state.retryAfter > Date.now());
  }

  private recordSuccess(provider: AiProviderName): void {
    this.failureState.delete(provider);
  }

  private recordFailure(provider: AiProviderName): void {
    const current = this.failureState.get(provider) ?? {
      failures: 0,
      retryAfter: 0,
    };
    const failures = current.failures + 1;
    this.failureState.set(provider, {
      failures,
      retryAfter:
        failures >= PROVIDER_FAILURE_THRESHOLD
          ? Date.now() + PROVIDER_COOLDOWN_MS
          : 0,
    });
  }

  private parseProviderOrder(raw?: string): AiProviderName[] {
    const requested = (raw || 'groq,ollama')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(
        (value): value is AiProviderName =>
          value === 'groq' || value === 'ollama',
      );
    return requested.length > 0 ? [...new Set(requested)] : ['groq', 'ollama'];
  }

  private parseTimeout(raw?: string): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 2_000 && parsed <= 60_000
      ? parsed
      : DEFAULT_TIMEOUT_MS;
  }

  private normalizeGroqBaseUrl(raw?: string): string {
    const configured = raw?.trim() || 'https://api.groq.com/openai/v1';
    const withoutTrailingSlash = configured.replace(/\/$/, '');

    try {
      const parsed = new URL(withoutTrailingSlash);
      if (parsed.pathname === '' || parsed.pathname === '/') {
        parsed.pathname = '/openai/v1';
        return parsed.toString().replace(/\/$/, '');
      }
    } catch {
      return withoutTrailingSlash;
    }

    return withoutTrailingSlash;
  }

  private parseJsonResponse<T>(response: string): T {
    const withoutFence = response
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    const candidate =
      start >= 0 && end > start
        ? withoutFence.slice(start, end + 1)
        : withoutFence;
    return JSON.parse(candidate) as T;
  }

  private safeErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      return status
        ? `request failed with status ${status}`
        : error.code || 'network request failed';
    }
    return error instanceof Error ? error.message : 'unknown provider error';
  }

  private readStringProperty(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const property = (value as Record<string, unknown>)[key];
    return typeof property === 'string' ? property : undefined;
  }
}

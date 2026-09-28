import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { CoreAIService } from './core-ai.service';

describe('CoreAIService provider routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Groq first when a Groq key is configured', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Groq response' } }] },
    });
    const service = createService({
      GROQ_API_KEY: 'test-key',
      GROQ_MODEL: 'qwen/qwen3-32b',
      OLLAMA_URL: 'http://localhost:11434',
    });

    await expect(service.generate('hello', 'be concise')).resolves.toBe(
      'Groq response',
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
    expect(service.getModelMetadata()).toMatchObject({
      preferredProvider: 'groq',
      lastSuccessfulProvider: 'groq',
      fallbackUsed: false,
    });
  });

  it('normalizes a Groq origin to the OpenAI-compatible API path', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Groq response' } }] },
    });
    const service = createService({
      GROQ_API_KEY: 'test-key',
      GROQ_BASE_URL: 'https://api.groq.com',
    });

    await expect(service.generate('hello')).resolves.toBe('Groq response');
    expect(post.mock.calls[0][0]).toBe(
      'https://api.groq.com/openai/v1/chat/completions',
    );
  });

  it('falls back to Ollama without exposing provider details to callers', async () => {
    const post = jest
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(new Error('Groq unavailable'))
      .mockResolvedValueOnce({ data: { response: 'Local fallback' } });
    const service = createService({
      GROQ_API_KEY: 'test-key',
      OLLAMA_URL: 'http://localhost:11434',
    });

    await expect(service.generate('hello')).resolves.toBe('Local fallback');
    expect(post).toHaveBeenCalledTimes(2);
    expect(service.getModelMetadata()).toMatchObject({
      lastSuccessfulProvider: 'ollama',
      fallbackUsed: true,
    });
  });

  it('requests and parses structured JSON from Groq', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: 'result: {"summary":"recorded"}' } }],
      },
    });
    const service = createService({ GROQ_API_KEY: 'test-key' });

    await expect(
      service.generateJSON<{ summary: string }>('extract'),
    ).resolves.toEqual({ summary: 'recorded' });
  });

  it('fails closed when no provider is configured', async () => {
    const service = createService({});

    await expect(service.generate('hello')).rejects.toThrow(
      'No AI provider completed the request',
    );
  });
});

function createService(values: Record<string, string>): CoreAIService {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new CoreAIService(config);
}

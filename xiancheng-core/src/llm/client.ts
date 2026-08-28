// ============================================================
// 清河县 · LLM 客户端（OpenAI 兼容协议）
// Phase 5：LLM 决策管道
// ============================================================

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 项目根目录（src/llm/ → 项目根）
dotenv.config({ path: resolve(__dirname, '../..', '.env') });

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;  // 结构化输出
}

export class LLMClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.SIMULATION_BASE_URL ?? process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
    this.apiKey = process.env.SIMULATION_API_KEY ?? process.env.LLM_API_KEY ?? '';
    this.model = process.env.SIMULATION_MODEL ?? process.env.LLM_MODEL ?? 'deepseek-chat';
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async chat(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 512,
    };

    // 结构化输出：使用 response_format 强制 JSON
    if (options.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          schema: options.jsonSchema,
        },
      };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM API error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}

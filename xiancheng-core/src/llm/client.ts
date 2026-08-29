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

    // 默认关闭推理模式（DeepSeek-V4-Flash 非思考模式，更快更省）
    // 可用 SIMULATION_NO_THINKING=false 重新开启思考
    const noThinking = (process.env.SIMULATION_NO_THINKING ?? 'true') !== 'false';
    if (noThinking) {
      body.chat_template_kwargs = { thinking: false };
      body.thinking = { type: 'disabled' };
    }

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

    // 限流重试：遇到 quota/429 等错误，等待后重试（指数退避），最多 4 次
    const MAX_RETRIES = 4;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (res.status === 200) {
          const data = await res.json();
          return data.choices?.[0]?.message?.content ?? '';
        }

        const err = await res.text();
        const isRateLimit =
          res.status === 429 ||
          err.includes('quota') ||
          err.includes('balance') ||
          err.includes('insufficient') ||
          err.includes('rate limit') ||
          err.includes('too many');

        if (isRateLimit && attempt < MAX_RETRIES) {
          const waitMs = 3000 * Math.pow(2, attempt);  // 3s, 6s, 12s, 24s
          console.warn(`  [限流] LLM 请求被拒(${res.status})，等待 ${waitMs / 1000}s 重试 (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        throw new Error(`LLM API error ${res.status}: ${err.slice(0, 300)}`);
      } catch (e) {
        // 网络类错误也重试
        if (attempt < MAX_RETRIES && !(e instanceof Error && e.message.startsWith('LLM API error'))) {
          const waitMs = 3000 * Math.pow(2, attempt);
          console.warn(`  [网络] LLM 请求失败，等待 ${waitMs / 1000}s 重试 (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw e;
      }
    }
    throw new Error('LLM 请求重试次数耗尽');
  }
}

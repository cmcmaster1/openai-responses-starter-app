// lib/openai.ts
import OpenAI from "openai";

// Architecture: We use responses.js as a translation layer that converts Responses API → Chat Completions
// This gives us Harmony compliance + working streaming
// responses.js should be running separately and configured to proxy to vLLM

// Use RESPONSES_JS_URL if set (responses.js server), otherwise fall back to direct vLLM
// responses.js runs on http://localhost:3000 by default
const responsesJsUrl = process.env.RESPONSES_JS_URL || "http://localhost:3000/v1";
const vllmBaseUrl = process.env.VLLM_BASE_URL || "https://huge-bertha.hydra-theropod.ts.net:8443/v1";

// Use RESPONSES_JS_URL if set, otherwise use vLLM directly
// When using responses.js, it will handle the translation to Chat Completions
// Note: If RESPONSES_JS_URL is set but responses.js isn't running, the app will fall back gracefully
const baseURL = process.env.RESPONSES_JS_URL ? responsesJsUrl : vllmBaseUrl;

// API key: responses.js uses the same key format, or we can pass vLLM key through
const apiKey = process.env.VLLM_API_KEY || process.env.OPENAI_API_KEY || "EzjMVojsaYryCWAc";

// Log configuration (without exposing full key)
console.log('[OpenAI Client] Initializing...');
console.log('[OpenAI Client] BaseURL:', baseURL);
console.log('[OpenAI Client] Using responses.js:', !!process.env.RESPONSES_JS_URL);
if (process.env.RESPONSES_JS_URL) {
  console.log('[OpenAI Client] responses.js URL:', responsesJsUrl);
  console.log('[OpenAI Client] vLLM backend:', vllmBaseUrl);
}
console.log('[OpenAI Client] API Key source:', process.env.VLLM_API_KEY ? 'VLLM_API_KEY' : process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY (system)' : 'default');
console.log('[OpenAI Client] API Key set:', apiKey ? `${apiKey.substring(0, 4)}...` : 'NOT SET');

export const client = new OpenAI({
  apiKey: apiKey,
  baseURL: baseURL,
  // Ensure custom headers are sent if needed
  defaultHeaders: {
    'User-Agent': 'openai-responses-starter-app',
  },
});

export const MODEL = process.env.MODEL_ID || "gpt-oss-120b";


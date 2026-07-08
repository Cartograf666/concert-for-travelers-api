import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';

function getEnvVarNameForKey(key: string): string {
  if (process.env.GEMINI_API_KEY?.trim() === key) return 'GEMINI_API_KEY';
  for (let i = 1; i <= 10; i++) {
    if (i >= 2 && process.env[`GEMINI_API_KEY_${i}`]?.trim() === key) return `GEMINI_API_KEY_${i}`;
    if (process.env[`GEMINI_API_KEY_RESERV${i}`]?.trim() === key) return `GEMINI_API_KEY_RESERV${i}`;
  }
  if (process.env.GEMINI_API_KEYS?.includes(key)) return 'GEMINI_API_KEYS';
  return 'unknown';
}

async function main() {
  await loadDotEnvFallback();
  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) {
    console.error('Error: no Gemini API key set (GEMINI_API_KEY[/_2/_3/_RESERV1..]) and none could be loaded from .env.');
    process.exit(1);
  }

  for (let idx = 0; idx < apiKeys.length; idx++) {
    const apiKey = apiKeys[idx];
    const envVar = getEnvVarNameForKey(apiKey);
    console.log(`\n--- Key ${idx + 1} (env: ${envVar}) ---`);
    console.log('Fetching available models list via REST API...');
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data: any = await res.json();
      if (data.models) {
        console.log('Available models:');
        for (const m of data.models) {
          console.log(`  - ${m.name} (Supported actions: ${m.supportedGenerationMethods.join(', ')})`);
        }
      } else {
        console.log('No models returned. API response:', JSON.stringify(data, null, 2));
      }
    } catch (err: any) {
      console.error('Failed to fetch models:', err.message);
    }
  }
}

void main().catch(console.error);

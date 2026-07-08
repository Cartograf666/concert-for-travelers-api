import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';

async function main() {
  await loadDotEnvFallback();
  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) {
    console.error('Error: no Gemini API key set (GEMINI_API_KEY[/_2/_3/_RESERV1..]) and none could be loaded from .env.');
    process.exit(1);
  }
  const apiKey = apiKeys[0];

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

main().catch(console.error);

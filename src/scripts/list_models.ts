import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not set');
    process.exit(1);
  }

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

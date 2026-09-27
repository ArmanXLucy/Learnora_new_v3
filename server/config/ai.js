import Groq from 'groq-sdk';

let client = null;
export function getGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured. Add it to .env.');
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}
export function getAIModel() { return process.env.AI_MODEL || 'qwen/qwen3.8-27b'; }

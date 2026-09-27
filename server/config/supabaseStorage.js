import { Readable } from 'node:stream';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured. Add it to .env.`);
  return value;
}

function config() {
  const url = required('SUPABASE_URL').replace(/\/$/, '');
  // Prefer the newer secret key name. Keep service_role as a fallback for
  // existing projects during the 2026 key transition.
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not configured. Add it to .env.');
  const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || 'learnora-files').trim();
  if (!bucket) throw new Error('SUPABASE_STORAGE_BUCKET is not configured. Add it to .env.');
  return { url, key, bucket };
}

function objectUrl(bucket, key) {
  return `${config().url}/storage/v1/object/${encodeURIComponent(bucket)}/${key
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')}`;
}

function headers(contentType) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

export async function putObject(key, body, contentType = 'application/octet-stream') {
  const response = await fetch(objectUrl(config().bucket, key), {
    method: 'POST',
    headers: {
      ...headers(contentType),
      'x-upsert': 'false',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase Storage upload failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return key;
}

export async function getObject(key) {
  const response = await fetch(objectUrl(config().bucket, key), {
    method: 'GET',
    headers: headers(),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase Storage download failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  return {
    body: response.body ? Readable.fromWeb(response.body) : null,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentLength: response.headers.get('content-length') || null,
    etag: response.headers.get('etag') || null,
  };
}

export async function createSignedUrl(key, expiresIn = 3600) {
  const { url, key: secret, bucket } = config();
  const path = String(key || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  const response = await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path}`, {
    method: 'POST',
    headers: headers('application/json'),
    body: JSON.stringify({ expiresIn: Math.max(60, Math.min(Number(expiresIn) || 3600, 86400)) })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase Storage signed URL failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  if (!data?.signedURL) throw new Error('Supabase Storage did not return a signed URL.');
  return data.signedURL.startsWith('http') ? data.signedURL : `${url}${data.signedURL}`;
}

export function isSupabaseStorageConfigured() {
  return Boolean(
    String(process.env.SUPABASE_URL || '').trim() &&
    String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() &&
    String(process.env.SUPABASE_STORAGE_BUCKET || '').trim()
  );
}

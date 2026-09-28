import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const webRoot = resolve(process.cwd());
const verifyAndroidAssets = process.argv.includes('--android-assets');
const bundleRoot = resolve(
  webRoot,
  verifyAndroidAssets ? 'android/app/src/main/assets/public' : 'dist',
);

function readAndroidApiUrl() {
  if (process.env.VITE_API_URL?.trim()) {
    return process.env.VITE_API_URL.trim();
  }

  const envPath = resolve(webRoot, '.env.android');
  if (!existsSync(envPath)) {
    throw new Error(
      'VITE_API_URL is missing. Copy .env.android.example to .env.android before building Android.',
    );
  }

  const line = readFileSync(envPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('VITE_API_URL='));

  return line?.slice(line.indexOf('=') + 1).trim();
}

function collectBundleText(directory) {
  if (!existsSync(directory)) {
    throw new Error(`Android web bundle not found: ${directory}`);
  }

  return readdirSync(directory).reduce((content, name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return content + collectBundleText(path);
    if (!/\.(?:js|html)$/i.test(name)) return content;
    return content + readFileSync(path, 'utf8');
  }, '');
}

const apiUrl = readAndroidApiUrl();
if (!apiUrl) throw new Error('VITE_API_URL is empty for the Android build.');

const parsed = new URL(apiUrl);
const hostname = parsed.hostname.toLowerCase();
const isPrivateHost =
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '10.0.2.2' ||
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);

if (parsed.protocol !== 'https:') {
  throw new Error(`Android API URL must use HTTPS. Received: ${apiUrl}`);
}
if (isPrivateHost) {
  throw new Error(
    `Android API URL must not use localhost or a private development host: ${apiUrl}`,
  );
}
if (!parsed.pathname.replace(/\/$/, '').endsWith('/api')) {
  throw new Error(
    `Android API URL must include the /api path. Received: ${apiUrl}`,
  );
}

const bundleText = collectBundleText(bundleRoot);
if (!bundleText.includes(apiUrl)) {
  throw new Error(
    `Android bundle does not contain the configured API URL (${apiUrl}). Rebuild and run Capacitor sync.`,
  );
}

const forbiddenApiUrl =
  /https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?\/api/gi;
const forbiddenMatches = [...new Set(bundleText.match(forbiddenApiUrl) ?? [])];
if (forbiddenMatches.length > 0) {
  throw new Error(
    `Android bundle contains forbidden local API URL(s): ${forbiddenMatches.join(', ')}`,
  );
}

console.log(
  `Android API bundle verified (${verifyAndroidAssets ? 'Capacitor assets' : 'Vite dist'}): ${apiUrl}`,
);

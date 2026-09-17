// npx tsx scripts/vapid-keys.ts — generate a VAPID key pair for Web Push.
// Public key → wrangler.jsonc vars.VAPID_PUBLIC_KEY; private key → secret VAPID_PRIVATE_KEY.

export {};

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const pub = await crypto.subtle.exportKey('raw', pair.publicKey);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('\nPut VAPID_PUBLIC_KEY and VAPID_SUBJECT in wrangler.jsonc vars (public), set BROWSER_ALERTS_ENABLED to "true",');
console.log('and store VAPID_PRIVATE_KEY in .dev.vars (local) and `npx wrangler secret put VAPID_PRIVATE_KEY` (production).');

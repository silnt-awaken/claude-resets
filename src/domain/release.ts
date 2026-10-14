import { z } from 'zod';
import releaseJson from '../../content/release.json';

export const releaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
  title: z.string().min(1).max(120),
  changes: z.array(z.string().min(1).max(300)).min(1).max(8),
  announce: z.boolean(),
});
export const release = releaseSchema.parse(releaseJson);

export function releaseMessage(siteUrl: string): string {
  return `${release.title}\n\n${release.changes.map((change) => `• ${change}`).join('\n')}\n\n${siteUrl}/`;
}

/** Accept only our account's post links. Canonical IDs make repeats and tracking parameters harmless. */
export function ownTweetUrl(input: string): { id: string; url: string } | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/clauderesets\/status\/(\d{15,20})\/?$/i);
    return match ? { id: match[1]!, url: `https://x.com/clauderesets/status/${match[1]}` } : null;
  } catch { return null; }
}

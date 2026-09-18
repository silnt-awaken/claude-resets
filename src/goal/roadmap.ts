// Public roadmap, rendered on /goal#roadmap and mirrored in docs/roadmap.md. Statuses are honest:
// "done" means live today, "now" means built and being switched on, "next" means planned but not
// started, "later" is direction rather than commitment. No dates we cannot keep.

export type PhaseStatus = 'done' | 'now' | 'next' | 'later';

export interface RoadmapPhase {
  id: string;
  title: string;
  when: string;
  status: PhaseStatus;
  items: string[];
}

export const ROADMAP: RoadmapPhase[] = [
  {
    id: 'tracker',
    title: 'The tracker',
    when: 'September 2026',
    status: 'done',
    items: [
      'clauderesets.com live: every publicly announced Claude usage-limit reset, verified against the original post.',
      'Sources directory, calendar and countdown, five languages, JSON API, RSS/JSON feeds, MCP server.',
      'Open source under MIT; every event carries its source link and revision history.',
    ],
  },
  {
    id: 'goal',
    title: 'Community goal',
    when: 'September 2026',
    status: 'now',
    items: [
      'Readers pool USDC on Solana; one wallet is one entry, whatever the amount.',
      'Contribute with Phantom in one tap, or send USDC to the published address from any wallet.',
      'When the pool reaches the target the winner is drawn automatically by a finalized Solana block hash; the contributor list and the hash are public.',
      'The winner is paid one month of Claude Max 20x in USDC, and the next round opens by itself.',
    ],
  },
  {
    id: 'alerts',
    title: 'Faster pings',
    when: 'Q4 2026',
    status: 'next',
    items: [
      'Browser push and Telegram alerts the moment a reset is published.',
      'More watched accounts and a public review log for every source check.',
    ],
  },
  {
    id: 'growth',
    title: 'Growth',
    when: '2027',
    status: 'later',
    items: [
      'Community-proposed goals beyond Max 20x (API credits, Team seats) chosen by contributors.',
      'Sponsor slots to cover hosting, so the tracker stays free.',
      'The tracker stays independent and ad-free; no forecasts, no account access, ever.',
    ],
  },
];

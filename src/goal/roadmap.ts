// Public roadmap for the community goal and RESET. Rendered on /goal#roadmap and mirrored in
// docs/roadmap.md. Statuses are honest: "done" means live today, "now" means built and being
// switched on, "next" means planned but not started. No dates we cannot keep.

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
    id: 'goal-infra',
    title: 'Goal and token infrastructure',
    when: 'September 2026',
    status: 'now',
    items: [
      'Community goal on Robinhood Chain: contribute USDG, one contribution equals one entry, winner picked by a public block hash.',
      'Wallet connect and a one-tap contribution sheet; contributor counts read straight from the chain.',
      'RESET contract: fixed supply, 1% fee split 60% burn / 40% goal pool, reserve burns wired to reset announcements.',
      'Automatic burns: publishing a confirmed reset triggers the on-chain burn within two minutes, with a public log.',
    ],
  },
  {
    id: 'launch',
    title: 'Launch',
    when: 'Q4 2026',
    status: 'next',
    items: [
      'Deploy RESET, verify the source on Blockscout, set the burner wallet, fund the burn reserve.',
      'Seed RESET/USDG liquidity and burn the LP tokens; publish the allocation with wallet links.',
      'Renounce ownership once fees, exemptions and burn sizes are final.',
      'Open round one: $200 USDG, one month of Claude Max 20x for one contributor.',
    ],
  },
  {
    id: 'first-rounds',
    title: 'First rounds',
    when: 'Q4 2026',
    status: 'next',
    items: [
      'First winner paid, with the draw block, hash and index published for anyone to recompute.',
      'First automatic burn on a real reset announcement.',
      'Contributor rewards: RESET from the 25% allocation distributed to each round\'s contributors, pro-rata to what they gave.',
      'One round per month while the pool keeps filling.',
    ],
  },
  {
    id: 'growth',
    title: 'Growth',
    when: '2027',
    status: 'later',
    items: [
      'Browser push and Telegram alerts the moment a reset is published.',
      'Holder perks that cost nothing to run: contributor wall, early alerts, higher API limits.',
      'Community-proposed goals beyond Max 20x (API credits, Team seats) chosen by contributors.',
      'Sponsor slots to cover hosting and the burner wallet\'s gas.',
    ],
  },
  {
    id: 'long-term',
    title: 'Long term',
    when: '2027 and beyond',
    status: 'later',
    items: [
      'Treasury vesting completes over 12 months; the schedule and wallet are public from day one.',
      'Pool wallet moves to a multisig; RESET holders signal the next goal target.',
      'The tracker stays free, independent and ad-free regardless of what the token does.',
    ],
  },
];

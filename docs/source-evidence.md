# Source evidence

Every published seed, how it was verified, and what remains unresolved. Content lives in `content/resets.json`; this file explains where it came from.

## Verification method

Direct X page retrieval is unreliable without a login, so two public mechanisms were used on 2026-09-17:

1. **X oEmbed** (`https://publish.x.com/oembed?url=<post url>`): returns the post text and the author's display name and handle for any public post. This established wording, authorship and the calendar date shown by X.
2. **Post-id decoding**: X status ids are Snowflake ids; `(id >> 22) + 1288834974657` is the creation time in milliseconds UTC. This gives an exact UTC timestamp for every post, which is why every seed has `time.precision = exact`. The `content:new` command applies the same decoding automatically.

Affiliation evidence was checked by fetching the linked public pages (GitHub profiles, anthropic.com, claude.com footer links). The Anthropic-hosted biography PDF for Alex Albert and the LinkedIn profile for Boris Cherny were supplied by project research and were not re-parsed in this session.

## Published seeds (12 confirmed discretionary resets)

| Event id | Announced (UTC, from post id) | Source post | Supported scope | Notes |
| --- | --- | --- | --- | --- |
| `2026-09-04-max-weekly` | 2026-09-04 20:08:45 | [@lydiahallie](https://x.com/lydiahallie/status/2095967323412930677) | Max plans; weekly limit | Post does not mention 5-hour limits or other plans. |
| `2026-09-01-all-users` | 2026-09-01 18:35:27 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2094856679250919746) | all users; 5-hour + weekly | Tied to the Fable 5.1 release. |
| `2026-07-16-all-users` | 2026-07-16 03:58:48 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2077603834453770467) | all users; 5-hour + weekly | Resolves the July 15/16 question: UTC day is July 16 (July 15 evening in US zones). |
| `2026-07-09-all-users` | 2026-07-09 18:01:18 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2075279141352706215) | all users; 5-hour + weekly | |
| `2026-07-01-everyone` | 2026-07-01 21:16:35 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2072429181565288665) | everyone; 5-hour + weekly | "Now that Fable 5 is ready to build (again)". |
| `2026-06-20-everyone-all-plans` | 2026-06-20 00:05:06 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2068122937308426676) | everyone, all plans; 5-hour + weekly | Follow-up broadening the June 19 targeted reset. |
| `2026-06-19-affected-users` | 2026-06-19 02:50:28 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2067802163498352929) | affected users (~3% of Claude Code Max and Pro users); 5-hour + weekly | Limited scope; counted as a reset, marked limited. |
| `2026-06-13-all-users` | 2026-06-13 02:24:00 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2065621176735646006) | all users; 5-hour + weekly | |
| `2026-06-09-all-users` | 2026-06-09 21:48:01 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2064464557951852643) (original), [@alexalbert__](https://x.com/alexalbert__/status/2064467657483829441) (relay, 22:00:20) | all users; 5-hour + weekly | Two posts, one event. The relay names neither windows nor plans; the original does. |
| `2026-06-01-pro-max` | 2026-06-01 17:35:01 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2061501787769893055) | Pro and Max; 5-hour + weekly | After a Claude Code subagent bug. |
| `2026-05-15-everyone` | 2026-05-15 18:00:14 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2055347539923308703) | everyone; 5-hour + weekly | |
| `2026-04-23-all-subscribers` | 2026-04-23 17:44:48 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2047371123185287223) (original), [@bcherny](https://x.com/bcherny/status/2047375800945783056) (relay, 18:03:24) | all subscribers; windows not stated | Reached by resolving the t.co link in Boris Cherny's post. His own text does not mention the reset; it is recorded as a relay. |

## Published non-reset announcement (not counted)

| Event id | Announced (UTC) | Source | Kind | Notes |
| --- | --- | --- | --- | --- |
| `2026-08-29-weekly-limit-policy-change` | 2026-08-29 16:47:23 | [@ClaudeDevs](https://x.com/ClaudeDevs/status/2093742321473065266) | policy change | Permanent 25% weekly-limit increase in Claude Code from September 14 for Pro, Max, Team, seat-based Enterprise. Shown under "Other limit announcements"; never counted. The temporary 50% increase it mentions was not traced to a primary post. |

## Source directory (7 accounts)

| Handle | Label | Affiliation evidence | Reset evidence |
| --- | --- | --- | --- |
| @ClaudeDevs | Official account, primary | [Introduced by @claudeai on 2026-04-16](https://x.com/claudeai/status/2044779666477646187) (oEmbed) | Most seeds above |
| @lydiahallie | Team member, primary | GitHub profile links the X account; her own post says "we've just reset" | Sep 4 event |
| @alexalbert__ | Team member, additional | Anthropic-hosted biography (supplied; 2025 wording not assumed current) | Jun 9 relay |
| @bcherny | Announcement relay, additional | LinkedIn profile (supplied) | Apr 23 relay |
| @claudeai | Official account, context | claude.com footer links it | none |
| @AnthropicAI | Official account, context | anthropic.com footer links it | none |
| @amorriscode | Team member, optional | GitHub profile mentions Anthropic and links the X account | none |

Handles resolved through oEmbed author data: `ClaudeDevs`, `Lydia Hallie ✨`, `Alex Albert`, `Boris Cherny`, `Claude (@claudeai)`. `@AnthropicAI` and `@amorriscode` were resolved through the linking pages above only.

## Research queue

Recorded in `content/research-queue.json` and shown nowhere public:

- **Coverage start**: April 16, 2026 (the day @ClaudeDevs joined X). Earlier resets, or resets only announced elsewhere, are outside documented coverage.
- **Newer than September 4**: a web search on 2026-09-17 surfaced no newer reset from the tracked accounts. X search is manual; recheck before each publish.
- **Resolved**: the April 23 lead (now an event with a relay) and the July 15/16 date question (UTC July 16).

## What was deliberately not done

- No count or dates were copied from any other tracker.
- No timestamps were invented: every seed's time comes from its post id.
- Posts were not bulk-copied; each event stores a one-sentence verbatim excerpt, labelled as a quote.

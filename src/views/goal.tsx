import type { FC } from 'hono/jsx';
import { formatUnits } from '../goal/chain';
import type { GoalStatus } from '../routes/goal';
import { formatNumber, interpolate, localizePath } from '../i18n';
import { ArrowIcon } from './icons';
import { Layout, type PageContext } from './layout';

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Compact goal card for the tracker homepage. Honest states: preparing / open / frozen / drawn / paid. */
export const GoalCard: FC<{ ctx: PageContext; status: GoalStatus }> = ({ ctx, status }) => {
  const { t, locale } = ctx;
  const raised = status.pool.usdc ?? 0;
  const pct = Math.round(status.progress * 100);
  const round = status.round;
  const stateLine = !status.enabled
    ? t.goal.preparing
    : round?.status === 'frozen'
      ? interpolate(t.goal.frozen, { block: round.draw_block ?? '' })
      : round?.status === 'drawn'
        ? interpolate(t.goal.drawn, { winner: round.winner ?? '' })
        : round?.status === 'paid'
          ? interpolate(t.goal.paid, { winner: round.winner ?? '' })
          : null;
  const open = status.enabled && round?.status === 'open' && !!status.pool.address;
  return (
    <section class="section" aria-labelledby="goal-heading">
      <div class="card card--sun goal-card" data-role="goal-card">
        <div class="goal-head">
          <div>
            <span class="mono">{t.goal.sub}</span>
            <h2 id="goal-heading">{t.goal.heading}</h2>
          </div>
          <span class="chip chip--accent">USDC · {t.goal.token}</span>
        </div>
        <p class="goal-pitch">{t.goal.pitch}</p>
        <div class="goal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={status.target_usd} aria-valuenow={Math.round(raised)} aria-label={interpolate(t.goal.raised, { raised: formatNumber(Math.round(raised), locale), target: formatNumber(status.target_usd, locale) })}>
          <span class="goal-meter-fill" style={`width:${pct}%`}></span>
        </div>
        <div class="goal-figures">
          <strong class="goal-raised" data-role="goal-raised">{interpolate(t.goal.raised, { raised: formatNumber(Math.round(raised), locale), target: formatNumber(status.target_usd, locale) })}</strong>
          {status.enabled && round ? <span class="mono">{interpolate(t.goal.entries, { n: formatNumber(round.contributors, locale) })}</span> : null}
        </div>
        {status.pool.stale ? <p class="status-line">{t.goal.stale}</p> : null}
        {stateLine ? <p class="notice notice--warn goal-state">{stateLine}</p> : null}
        {open ? (
          <div class="goal-entry" data-role="goal-contribute">
            <span class="mono">{t.goal.enter}</span>
            <code class="goal-address" data-role="pool-address">
              {status.pool.address}
            </code>
            <button class="btn btn--accent" type="button" data-role="copy-pool" data-copy={status.pool.address ?? ''} data-copied="✓">
              <span data-role="copy-label">{t.goal.contribute}</span>
            </button>
            <p class="status-line">{t.goal.enterPlaceholder}</p>
          </div>
        ) : null}
        <div class="goal-links">
          {open ? (
            <a class="btn btn--sun" href={`${status.chain.explorer}/address/${status.pool.address}`} target="_blank" rel="noopener noreferrer">
              Blockscout <ArrowIcon />
            </a>
          ) : null}
          <a class="btn" href={localizePath(locale, '/goal')}>
            {t.goal.learn} <ArrowIcon />
          </a>
        </div>
      </div>
    </section>
  );
};

/** Full page: mechanics, tokenomics, burn schedule, rules, verification. English, like the technical docs. */
export const GoalPage: FC<{ ctx: PageContext; status: GoalStatus }> = ({ ctx, status }) => {
  const { cfg, t, locale } = ctx;
  const g = cfg.goal;
  const explorer = status.chain.explorer;
  const token = status.token;
  const supplyPct = (n: string) => (token ? `${(Number((BigInt(n) * 10000n) / 1_000_000_000_000_000_000_000_000_000n) / 100).toFixed(2)}%` : '');
  return (
    <Layout ctx={ctx} title={`Max 20x for a reader | ${cfg.siteName}`} description="A community-funded goal: readers pool USDC on Robinhood Chain and one contributor wins a month of Claude Max 20x by a verifiable block-hash draw. RESET token with on-chain burns.">
      <h1 class="page-title">Max 20x for a reader</h1>
      <p class="page-intro">{t.goal.pitch}</p>
      {locale !== 'en' ? (
        <p class="notice" style="margin-top:12px">
          {t.docs.englishOnly} <a href={localizePath(locale, '/')}>{t.docs.backTo}</a>
        </p>
      ) : null}

      <GoalCard ctx={ctx} status={status} />

      <section class="section prose" id="how">
        <h2>How a round works</h2>
        <ol>
          <li>
            <strong>Pool.</strong> A public wallet on Robinhood Chain (chain id {status.chain.id}) receives USDC. The meter above is the wallet's live balance read from the chain, not a number we typed.
            {status.pool.address ? (
              <>
                {' '}Pool: <a href={`${explorer}/address/${status.pool.address}`} target="_blank" rel="noopener noreferrer"><code>{status.pool.address}</code></a>.
              </>
            ) : null}
          </li>
          <li>
            <strong>Contribute to enter.</strong> Send at least {status.min_contribution_usd} USDC to the pool from your own wallet during the round. Your wallet is your entry. Amount does not matter for the draw: a 1 USDC contributor and a 100 USDC contributor have exactly the same chance. One entry per wallet; sending twice does not add a second entry.
          </li>
          <li>
            <strong>Freeze.</strong> When the pool reaches ${g.targetUsd} USDC, the round closes at a recorded block. The contributor list is snapshotted from the chain's transfer log for that block range and published, and a future <em>draw block</em> is announced (about a minute ahead at 100 ms blocks).
          </li>
          <li>
            <strong>Draw.</strong> The winner is contributor number <code>uint256(drawBlockHash) mod contributors</code>, with contributors ordered by their first contribution. The hash and the list are public, so anyone can recompute the result. Nobody, including us, can influence a future block hash.
          </li>
          <li>
            <strong>Payout.</strong> ${g.targetUsd} USDC goes to the winning wallet toward one month of Claude Max 20x (subscriptions cannot be transferred, so the money is paid out, not the account). The transaction hash is published here and on X, then the next round opens.
          </li>
          <li>
            <strong>Rewards.</strong> After each round, RESET from the contributor-rewards allocation is distributed to that round's contributors pro-rata to what they gave. Rewards scale with contribution; odds never do.
          </li>
        </ol>
        <p>{t.support.noEffect} Winning here does not change anything about anyone's Claude account or Anthropic's limits; it pays for a plan.</p>
      </section>

      <section class="section prose" id="token">
        <h2>RESET tokenomics</h2>
        <p>
          RESET is the community token behind the goal. Its whole design is one sentence: <strong>supply only goes down, and it goes down every time a real Claude reset is published.</strong>
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Chain</td>
                <td>Robinhood Chain (Arbitrum L2, chain id 4663), ERC-20, 18 decimals</td>
              </tr>
              <tr>
                <td>Supply</td>
                <td>1,000,000,000 RESET minted once. No mint function exists in the contract.</td>
              </tr>
              <tr>
                <td>Liquidity</td>
                <td>40% paired with ETH on Uniswap on Robinhood Chain; LP tokens burned so liquidity cannot be pulled.</td>
              </tr>
              <tr>
                <td>Contributor rewards</td>
                <td>25%, distributed after each round to that round's USDC contributors pro-rata to what they gave.</td>
              </tr>
              <tr>
                <td>Burn reserve</td>
                <td>15%, burned on a public schedule: 0.25% of initial supply per published Claude reset, 0.5% per completed goal round.</td>
              </tr>
              <tr>
                <td>Treasury</td>
                <td>20%, vesting linearly over 12 months, for running the site and future goals.</td>
              </tr>
              <tr>
                <td>Transfer fee</td>
                <td>1% on trades and transfers: 0.6% burned forever, 0.4% sent to the goal pool. Liquidity pool, treasury and pool wallet are fee-exempt. The fee can be lowered but never raised above 2%.</td>
              </tr>
              <tr>
                <td>Control</td>
                <td>Owner can only adjust the fee downward, set exemptions and the pool address, and burn from its own balance. Ownership will be renounced after launch, freezing everything.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h2>Why burns are tied to resets</h2>
        <p>
          Every reset announcement already sends people to this site. Tying a burn to each one gives holders a reason to care about the exact thing the site tracks, and gives readers a second reason to check: when Anthropic resets limits, RESET supply shrinks the same day. The burn transaction is linked from the reset's event page, with the event id written into the on-chain <code>ResetBurn</code> event.
        </p>
        <h2>Live token stats</h2>
        {token ? (
          <dl class="kv">
            <dt>Contract</dt>
            <dd>
              <a href={`${explorer}/token/${token.address}`} target="_blank" rel="noopener noreferrer">
                <code>{token.address}</code>
              </a>
            </dd>
            <dt>Total supply</dt>
            <dd>{formatUnits(BigInt(token.total_supply), token.decimals, 0)} RESET</dd>
            <dt>Burned</dt>
            <dd>{formatUnits(BigInt(token.burned), token.decimals, 0)} RESET ({supplyPct(token.burned)} of initial)</dd>
            <dt>Circulating</dt>
            <dd>{formatUnits(BigInt(token.circulating), token.decimals, 0)} RESET</dd>
          </dl>
        ) : (
          <p class="notice notice--warn">The RESET contract is not deployed yet. Stats appear here automatically once it is.</p>
        )}
      </section>

      <section class="section prose" id="rules">
        <h2>Rules</h2>
        <ul>
          <li>An entry is a wallet that sent at least {status.min_contribution_usd} USDC to the pool during the round. One entry per wallet regardless of amount or number of transfers.</li>
          <li>Contributions are final and stay in the pool; the pool funds the payout and, when a round is cancelled, rolls into the next one.</li>
          <li>The prize is ${g.targetUsd} USDC sent to the winning wallet, intended for one month of Claude Max 20x.</li>
          <li>Wallets controlled by the site operator, and the pool and treasury wallets, are excluded from the draw.</li>
          <li>RESET is a community token with no promise of value, return or utility beyond what is described here. Supply mechanics are enforced by the contract; price is set by the market. Do not spend what you cannot afford to lose.</li>
          <li>This project is independent and not affiliated with or endorsed by Anthropic or Robinhood. Winning pays for a plan; it does not change any account or limit.</li>
          <li>Local law applies to you; if community pools or tokens are restricted where you live, do not participate.</li>
        </ul>
      </section>

      <section class="section prose" id="verify">
        <h2>Verify it yourself</h2>
        <ul>
          <li>
            Pool balance and every contribution: {status.pool.address ? <a href={`${explorer}/address/${status.pool.address}`} target="_blank" rel="noopener noreferrer">the pool wallet on Blockscout</a> : <span>pool address published when the round opens</span>}.
          </li>
          <li>
            Live status as JSON: <a href="/api/v1/goal">/api/v1/goal</a>; the contributor list in draw order: <a href="/api/v1/goal/contributors">/api/v1/goal/contributors</a>.
          </li>
          <li>Draw block hash: look up the announced block on the explorer and compute <code>hash mod contributors</code>.</li>
          <li>
            Contract source: <a href={cfg.repoUrl ? `${cfg.repoUrl}/blob/main/contracts/ResetToken.sol` : '/goal'} target="_blank" rel="noopener noreferrer">contracts/ResetToken.sol</a> in the public repository; the deployed bytecode is verified on the explorer after deployment.
          </li>
        </ul>
        {status.past_rounds.length > 0 ? (
          <>
            <h2>Past rounds</h2>
            <ul>
              {status.past_rounds.map((r) => (
                <li>
                  Round {r.id}: {r.title} · {r.status}
                  {r.winner ? ` · winner ${r.winner}` : ''}
                  {r.payout_tx ? (
                    <>
                      {' '}·{' '}
                      <a href={`${explorer}/tx/${r.payout_tx}`} target="_blank" rel="noopener noreferrer">
                        payout {shortAddr(r.payout_tx)}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      <script src="/goal.js" defer></script>
    </Layout>
  );
};

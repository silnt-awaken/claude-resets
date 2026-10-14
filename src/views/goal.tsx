import type { FC } from 'hono/jsx';
import { ROADMAP, type PhaseStatus } from '../goal/roadmap';
import type { GoalStatus } from '../routes/goal';
import { formatNumber, interpolate, intlLocale, localizePath } from '../i18n';
import { ArrowIcon, CloseIcon } from './icons';
import { Layout, type PageContext } from './layout';

function shortSig(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

/** Compact goal card for the tracker homepage. Honest states: not open / open / frozen / drawn / paid. */
export const GoalCard: FC<{ ctx: PageContext; status: GoalStatus }> = ({ ctx, status }) => {
  const { t, locale } = ctx;
  const round = status.round;
  const raised = round?.raised_usd ?? 0;
  const target = round?.target_usd ?? status.target_usd;
  const pct = Math.round(status.progress * 100);
  const explorer = status.network.explorer;
  const stateLine = !status.enabled || !round
    ? t.goal.preparing
    : round?.status === 'frozen'
      ? interpolate(t.goal.frozen, { slot: formatNumber(round.draw_slot ?? 0, locale) })
      : round?.status === 'drawn'
        ? interpolate(t.goal.drawn, { winner: round.winner ?? '' })
        : round?.status === 'paid'
          ? interpolate(t.goal.paid, { winner: round.winner ?? '' })
          : null;
  const open = status.enabled && round?.status === 'open' && !!status.pool.wallet;
  const money = (amount: number) => new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'USD', maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  const raisedLabel = interpolate(t.goal.raised, { raised: money(raised), target: money(target) });
  return (
    <section class="section" aria-labelledby="goal-heading">
      <div class="card card--sun goal-card" data-role="goal-card" data-round-status={round?.status ?? 'none'} data-target={String(target)}>
        <div class="goal-head">
          <div>
            <span class="mono">{t.goal.sub}</span>
            <h2 id="goal-heading">{t.goal.heading}</h2>
          </div>
          <span class="goal-target">{money(target)}<small>{t.goal.targetLabel}</small></span>
        </div>
        <p class="goal-pitch">{interpolate(t.goal.pitch, { target: money(target) })}</p>
        <ol class="goal-steps">
          {t.goal.steps.map((step, i) => <li><span class="goal-step-number" aria-hidden="true">{i + 1}</span><div><strong>{interpolate(step.title, { target: money(target) })}</strong><p>{step.body}</p></div></li>)}
        </ol>
        <div class="goal-meter" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={raised} aria-label={raisedLabel}>
          <span class="goal-meter-fill" style={`width:${pct}%`}></span>
        </div>
        <div class="goal-figures">
          <strong class="goal-raised" data-role="goal-raised">{raisedLabel}</strong>
          {status.enabled && round ? (
            <span class="mono">
              {t.goal.contributorsHeading} <span data-role="goal-entries">{formatNumber(round.contributors, locale)}</span>
            </span>
          ) : null}
        </div>
        {status.enabled && status.sync.stale ? <p class="status-line">{t.goal.stale}</p> : null}
        {stateLine ? <p class="notice notice--warn goal-state">{stateLine}</p> : null}
        <div class="goal-contributors">
          <h3>{t.goal.contributorsHeading}</h3>
          <p class="status-line">{t.goal.contributorsNote}</p>
          <ul class="contributor-list" data-role="goal-contributors">
            {status.contributor_list.map((entry, i) => <li>
              <span class="contributor-number" aria-hidden="true">{i + 1}</span>
              <a href={`${explorer}/account/${entry.wallet}`} title={entry.wallet} target="_blank" rel="noopener noreferrer"><span>{t.goal.walletLabel}</span> <code>{entry.wallet.slice(0, 6)}…{entry.wallet.slice(-4)}</code> <ArrowIcon /></a>
              <strong>{money(entry.usdc)}</strong>
            </li>)}
          </ul>
          <p class="status-line" data-role="goal-contributors-empty" hidden={status.contributor_list.length > 0}>{status.enabled && !status.contributors_available ? t.goal.contributorsUnavailable : t.goal.noContributors}</p>
        </div>
        <div class="goal-payment-help">
          <strong>{t.goal.paymentHeading}</strong>
          <p>{t.goal.paymentNote}</p>
        </div>
        {open ? (
          <div class="goal-cta" data-role="goal-contribute">
            <button class="btn btn--accent" type="button" data-role="goal-open" aria-haspopup="dialog">
              {t.goal.enter} <ArrowIcon />
            </button>
            <span class="status-line">{t.goal.enterPlaceholder}</span>
          </div>
        ) : null}
        <div class="goal-links">
          <a class="btn" href={localizePath(locale, '/goal')}>
            {t.goal.learn} <ArrowIcon />
          </a>
          {status.enabled && status.pool.wallet ? (
            <a class="status-line" href={`${explorer}/account/${status.pool.wallet}`} target="_blank" rel="noopener noreferrer">
              {t.goal.viewPool}
            </a>
          ) : null}
        </div>
        {open ? <GoalSheet ctx={ctx} status={status} /> : null}
      </div>
    </section>
  );
};

/** Contribution sheet: amount → review → Phantom approval → submitted → confirmed. Nothing here holds keys. */
const GoalSheet: FC<{ ctx: PageContext; status: GoalStatus }> = ({ ctx, status }) => {
  const s = ctx.t.goal.sheet;
  const w = ctx.t.goal.wallet;
  return (
    <dialog id="goal-sheet" class="goal-sheet" aria-labelledby="goal-sheet-title">
      <div class="dialog-head">
        <h2 id="goal-sheet-title">{s.title}</h2>
        <button class="icon-btn" type="button" data-role="sheet-close" aria-label={s.close}>
          <CloseIcon />
        </button>
      </div>
      <div class="dialog-body">
        <p class="goal-sheet-intro">{ctx.t.goal.paymentNote}</p>
        <div data-role="form">
        <span class="mono">{s.amount}</span>
        <div class="goal-presets" role="group" aria-label={s.amount}>
          {[1, 5, 10, 25].map((n) => (
            <button class="btn" type="button" data-role="preset" data-amount={String(n)} aria-pressed={n === 5 ? 'true' : 'false'}>
              ${n}
            </button>
          ))}
        </div>
        <label class="goal-amount">
          <span aria-hidden="true">$</span>
          <input data-role="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label={s.custom} />
        </label>
        <span class="mono">{s.review}</span>
        <div class="goal-review">
          <span>{s.contribution}</span>
          <span data-role="row-contribution"></span>
          <span>{s.networkFee}</span>
          <span data-role="row-fee">—</span>
          <span class="total">{s.total}</span>
          <span class="total" data-role="row-total"></span>
          <span class="note">{s.denomination}</span>
        </div>
        <button class="btn btn--accent" type="button" data-role="pay">
          {s.connect}
        </button>
        <p class="goal-sheet-status" data-role="sheet-status" role="status" aria-live="polite"></p>
        <p class="goal-fallback" data-role="receipt" hidden></p>
        </div>
        <div class="goal-done" data-role="done" hidden>
          <span class="goal-done-mark" aria-hidden="true">✓</span>
          <h3 data-role="done-title">{s.thanks}</h3>
          <p data-role="done-line"></p>
          <p class="goal-fallback" data-role="done-receipt"></p>
          <button class="btn btn--accent" type="button" data-role="sheet-close">
            {s.done}
          </button>
        </div>
        <div class="goal-fallback" data-role="fallback" role="status" hidden>
          <p>{s.noWallet}</p>
          <code class="goal-address">{status.pool.wallet}</code>
          <div class="goal-cta">
            <a class="btn" href="https://phantom.com/download" data-role="install" target="_blank" rel="noopener noreferrer">
              {w.install}
            </a>
            <a class="btn btn--accent" href="https://phantom.app/" data-role="open-in-app" rel="noopener noreferrer" hidden>
              {w.openInApp}
            </a>
            <button class="btn" type="button" data-role="copy-pool">
              {s.copy}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
};

const ROADMAP_CHIP: Record<PhaseStatus, string> = { done: 'chip--mint', now: 'chip--accent', next: 'chip--sky', later: 'chip--muted' };
const ROADMAP_LABEL: Record<PhaseStatus, string> = { done: 'Live', now: 'Switching on', next: 'Next', later: 'Later' };

/** Full page: mechanics, trust, rules, verification, roadmap. English, like the technical docs. */
export const GoalPage: FC<{ ctx: PageContext; status: GoalStatus }> = ({ ctx, status }) => {
  const { cfg, t, locale } = ctx;
  const explorer = status.network.explorer;
  const round = status.round;
  const target = round?.target_usd ?? status.target_usd;
  return (
    <Layout ctx={ctx} title={`${t.goal.heading} | ${cfg.siteName}`} description="Readers contribute toward a $200 goal. One contributor receives the money to put toward a month of Claude Max.">
      <h1 class="page-title">{t.goal.heading}</h1>
      {locale !== 'en' ? (
        <p class="notice" style="margin-top:12px">
          {t.docs.englishOnly} <a href={localizePath(locale, '/')}>{t.docs.backTo}</a>
        </p>
      ) : null}

      <GoalCard ctx={ctx} status={status} />

      <section class="section prose" id="how">
        <h2>What happens to your contribution?</h2>
        <ol>
          <li>
            <strong>Everyone adds to one fund.</strong> Your contribution goes to a separate wallet managed by {cfg.ownerName}, who runs this site. The progress bar shows confirmed contributions for this round.
            {status.pool.wallet ? (
              <>
                {' '}<a href={`${explorer}/account/${status.pool.wallet}`} target="_blank" rel="noopener noreferrer">See the public fund and its transfers.</a>
              </>
            ) : (
              ' The address is published here when the goal opens.'
            )}{' '}
          </li>
          <li>
            <strong>Your wallet gets one entry.</strong> Contribute at least ${status.min_contribution_usd} in USDC while the round is open. Giving $1 or $100 gives you the same chance. Sending twice from the same wallet still counts as one entry. The contributor list above shows who is in.
          </li>
          <li>
            <strong>The round closes at ${target}.</strong> Once the goal is reached, the list of entries is locked. Contributions confirmed afterwards go into the next round.
          </li>
          <li>
            <strong>One contributor is picked at random.</strong> A future public result from the Solana network determines the winner automatically. We publish the result and the entry list so anyone can check the pick. The technical details are below.
          </li>
          <li>
            <strong>The winner receives ${target} in USDC.</strong> {cfg.ownerName} sends it to the winning wallet and publishes the receipt. The winner buys their own Claude plan; we do not transfer an account or activate a subscription for them. A new round opens automatically.
          </li>
        </ol>
        <p>{t.support.noEffect} Winning here does not change anything about anyone's Claude account or Anthropic's limits; it pays for a plan.</p>
      </section>

      <section class="section prose" id="trust">
        <h2>Who holds the money?</h2>
        <p>
          {cfg.ownerName} holds the fund in a separate wallet and sends the winner their money manually. It is not held by Anthropic or by an automatic payment contract. The public wallet lets you see contributions and payouts. Only contribute if you are comfortable trusting {cfg.ownerName} to make the payout.
        </p>
      </section>

      {round && (round.status === 'drawn' || round.status === 'paid') && round.draw_hash ? (
        <section class="section prose" id="draw">
          <h2>Round {round.id} draw</h2>
          <dl class="kv">
            <dt>Announced draw slot</dt>
            <dd>{formatNumber(round.draw_slot ?? 0, locale)}</dd>
            <dt>Block used</dt>
            <dd>
              <a href={`${explorer}/block/${round.draw_block}`} target="_blank" rel="noopener noreferrer">
                {formatNumber(round.draw_block ?? 0, locale)}
              </a>
            </dd>
            <dt>Block hash</dt>
            <dd>
              <code>{round.draw_hash}</code>
            </dd>
            <dt>Contributors</dt>
            <dd>{round.entries}</dd>
            <dt>Winner index</dt>
            <dd>{round.winner_index}</dd>
            <dt>Winner</dt>
            <dd>
              {round.winner_wallet ? (
                <a href={`${explorer}/account/${round.winner_wallet}`} target="_blank" rel="noopener noreferrer">
                  <code>{round.winner_wallet}</code>
                </a>
              ) : null}
            </dd>
            {round.payout_tx ? (
              <>
                <dt>Payout</dt>
                <dd>
                  <a href={`${explorer}/tx/${round.payout_tx}`} target="_blank" rel="noopener noreferrer">
                    <code>{shortSig(round.payout_tx)}</code>
                  </a>
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section class="section prose" id="rules">
        <h2>Rules</h2>
        <ul>
          <li>An entry is a wallet whose USDC transfers to the goal wallet during an open round add up to at least {status.min_contribution_usd} USDC. One entry per wallet regardless of amount or number of transfers.</li>
          <li>Contributions are final. They fund the payout of the round they land in; when a round is cancelled, they roll into the next one.</li>
          <li>The prize is ${target} USDC sent to the winning wallet, intended for one month of Claude Max 20x.</li>
          <li>The goal wallet itself can never win. Any other wallet that contributes, including the operator's personal one, is an ordinary entry.</li>
          <li>Send from a wallet you control. If you contribute from an exchange account, the exchange's wallet is the entry and a payout to it may not reach you.</li>
          <li>This project is independent and not affiliated with or endorsed by Anthropic. Winning pays for a plan; it does not change any account or limit.</li>
          <li>Local law applies to you; if community pools of this kind are restricted where you live, do not participate.</li>
        </ul>
      </section>

      <section class="section prose" id="verify">
        <h2>Verify it yourself</h2>
        <ul>
          <li>
            Every contribution and the wallet balance: {status.pool.wallet ? <a href={`${explorer}/account/${status.pool.wallet}`} target="_blank" rel="noopener noreferrer">the goal wallet on Solscan</a> : <span>the wallet is published when the goal opens</span>}.
          </li>
          <li>
            Live status as JSON: <a href="/api/v1/goal">/api/v1/goal</a>; the contributor list in draw order: <a href="/api/v1/goal/contributors">/api/v1/goal/contributors</a>.
          </li>
          <li>Draw block hash: open the announced block on the explorer and compute <code>hash mod contributors</code> (decode the base58 hash to 32 bytes, read them as a big-endian integer).</li>
          <li>
            Source code: <a href={cfg.repoUrl ?? '/goal'} target="_blank" rel="noopener noreferrer">the public repository</a>; the sync, freeze and draw logic lives in <code>src/routes/goal.ts</code>.
          </li>
        </ul>
        {status.past_rounds.length > 0 ? (
          <>
            <h2>Past rounds</h2>
            <ul>
              {status.past_rounds.map((r) => (
                <li>
                  Round {r.id}: {r.title} · {r.status} · {formatNumber(Math.round(r.raised_usd), locale)} USDC
                  {r.winner ? ` · winner ${r.winner}` : ''}
                  {r.draw_block ? (
                    <>
                      {' '}·{' '}
                      <a href={`${explorer}/block/${r.draw_block}`} target="_blank" rel="noopener noreferrer">
                        block {formatNumber(r.draw_block, locale)}
                      </a>
                    </>
                  ) : null}
                  {r.payout_tx ? (
                    <>
                      {' '}·{' '}
                      <a href={`${explorer}/tx/${r.payout_tx}`} target="_blank" rel="noopener noreferrer">
                        payout {shortSig(r.payout_tx)}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section class="section prose" id="roadmap">
        <h2>Roadmap</h2>
        <p>What is live, what is being switched on, and what comes after. Nothing here promises more than work.</p>
        <ol class="roadmap">
          {ROADMAP.map((p) => (
            <li class={`roadmap-phase roadmap-phase--${p.status}`} id={`roadmap-${p.id}`}>
              <div class="roadmap-head">
                <span class={`chip ${ROADMAP_CHIP[p.status]}`}>{ROADMAP_LABEL[p.status]}</span>
                <h3>{p.title}</h3>
                <span class="roadmap-when">{p.when}</span>
              </div>
              <ul>
                {p.items.map((it) => (
                  <li>{it}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </Layout>
  );
};

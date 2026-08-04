#!/usr/bin/env python3
import json
import math
import os
import runpy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
ENGINE = runpy.run_path(str(ROOT / 'scripts/research/v16-two-stage-predictor.py'), run_name='v16_two_stage_engine')
BASE = ENGINE['BASE']

rd = ENGINE['rd']
wr = ENGINE['wr']
mean = ENGINE['mean']
median = ENGINE['median']
round_value = ENGINE['round_value']
pct = ENGINE['pct']
norm_hist = ENGINE['norm_hist']
base_feature = ENGINE['base_feature']
base_vector = ENGINE['base_vector']
MODELS = ENGINE['MODELS']
augment_feature = ENGINE['augment_feature']
extended_flags = ENGINE['extended_flags']
extended_vector = ENGINE['extended_vector']
train = ENGINE['train']
calibrated_probability = ENGINE['calibrated_probability']
execution_reasons = ENGINE['execution_reasons']
effective_model_support = ENGINE['effective_model_support']

HISTORY_DIR = ROOT / 'data/history'
OUT = ROOT / 'data/research/v16-two-stage-top2-backtest.json'
TOP_K = 10
MIN_UNIVERSE = 60
WARMUP = 20
COST_PCT = 0.60


def correlation_and_lifts(rows):
    base_rate = sum(row['yTop10'] for row in rows) / max(1, len(rows))
    correlations = []
    for left in range(8):
        line = []
        left_values = [row['flags'][left] for row in rows]
        for right in range(8):
            right_values = [row['flags'][right] for row in rows]
            value = BASE['corr'](left_values, right_values)
            line.append(value if value is not None else 0.0)
        correlations.append(line)
    lifts = []
    for index in range(8):
        signals = [row for row in rows if row['flags'][index]]
        hits = sum(row['yTop10'] for row in signals)
        posterior = (hits + base_rate * 25) / (len(signals) + 25)
        lifts.append(posterior / max(base_rate, 1e-9))
    return correlations, lifts


def max_drawdown(returns):
    equity = 1.0
    peak = 1.0
    worst = 0.0
    for value in returns:
        equity *= 1.0 + value / 100.0
        peak = max(peak, equity)
        drawdown = (equity / peak - 1.0) * 100.0
        worst = min(worst, drawdown)
    return worst


def compounded_return(returns):
    equity = 1.0
    for value in returns:
        equity *= 1.0 + value / 100.0
    return (equity - 1.0) * 100.0


def simulate_trade(history, signal_date, feature, horizon=3):
    rows = history['rows']
    index_by_date = {row['date']: index for index, row in enumerate(rows)}
    signal_index = index_by_date.get(signal_date)
    if signal_index is None or signal_index + 1 >= len(rows):
        return {'status': 'NO_FUTURE_DATA'}

    available = rows[signal_index + 1: signal_index + 1 + horizon]
    full_horizon = len(available) == horizon
    atr = feature['a14']
    entry_low = feature['close'] - 0.10 * atr
    entry_high = feature['close'] + 0.10 * atr
    stop = feature['close'] - 1.10 * atr
    target = feature['close'] + 1.50 * atr
    first = available[0]

    if first['open'] > entry_high:
        return {'status': 'NO_ENTRY_GAP_ABOVE', 'fullHorizon': full_horizon}
    if first['open'] < stop:
        return {'status': 'NO_ENTRY_GAP_BELOW_STOP', 'fullHorizon': full_horizon}
    if first['open'] >= entry_low:
        entry = first['open']
    elif first['high'] >= entry_low:
        entry = entry_low
    else:
        return {'status': 'NO_ENTRY_RANGE_NOT_REACHED', 'fullHorizon': full_horizon}

    for day_number, bar in enumerate(available, 1):
        stop_hit = bar['low'] <= stop
        target_hit = bar['high'] >= target
        if stop_hit and target_hit:
            exit_price = stop
            gross = pct(exit_price, entry)
            return {'status': 'STOP_HIT_CONSERVATIVE_BOTH', 'entry': entry, 'exit': exit_price, 'grossReturnPct': gross, 'netReturnPct': gross - COST_PCT, 'exitDay': day_number, 'fullHorizon': full_horizon}
        if stop_hit:
            exit_price = stop
            gross = pct(exit_price, entry)
            return {'status': 'STOP_HIT', 'entry': entry, 'exit': exit_price, 'grossReturnPct': gross, 'netReturnPct': gross - COST_PCT, 'exitDay': day_number, 'fullHorizon': full_horizon}
        if target_hit:
            exit_price = target
            gross = pct(exit_price, entry)
            return {'status': 'TARGET_HIT', 'entry': entry, 'exit': exit_price, 'grossReturnPct': gross, 'netReturnPct': gross - COST_PCT, 'exitDay': day_number, 'fullHorizon': full_horizon}

    exit_price = available[-1]['close']
    gross = pct(exit_price, entry)
    return {'status': 'TIME_EXIT' if full_horizon else 'PARTIAL_HORIZON_EXIT', 'entry': entry, 'exit': exit_price, 'grossReturnPct': gross, 'netReturnPct': gross - COST_PCT, 'exitDay': len(available), 'fullHorizon': full_horizon}


def main():
    histories = [norm_hist(path) for path in HISTORY_DIR.glob('*.json')]
    histories = [history for history in histories if history['ok'] and len(history['rows']) >= 60]
    history_by_ticker = {history['ticker']: history for history in histories}

    by_date = {}
    for history in histories:
        for index in range(55, len(history['rows'])):
            feature = base_feature(history, index)
            if feature:
                by_date.setdefault(feature['date'], []).append(augment_feature(history, index, feature))

    dates = sorted(date for date, values in by_date.items() if len(values) >= MIN_UNIVERSE)
    for date in dates:
        market_median = median([feature['ret20'] for feature in by_date[date]])
        for feature in by_date[date]:
            feature['rs20'] = feature['ret20'] - market_median

    rows = []
    rows_by_date = {}
    for date_index, signal_date in enumerate(dates[:-1]):
        outcome_date = dates[date_index + 1]
        outcome_map = {feature['ticker']: feature for feature in by_date[outcome_date]}
        session = []
        for feature in by_date[signal_date]:
            outcome = outcome_map.get(feature['ticker'])
            if not outcome:
                continue
            next_return = pct(outcome['close'], feature['close'])
            flags = extended_flags(feature)
            session.append({
                'signalDate': signal_date,
                'outcomeDate': outcome_date,
                'ticker': feature['ticker'],
                'name': feature['name'],
                'feature': feature,
                'nextReturn': next_return,
                'flags': flags,
                'xNew': extended_vector(feature, flags),
            })
        session.sort(key=lambda row: row['nextReturn'], reverse=True)
        top = {row['ticker'] for row in session[:TOP_K]}
        for row in session:
            row['yTop10'] = 1 if row['ticker'] in top else 0
            row['yNetPositive'] = 1 if row['nextReturn'] > COST_PCT else 0
            row['yLargeLoss'] = 1 if row['nextReturn'] <= -2.0 else 0
        rows.extend(session)
        rows_by_date[signal_date] = session

    signal_dates = dates[:-1]
    warmup_rows = [row for date in signal_dates[:WARMUP] for row in rows_by_date[date]]
    top_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yTop10', 'xNew', 30, 0.03)
    positive_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yNetPositive', 'xNew', 30, 0.025)
    loss_weights = train([0.0] * len(warmup_rows[0]['xNew']), warmup_rows, 'yLargeLoss', 'xNew', 30, 0.025)
    seen = list(warmup_rows)

    sessions = []
    all_primary_trades = []
    all_substitution_trades = []

    for signal_date in signal_dates[WARMUP:]:
        session = rows_by_date[signal_date]
        correlations, lifts = correlation_and_lifts(seen)
        scored = []
        for row in session:
            p_top = calibrated_probability(top_weights, row, seen, 'yTop10', 'xNew')
            p_positive = calibrated_probability(positive_weights, row, seen, 'yNetPositive', 'xNew')
            p_loss = calibrated_probability(loss_weights, row, seen, 'yLargeLoss', 'xNew')
            support = effective_model_support(row['flags'], correlations, lifts)
            failure = row['feature']['momentumFailureRisk']
            score = p_top * (0.55 + p_positive) * (1.0 - p_loss) * (1.0 - 0.65 * failure) * (1.0 + 0.08 * min(support, 3.0))
            if not execution_reasons(row['feature']):
                scored.append((score, row, p_top, p_positive, p_loss, support))
        scored.sort(key=lambda item: item[0], reverse=True)
        ranked = scored[:3]
        primaries = ranked[:2]
        conditional = ranked[2] if len(ranked) > 2 else None

        selected_rows = [item[1] for item in primaries]
        gross_close_returns = [row['nextReturn'] for row in selected_rows]
        net_close_returns = [value - COST_PCT for value in gross_close_returns]
        close_portfolio_net = mean(net_close_returns) if net_close_returns else 0.0

        primary_simulations = []
        for item in primaries:
            row = item[1]
            trade = simulate_trade(history_by_ticker[row['ticker']], signal_date, row['feature'])
            trade.update({'ticker': row['ticker'], 'companyNameAr': row['name'], 'role': 'PRIMARY'})
            primary_simulations.append(trade)
            all_primary_trades.append(trade)

        final_slots = list(primary_simulations)
        empty_slots = [index for index, trade in enumerate(final_slots) if not trade['status'].startswith(('TARGET', 'STOP', 'TIME', 'PARTIAL'))]
        conditional_trade = None
        if empty_slots and conditional is not None:
            row = conditional[1]
            conditional_trade = simulate_trade(history_by_ticker[row['ticker']], signal_date, row['feature'])
            conditional_trade.update({'ticker': row['ticker'], 'companyNameAr': row['name'], 'role': 'CONDITIONAL_SUBSTITUTE'})
            if conditional_trade['status'].startswith(('TARGET', 'STOP', 'TIME', 'PARTIAL')):
                final_slots[empty_slots[0]] = conditional_trade
            all_substitution_trades.append(conditional_trade)

        slot_returns = []
        for trade in final_slots:
            if isinstance(trade.get('netReturnPct'), (int, float)):
                slot_returns.append(trade['netReturnPct'])
            else:
                slot_returns.append(0.0)
        three_day_portfolio_net = mean(slot_returns) if slot_returns else 0.0

        sessions.append({
            'signalDate': signal_date,
            'outcomeDate': session[0]['outcomeDate'],
            'primaryTickers': [row['ticker'] for row in selected_rows],
            'conditionalTicker': conditional[1]['ticker'] if conditional else None,
            'top10HitsAmongTwo': sum(row['yTop10'] for row in selected_rows),
            'grossCloseToCloseReturnsPct': [round_value(value, 3) for value in gross_close_returns],
            'netCloseToClosePortfolioPct': round_value(close_portfolio_net, 3),
            'primaryTradeSimulations': primary_simulations,
            'conditionalTradeSimulation': conditional_trade,
            'threeSessionPortfolioNetPctWithSubstitution': round_value(three_day_portfolio_net, 3),
        })

        top_weights = train(top_weights, session, 'yTop10', 'xNew', 10, 0.022)
        positive_weights = train(positive_weights, session, 'yNetPositive', 'xNew', 10, 0.020)
        loss_weights = train(loss_weights, session, 'yLargeLoss', 'xNew', 10, 0.020)
        seen.extend(session)

    close_returns = [session['netCloseToClosePortfolioPct'] for session in sessions]
    three_returns_full = [
        session['threeSessionPortfolioNetPctWithSubstitution']
        for session in sessions
        if all(trade.get('fullHorizon') is True for trade in session['primaryTradeSimulations'] if trade.get('netReturnPct') is not None)
    ]
    filled_primary = [trade for trade in all_primary_trades if isinstance(trade.get('netReturnPct'), (int, float))]
    full_horizon_primary = [trade for trade in filled_primary if trade.get('fullHorizon') is True]

    def status_count(trades, prefix):
        return sum(1 for trade in trades if trade.get('status', '').startswith(prefix))

    positive_sessions = sum(1 for value in close_returns if value > 0)
    negative_sessions = sum(1 for value in close_returns if value < 0)
    flat_sessions = len(close_returns) - positive_sessions - negative_sessions

    output = {
        'schemaVersion': '16.5.1-top2-backtest',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'methodology': {
            'evaluatedSessions': len(sessions),
            'warmupSessions': WARMUP,
            'selection': 'Top two executable candidates by exact V16.5 execution score; third candidate substitutes one unfilled primary only',
            'noFutureLeakage': True,
            'roundTripCostPct': COST_PCT,
            'closeToCloseDefinition': 'Equal-weight next-session close-to-close return minus 0.60% per selected stock',
            'threeSessionDefinition': 'Entry only on next session inside range; skip gap above range or below stop; target/stop over up to three sessions; stop wins if target and stop both occur in same OHLC bar',
        },
        'closeToCloseTopTwo': {
            'sessions': len(sessions),
            'positiveSessions': positive_sessions,
            'negativeSessions': negative_sessions,
            'flatSessions': flat_sessions,
            'sessionWinRatePct': round_value(positive_sessions / len(sessions) * 100, 2),
            'averageNetPortfolioReturnPct': round_value(mean(close_returns), 4),
            'medianNetPortfolioReturnPct': round_value(median(close_returns), 4),
            'compoundedNetReturnPct': round_value(compounded_return(close_returns), 3),
            'maximumDrawdownPct': round_value(max_drawdown(close_returns), 3),
            'bestSessionPct': round_value(max(close_returns), 3),
            'worstSessionPct': round_value(min(close_returns), 3),
            'averageTop10HitsAmongTwo': round_value(mean([session['top10HitsAmongTwo'] for session in sessions]), 4),
            'precisionAtTwoPct': round_value(mean([session['top10HitsAmongTwo'] / 2 for session in sessions]) * 100, 3),
        },
        'threeSessionPrimaryTrades': {
            'selectedPrimaryTrades': len(all_primary_trades),
            'filledTrades': len(filled_primary),
            'fillRatePct': round_value(len(filled_primary) / len(all_primary_trades) * 100, 2),
            'fullHorizonFilledTrades': len(full_horizon_primary),
            'targets': status_count(full_horizon_primary, 'TARGET'),
            'stops': status_count(full_horizon_primary, 'STOP'),
            'timeExits': status_count(full_horizon_primary, 'TIME'),
            'profitableFilledTrades': sum(1 for trade in full_horizon_primary if trade['netReturnPct'] > 0),
            'winRatePct': round_value(sum(1 for trade in full_horizon_primary if trade['netReturnPct'] > 0) / max(1, len(full_horizon_primary)) * 100, 2),
            'averageNetReturnPct': round_value(mean([trade['netReturnPct'] for trade in full_horizon_primary]), 4),
            'medianNetReturnPct': round_value(median([trade['netReturnPct'] for trade in full_horizon_primary]), 4),
        },
        'threeSessionPortfolioWithConditionalSubstitution': {
            'fullHorizonSessions': len(three_returns_full),
            'positiveSessions': sum(1 for value in three_returns_full if value > 0),
            'negativeSessions': sum(1 for value in three_returns_full if value < 0),
            'averageNetPortfolioReturnPct': round_value(mean(three_returns_full), 4),
            'medianNetPortfolioReturnPct': round_value(median(three_returns_full), 4),
            'compoundedNetReturnPct': round_value(compounded_return(three_returns_full), 3),
            'maximumDrawdownPct': round_value(max_drawdown(three_returns_full), 3),
        },
        'recentSessions': sessions[-15:],
        'allSessions': sessions,
    }
    wr(OUT, output)
    print(json.dumps({
        'closeToCloseTopTwo': output['closeToCloseTopTwo'],
        'threeSessionPrimaryTrades': output['threeSessionPrimaryTrades'],
        'threeSessionPortfolioWithConditionalSubstitution': output['threeSessionPortfolioWithConditionalSubstitution'],
        'recentSessions': output['recentSessions'][-5:],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

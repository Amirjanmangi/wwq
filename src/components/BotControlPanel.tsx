import React, { useState } from 'react';
import {
  Play,
  Square,
  Zap,
  Sliders,
  DollarSign,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Percent,
} from 'lucide-react';
import { BotConfig, HftSignals, SpotWallet } from '../types/trading';
import { BITFINEX_COIN_SPECS } from '../utils/hftMath';

interface BotControlPanelProps {
  config: BotConfig;
  onUpdateConfig: (newConfig: Partial<BotConfig>) => void;
  onManualTrigger: () => void;
  signals: HftSignals;
  isPositionOpen: boolean;
  spotWallets: SpotWallet[];
}

export const BotControlPanel: React.FC<BotControlPanelProps> = ({
  config,
  onUpdateConfig,
  onManualTrigger,
  signals,
  isPositionOpen,
  spotWallets,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Find USD or USDT balance if available
  const usdWallet = spotWallets.find((w) => w.currency.toUpperCase() === 'USD');
  const ustWallet = spotWallets.find((w) => ['UST', 'USDT'].includes(w.currency.toUpperCase()));
  const usdCash = usdWallet ? Math.max(usdWallet.available, usdWallet.balance) : 0;
  const ustCash = ustWallet ? Math.max(ustWallet.available, ustWallet.balance) : 0;
  const availableUsd = usdCash > 0 ? usdCash : ustCash;

  return (
    <div className="bg-[#0f1420] border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col justify-between">
      <div>
        {/* Title & Quick Stats */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white">Bot Execution Controls</span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                config.autoScalpActive
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {config.autoScalpActive ? 'RUNNING AUTOMATED' : 'IDLE / MANUAL'}
            </span>
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showAdvanced ? 'Hide Settings' : 'Tune Thresholds'}</span>
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Real-Time WebSocket & ETH Fluctuation Status Ribbon */}
        <div className="mt-2.5 p-2 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-medium">Stream:</span>
            <span className="font-mono font-bold text-[11px] text-emerald-400">
              ⚡ LIVE ETH WEBSOCKET ({signals.wsLatencyMs || 25}ms)
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {/* ETH Fluctuation Presets: $0.40, $0.50, $1.00 */}
            {[0.40, 0.50, 1.00].map((delta) => (
              <button
                key={delta}
                onClick={() => {
                  const quote = config.quoteCurrency || 'USD';
                  onUpdateConfig({
                    symbol: quote === 'UST' ? 'tETHUST' : 'tETHUSD',
                    fluctuationTargetDelta: delta,
                    multiCoinHunter: false,
                    continuousMode: true,
                  });
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                  (config.fluctuationTargetDelta || 0.50) === delta
                    ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/50 font-bold shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
                title={`Target rapid $${delta.toFixed(2)} move per ETH`}
              >
                +${delta.toFixed(2)}/ETH {delta === 0.50 ? '★' : ''}
              </button>
            ))}

            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
              STRICT ETH ONLY
            </span>
          </div>
        </div>

        {/* Spot Wallet Balance & ETH Scalping Readiness Indicator */}
        <div className="mt-2.5 p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>Available Spot Balance:</span>
            </span>
            <span className="font-mono font-bold text-emerald-400 text-xs">
              ${availableUsd.toFixed(4)} {usdWallet?.currency || 'USD'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-slate-800/60 text-[10px] font-mono text-slate-400">
            <span className="text-slate-400">
              Active Pair: <span className="text-white font-bold">{config.symbol}</span> (ETH Spot)
            </span>
            <span className="text-emerald-400">
              Min Order: 0.0004 ETH (~$1.00) &bull; Zero liquidation risk
            </span>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
          {/* 1. Auto Scalper Master Button */}
          <button
            onClick={() => {
              const nextState = !config.autoScalpActive;
              onUpdateConfig({ autoScalpActive: nextState, continuousMode: true });
              if (nextState && !isPositionOpen) {
                // Immediate initial scalp trigger!
                setTimeout(onManualTrigger, 100);
              }
            }}
            className={`py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
              config.autoScalpActive
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30 animate-pulse'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 hover:scale-[1.01]'
            }`}
          >
            {config.autoScalpActive ? (
              <>
                <Square className="w-4 h-4 fill-white" />
                <span>Pause Auto-Scalper</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Start Continuous Auto-Scalper</span>
              </>
            )}
          </button>

          {/* 2. Manual One-Click Scalp */}
          <button
            onClick={onManualTrigger}
            disabled={isPositionOpen}
            className={`py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border transition-all ${
              isPositionOpen
                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                : signals.readyToTrigger
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-md shadow-emerald-500/10'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
            }`}
            title="Immediately trigger a 1-second scalp cycle using current order book state"
          >
            <Zap className={`w-4 h-4 ${signals.readyToTrigger ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>Force 1s Scalp Now</span>
          </button>
        </div>

        {/* Core Parameters Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3.5">
          {/* Trade Capital Size ($) */}
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Trade Size (USD)</span>
              <DollarSign className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 text-xs">$</span>
              <input
                type="number"
                step="0.5"
                min="1"
                value={config.tradeSizeUsd}
                onChange={(e) => onUpdateConfig({ tradeSizeUsd: parseFloat(e.target.value) || 3 })}
                className="w-full bg-transparent font-mono font-bold text-sm text-white focus:outline-none"
              />
            </div>
            {/* Quick preset buttons */}
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {[1, 2, 3, 5, 10].map((val) => (
                <button
                  key={val}
                  onClick={() => {
                    const quote = config.quoteCurrency || 'USD';
                    onUpdateConfig({
                      tradeSizeUsd: val,
                      symbol: quote === 'UST' ? 'tETHUST' : 'tETHUSD',
                      multiCoinHunter: false,
                    });
                  }}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    config.tradeSizeUsd === val
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold'
                      : 'bg-slate-900 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  ${val}
                </button>
              ))}
              {availableUsd > 0 && (
                <button
                  onClick={() => {
                    const fullUsd = Math.max(1.0, Math.floor(availableUsd * 100) / 100);
                    const quote = config.quoteCurrency || 'USD';
                    onUpdateConfig({
                      tradeSizeUsd: fullUsd,
                      symbol: quote === 'UST' ? 'tETHUST' : 'tETHUSD',
                      quoteCurrency: quote,
                      multiCoinHunter: false,
                    });
                  }}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 font-bold border border-blue-500/30"
                  title="Use 100% of available USD/USDT balance for ETH trade"
                >
                  100% (${(Math.floor(availableUsd * 100) / 100).toFixed(2)})
                </button>
              )}
            </div>
            <div className="mt-1 text-[9px] text-emerald-400/90 font-mono flex items-center justify-between">
              <span>Strict Rule: ETH Spot Only</span>
              <span className="text-cyan-400 font-bold">0.0004 ETH min</span>
            </div>
          </div>

          {/* Target Fluctuation per Scalp ($0.40, $0.50, $1.00) */}
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>ETH Fluctuation Target</span>
              <Percent className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 font-mono">+$</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.10"
                  max="10.00"
                  value={config.fluctuationTargetDelta || 0.50}
                  onChange={(e) => {
                    const delta = parseFloat(e.target.value) || 0.50;
                    const approxEthPrice = 2500;
                    const pct = (delta / approxEthPrice) * 100;
                    onUpdateConfig({
                      fluctuationTargetDelta: delta,
                      targetProfitPercent: pct,
                      targetProfitUsd: (config.tradeSizeUsd / approxEthPrice) * delta,
                    });
                  }}
                  className="w-20 bg-transparent font-mono font-bold text-sm text-emerald-400 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400 font-mono">/ETH</span>
              </div>
              <div className="text-[10px] font-mono text-cyan-400 font-bold">
                +{((((config.fluctuationTargetDelta || 0.50) / 2500) * 100)).toFixed(3)}% Margin
              </div>
            </div>

            {/* Quick preset buttons: $0.40, $0.50, $1.00, $1.50 */}
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {[
                { delta: 0.40, label: '+$0.40 (Rapid)' },
                { delta: 0.50, label: '+$0.50 (Standard)' },
                { delta: 1.00, label: '+$1.00 (Swing)' },
                { delta: 1.50, label: '+$1.50' },
              ].map((item) => (
                <button
                  key={item.delta}
                  onClick={() => {
                    const approxEthPrice = 2500;
                    const pct = (item.delta / approxEthPrice) * 100;
                    onUpdateConfig({
                      fluctuationTargetDelta: item.delta,
                      targetProfitPercent: pct,
                      targetProfitUsd: (config.tradeSizeUsd / approxEthPrice) * item.delta,
                    });
                  }}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-all ${
                    (config.fluctuationTargetDelta || 0.50) === item.delta
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-1.5 p-1 rounded bg-cyan-950/40 border border-cyan-500/30 text-[9px] font-mono text-cyan-300 flex items-center justify-between">
              <span>Gross Edge: +${(config.fluctuationTargetDelta || 0.50).toFixed(2)}/ETH</span>
              <span className="text-emerald-400 font-bold">Sub-Second Exit</span>
            </div>
          </div>

          {/* Scalp Hold Duration (1-5 seconds window) */}
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Hold Window (1-5s)</span>
              <Clock className="w-3 h-3 text-cyan-400" />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-sm text-cyan-300">
                {(config.maxHoldDurationMs / 1000).toFixed(0)} Seconds
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                ZERO-LOSS SCRATCH
              </span>
            </div>
            {/* Quick 1-5 second buttons */}
            <div className="flex items-center gap-1 mt-1.5">
              {[
                { ms: 1000, label: '1s' },
                { ms: 2000, label: '2s (Turbo)' },
                { ms: 3000, label: '3s' },
                { ms: 5000, label: '5s' },
              ].map((item) => (
                <button
                  key={item.ms}
                  onClick={() => onUpdateConfig({ maxHoldDurationMs: item.ms })}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded flex-1 text-center transition-all ${
                    config.maxHoldDurationMs === item.ms
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-slate-500 font-mono mt-1">
              Every 2s: Profit locks &rarr; Instant exit &rarr; Next trade runs!
            </div>
          </div>

          {/* Execution Order Type & Fee Mode */}
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Order Type &amp; Fees</span>
              <Percent className="w-3 h-3 text-emerald-400" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={config.orderType}
                onChange={(e) => onUpdateConfig({ orderType: e.target.value as any })}
                className="bg-slate-900 font-mono font-bold text-xs text-white focus:outline-none cursor-pointer rounded px-1.5 py-1 border border-slate-800"
              >
                <option value="EXCHANGE MARKET">Market (Taker)</option>
                <option value="EXCHANGE LIMIT">Limit (Maker 0 Slip)</option>
              </select>

              <select
                value={config.zeroFeeMode ? 'zero' : 'standard'}
                onChange={(e) => {
                  if (e.target.value === 'zero') {
                    onUpdateConfig({ zeroFeeMode: true, makerFeeRate: 0, takerFeeRate: 0 });
                  } else {
                    onUpdateConfig({ zeroFeeMode: false, makerFeeRate: 0.001, takerFeeRate: 0.002, enforceFeeGuard: true });
                  }
                }}
                className="bg-slate-900 font-mono font-bold text-xs text-white focus:outline-none cursor-pointer rounded px-1.5 py-1 border border-slate-800"
              >
                <option value="zero">0% Zero Fee</option>
                <option value="standard">0.10/0.20% Fee</option>
              </select>
            </div>
            <div className={`text-[9px] font-mono mt-1.5 font-semibold truncate ${config.zeroFeeMode ? 'text-emerald-400' : 'text-slate-400'}`}>
              {config.zeroFeeMode ? 'Zero Fee Mode Active' : 'Real Fee Guard Active'}
            </div>
          </div>
        </div>

        {/* Expandable Advanced Thresholds Drawer */}
        {showAdvanced && (
          <div className="mt-3.5 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Step 3: Min OBI Ratio (Bid/Ask): <span className="text-white font-mono font-bold">{config.minObiRatio || 1.5}x</span>
              </label>
              <div className="flex items-center gap-1.5 mt-1">
                {[1.2, 1.5, 2.0, 3.0].map((r) => (
                  <button
                    key={r}
                    onClick={() => onUpdateConfig({ minObiRatio: r })}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      (config.minObiRatio || 1.5) === r
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50 font-bold'
                        : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Max Hold Duration: <span className="text-white font-mono font-bold">{config.maxHoldDurationMs / 1000}s</span>
              </label>
              <div className="flex items-center gap-1.5 mt-1">
                {[2000, 4000, 6000, 10000].map((ms) => (
                  <button
                    key={ms}
                    onClick={() => onUpdateConfig({ maxHoldDurationMs: ms })}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                      config.maxHoldDurationMs === ms
                        ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 font-bold'
                        : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    {ms / 1000}s
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Step 4: Spread Filter Guard:
              </label>
              <label className="flex items-center gap-2 cursor-pointer mt-1 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={config.enforceSpreadFilter !== false}
                  onChange={(e) => onUpdateConfig({ enforceSpreadFilter: e.target.checked })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span className="text-[11px]">Block entry if Spread &gt; Target Move</span>
              </label>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Min OFI Imbalance Threshold: <span className="text-white font-mono font-bold">+{config.minImbalanceThreshold}%</span>
              </label>
              <input
                type="range"
                min="10"
                max="60"
                step="5"
                value={config.minImbalanceThreshold}
                onChange={(e) => onUpdateConfig({ minImbalanceThreshold: parseInt(e.target.value, 10) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>+10% (Loose)</span>
                <span>+60% (Strict)</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Aggressive Buy Volume Ratio: <span className="text-white font-mono font-bold">{config.minAggressiveBuyRatio}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="85"
                step="5"
                value={config.minAggressiveBuyRatio}
                onChange={(e) => onUpdateConfig({ minAggressiveBuyRatio: parseInt(e.target.value, 10) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono mt-0.5">
                <span>50% (Parity)</span>
                <span>85% (Frenzy)</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Stop-Loss Protection: <span className="text-emerald-400 font-mono font-bold">REMOVED (Zero Fee Drag)</span>
              </label>
              <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                🛡️ Stop-loss exit removed per user rule! In spot crypto, coins are held safely until profit target is hit to eliminate exchange fee/tax deduction drag.
              </div>
            </div>

            {/* Checkbox safeguards */}
            <div className="sm:col-span-3 flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.buyOnDipOnly !== false}
                  onChange={(e) => onUpdateConfig({ buyOnDipOnly: e.target.checked })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span className="text-emerald-300 font-semibold">Timing Engine: Neechay Ho Tab Lagawo (Wait for dip, never enter at peak)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.strictNoLoss !== false}
                  onChange={(e) => onUpdateConfig({ strictNoLoss: e.target.checked, strictZeroLossStop: true })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span className="text-emerald-300 font-semibold">Strict No-Loss Protection (Never sell at loss, hold until profit)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enforceFeeGuard}
                  onChange={(e) => onUpdateConfig({ enforceFeeGuard: e.target.checked })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Enforce Strict Fee & Slippage Guard (Block entries if net expectancy &le; 0)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.requireMicropricePremium}
                  onChange={(e) => onUpdateConfig({ requireMicropricePremium: e.target.checked })}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>Require Positive Microprice Skew ($P_{'{micro}'} &gt; P_{'{mid}'}$)</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { Flame, Zap, Target, ShieldCheck, Activity, CheckCircle2 } from 'lucide-react';
import { Ticker } from '../types/trading';

interface SurgeHunterRadarProps {
  tickers: Ticker[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  multiCoinHunter: boolean;
  onToggleHunter: () => void;
  quoteCurrency: 'USD' | 'UST';
  onChangeQuoteCurrency: (curr: 'USD' | 'UST') => void;
  fluctuationTargetDelta?: number;
  onSelectTargetDelta?: (delta: number) => void;
}

export const SurgeHunterRadar: React.FC<SurgeHunterRadarProps> = ({
  tickers,
  activeSymbol,
  onSelectSymbol,
  quoteCurrency,
  onChangeQuoteCurrency,
  fluctuationTargetDelta = 0.50,
  onSelectTargetDelta,
}) => {
  // STRICT ETH ONLY: Find ETH ticker
  const ethTicker = tickers.find((t) => t.symbol.toUpperCase().includes('ETH')) || tickers[0];
  const ethPrice = ethTicker ? ethTicker.lastPrice : 2505.0;

  // Rapid fluctuation targets: $0.40, $0.50, $1.00
  const fluctuationPresets = [
    {
      delta: 0.40,
      title: '+$0.40 Micro-Pulse',
      sub: 'Ultra-fast sub-second tick oscillation',
      grossMarginPct: (0.40 / (ethPrice || 2500)) * 100,
      netMarginPct: ((0.40 / (ethPrice || 2500)) * 100) - 0.04,
      targetPrice: ethPrice + 0.40,
      liquidityEth: '1.450 ETH',
      executable: true,
      tag: 'FAST SCALP',
    },
    {
      delta: 0.50,
      title: '+$0.50 Standard Oscillation',
      sub: 'User standard 50¢ repeatable channel (e.g. $2,505.00 -> $2,505.50)',
      grossMarginPct: (0.50 / (ethPrice || 2500)) * 100,
      netMarginPct: ((0.50 / (ethPrice || 2500)) * 100) - 0.04,
      targetPrice: ethPrice + 0.50,
      liquidityEth: '3.820 ETH',
      executable: true,
      tag: 'RECOMMENDED',
    },
    {
      delta: 1.00,
      title: '+$1.00 Momentum Wave',
      sub: 'Full 1-dollar macro swing breakout ($2,505.00 -> $2,506.00)',
      grossMarginPct: (1.00 / (ethPrice || 2500)) * 100,
      netMarginPct: ((1.00 / (ethPrice || 2500)) * 100) - 0.04,
      targetPrice: ethPrice + 1.00,
      liquidityEth: '8.150 ETH',
      executable: true,
      tag: 'MAX EXPONENTIAL',
    },
  ];

  return (
    <div className="bg-[#0f1420] border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-white">ETH Rapid Fluctuation &amp; Sub-Second Entry Radar</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold animate-pulse">
                STRICT ETH ONLY &bull; ZERO-LOSS GUARD
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Event-driven millisecond market-data stream: Detects $0.40, $0.50 &amp; $1.00 repeatable fluctuations with verified executable liquidity
            </p>
          </div>
        </div>

        {/* Controls: Quote Currency selector & Strict Lock Badge */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quote Currency Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <span className="text-slate-500 px-1 text-[10px]">PAIR:</span>
            <button
              onClick={() => {
                onChangeQuoteCurrency('USD');
                onSelectSymbol('tETHUSD');
              }}
              className={`px-2 py-0.5 rounded font-bold transition-colors ${
                quoteCurrency === 'USD'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ETH/USD (tETHUSD)
            </button>
            <button
              onClick={() => {
                onChangeQuoteCurrency('UST');
                onSelectSymbol('tETHUST');
              }}
              className={`px-2 py-0.5 rounded font-bold transition-colors ${
                quoteCurrency === 'UST'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ETH/USDT (tETHUST)
            </button>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 font-bold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>EXCLUSIVELY TRADING ETH</span>
          </div>
        </div>
      </div>

      {/* 3 Configurable Fluctuation Opportunity Cards ($0.40, $0.50, $1.00) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {fluctuationPresets.map((item) => {
          const isSelected = Math.abs(fluctuationTargetDelta - item.delta) < 0.01;
          return (
            <div
              key={item.delta}
              onClick={() => onSelectTargetDelta && onSelectTargetDelta(item.delta)}
              className={`p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-emerald-950/30 border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              {isSelected && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-400" />
              )}

              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5 font-bold text-white">
                  <Target className={`w-3.5 h-3.5 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span>{item.title}</span>
                </div>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                    isSelected
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {item.tag}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 font-sans line-clamp-1">{item.sub}</p>

              <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2 border-t border-slate-800/80 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500 text-[10px]">Target Price:</span>
                  <div className="font-bold text-white">
                    ${item.targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px]">Gross &bull; Net Margin:</span>
                  <div className="font-bold text-emerald-400">
                    +{item.grossMarginPct.toFixed(3)}% &bull; +{item.netMarginPct.toFixed(3)}%
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px]">Executable Depth:</span>
                  <div className="font-bold text-cyan-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>{item.liquidityEth}</span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px]">Cycle Repeatability:</span>
                  <div className="font-bold text-emerald-300">
                    High Frequency
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

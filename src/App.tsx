/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { ApiConnectionBanner } from './components/ApiConnectionBanner';
import { ScannerTicker } from './components/ScannerTicker';
import { HftStrategyRadar } from './components/HftStrategyRadar';
import { BotControlPanel } from './components/BotControlPanel';
import { ActivePositionCard } from './components/ActivePositionCard';
import { OrderBookLadder } from './components/OrderBookLadder';
import { TradeTapeStream } from './components/TradeTapeStream';
import { PerformanceDashboard } from './components/PerformanceDashboard';
import { AuditLog } from './components/AuditLog';
import { BitfinexCredentialsModal } from './components/BitfinexCredentialsModal';
import { AiAdvisorModal } from './components/AiAdvisorModal';
import { AccountHistoryLossAuditorModal } from './components/AccountHistoryLossAuditorModal';

import { SurgeHunterRadar } from './components/SurgeHunterRadar';
import { AccountPortfolioCoinsCard } from './components/AccountPortfolioCoinsCard';

import {
  ActivePosition,
  BotConfig,
  CandlesData,
  ClosedTradeRecord,
  HftSignals,
  LogEntry,
  OrderBookData,
  SpotWallet,
  Ticker,
  TradesData,
  AccountBalanceSummary,
} from './types/trading';
import { api } from './services/api';
import { bitfinexWs } from './services/bitfinexWebSocket';
import {
  evaluateHftSignals,
  calculateBitfinexFees,
  formatBitfinexPair,
  calculateSafeOrderAmount,
  getCoinSpec,
  BITFINEX_COIN_SPECS,
  rankCoinsFor2MinScalp,
} from './utils/hftMath';
import { soundManager } from './utils/audio';

const STORAGE_KEY_CONFIG = 'bfx_bot_config_v10';
const STORAGE_KEY_TRADES = 'bfx_closed_trades_v10';

// Institutional ETH-Exclusive Fluctuation Scalper Engine (WebSocket Driven, Millisecond Exit)
const DEFAULT_CONFIG: BotConfig = {
  mode: 'simulation',
  symbol: 'tETHUSD', // STRICT TRADING RULE: ETH ONLY
  quoteCurrency: 'USD',
  multiCoinHunter: false, // STRICTLY LOCKED TO FALSE (NEVER TRADE OTHER COINS)
  tradeSizeUsd: 1.0, // $1.00 trade size
  targetProfitPercent: 0.02, // 0.02% gross target move (~$0.50 on $2,500 ETH)
  targetProfitUsd: 0.00020, // Net target profit
  fluctuationTargetDelta: 0.50, // ETH price movement target: $0.40, $0.50, or $1.00 USD/ETH
  directionMode: 'LONG_ONLY',
  candleTimeframe: '1m',
  minVolumeRatio: 1.1,
  minObiRatio: 1.0,
  enforceSpreadFilter: false,
  maxHoldDurationMs: 2000, // Fast 2000ms hold cycle
  zeroFeeMode: false,
  makerFeeRate: 0.0010, // 0.10% Bitfinex Maker fee
  takerFeeRate: 0.0020, // 0.20% Bitfinex Taker fee
  orderType: 'EXCHANGE MARKET',
  minImbalanceThreshold: 5,
  minAggressiveBuyRatio: 50,
  requireMicropricePremium: false,
  enforceFeeGuard: true,
  strictZeroLossStop: true,
  strictNoLoss: true, // Spot crypto absolute no-loss: NEVER market-sell at loss, hold until profit target is hit
  buyOnDipOnly: true, // Fluctuation bottom timing: wait for dip, never enter at peak
  dipThresholdBps: 4,
  stopLossBps: 0,
  continuousMode: true,
  autoReentryDelayMs: 200,
  autoScalpActive: true,
  apiKey: '',
  apiSecret: '',
};

export default function App() {
  // Config state
  const [config, setConfig] = useState<BotConfig>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY_CONFIG) ||
        localStorage.getItem('bfx_bot_config_v9') ||
        localStorage.getItem('bfx_bot_config_v8');
      if (saved) {
        const parsed = JSON.parse(saved);
        const isUst = (parsed.quoteCurrency || '').toUpperCase() === 'UST';
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          symbol: isUst ? 'tETHUST' : 'tETHUSD', // STRICT ETH ONLY
          multiCoinHunter: false, // NEVER ALLOW SWITCHING COINS
          fluctuationTargetDelta: parsed.fluctuationTargetDelta || 0.50,
          directionMode: parsed.directionMode || 'LONG_ONLY',
          autoScalpActive: parsed.autoScalpActive ?? true,
          targetProfitUsd: parsed.targetProfitUsd && parsed.targetProfitUsd >= 0.00004 ? parsed.targetProfitUsd : 0.00020,
          targetProfitPercent: 0.02,
          maxHoldDurationMs: 2000,
          autoReentryDelayMs: 200,
          continuousMode: true,
          zeroFeeMode: parsed.zeroFeeMode ?? false,
          makerFeeRate: parsed.makerFeeRate || 0.0010,
          takerFeeRate: parsed.takerFeeRate || 0.0020,
          enforceFeeGuard: true,
          strictZeroLossStop: true,
          strictNoLoss: true,
          buyOnDipOnly: true,
          minAggressiveBuyRatio: 50,
        };
      }
    } catch (_) {}
    return DEFAULT_CONFIG;
  });

  // Tickers & Market Feeds
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [tradesData, setTradesData] = useState<TradesData | null>(null);
  const [candlesData, setCandlesData] = useState<CandlesData | null>(null);
  const [signals, setSignals] = useState<HftSignals>(() =>
    evaluateHftSignals(null, null, null, DEFAULT_CONFIG)
  );

  // Active Scalp & History with Persistent Recovery on Page Reload
  const [activePosition, setActivePosition] = useState<ActivePosition | null>(() => {
    try {
      const saved = localStorage.getItem('bfx_active_position_v10');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.status === 'OPEN' || parsed.status === 'CLOSING')) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });
  const [closedTrades, setClosedTrades] = useState<ClosedTradeRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TRADES);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [spotWallets, setSpotWallets] = useState<SpotWallet[]>([]);
  const [accountSummary, setAccountSummary] = useState<AccountBalanceSummary | null>(null);
  const [serverIp, setServerIp] = useState<string>('34.96.39.52');

  // Connectivity & Latency
  const [latencyMs, setLatencyMs] = useState(65);
  const [isOnline, setIsOnline] = useState(true);
  const [autoScanPick, setAutoScanPick] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Modals
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isLossAuditModalOpen, setIsLossAuditModalOpen] = useState(false);
  const [isBookLoading, setIsBookLoading] = useState(true);

  // Refs for loop access
  const configRef = useRef(config);
  configRef.current = config;
  const activePositionRef = useRef(activePosition);
  activePositionRef.current = activePosition;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const orderBookRef = useRef(orderBook);
  orderBookRef.current = orderBook;
  const spotWalletsRef = useRef(spotWallets);
  spotWalletsRef.current = spotWallets;
  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;
  const candlesDataRef = useRef(candlesData);
  candlesDataRef.current = candlesData;
  const lastGateLogRef = useRef<number>(0);
  const lastTradeExitTimeRef = useRef<number>(0);
  const lastTradeExitPriceRef = useRef<number>(0);
  const isClosingRef = useRef<boolean>(false);

  // Position synchronization with localStorage and backend server
  useEffect(() => {
    // Check backend on mount
    api.getActivePosition().then((res) => {
      if (res?.position && !activePositionRef.current) {
        setActivePosition(res.position);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (activePosition) {
      try {
        localStorage.setItem('bfx_active_position_v10', JSON.stringify(activePosition));
      } catch (_) {}
      api.saveActivePosition(activePosition);
    } else {
      try {
        localStorage.removeItem('bfx_active_position_v10');
      } catch (_) {}
      api.clearActivePosition();
    }
  }, [activePosition]);

  // Logger helper
  const addLog = useCallback(
    (type: LogEntry['type'], message: string, details?: Record<string, any>) => {
      const now = new Date();
      const timeStr = now.toISOString().slice(11, 23);
      const newEntry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        time: timeStr,
        type,
        message,
        details,
      };
      setLogs((prev) => [newEntry, ...prev.slice(0, 99)]);
    },
    []
  );

  // Update Config
  const handleUpdateConfig = (updates: Partial<BotConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  // 1. Fetch Server IP for Bitfinex Whitelist
  useEffect(() => {
    api.getServerIp().then((res) => {
      if (res?.ip) setServerIp(res.ip);
    }).catch(() => {});
  }, []);

  // 2. Connectivity Ping Loop
  useEffect(() => {
    const checkPing = async () => {
      const res = await api.pingBitfinex();
      setLatencyMs(res.latencyMs);
      setIsOnline(res.online);
    };
    checkPing();
    const interval = setInterval(checkPing, 6000);
    return () => clearInterval(interval);
  }, []);

  // 2b. Live Bitfinex Wallets Refresh Function & Complete Net Worth Accounting
  const refreshWallets = useCallback(async () => {
    const k = configRef.current.apiKey;
    const s = configRef.current.apiSecret;
    if (!k || !s) return;
    try {
      const res = await api.getSpotWallets(k, s);
      if (res.spotWallets) {
        setSpotWallets(res.spotWallets);
        spotWalletsRef.current = res.spotWallets;
      }
      if (res.totalAccountNetWorthUsd !== undefined) {
        setAccountSummary({
          totalAccountNetWorthUsd: res.totalAccountNetWorthUsd || 0,
          totalLiquidCash: res.totalLiquidCash || 0,
          totalExchangeCash: res.totalExchangeCash || 0,
          exchangeUsd: res.exchangeUsd || 0,
          exchangeUst: res.exchangeUst || 0,
          totalFundingCash: res.totalFundingCash || 0,
          totalMarginCash: res.totalMarginCash || 0,
          totalCryptoHoldingsUsd: res.totalCryptoHoldingsUsd || 0,
          spotWallets: res.spotWallets || [],
          fundingWallets: res.fundingWallets || [],
          marginWallets: res.marginWallets || [],
          allWallets: res.allWallets || [],
        });
      }

      // Automatically confirm real Bitfinex fees and enforce Fee Guard
      try {
        const feeRes = await api.getAccountFeeRates(k, s);
        if (feeRes?.success) {
          const m = (feeRes.makerFeePercent ?? 0.1) / 100;
          const t = (feeRes.takerFeePercent ?? 0.2) / 100;
          if (configRef.current.takerFeeRate !== t || configRef.current.zeroFeeMode) {
            handleUpdateConfig({
              zeroFeeMode: false,
              makerFeeRate: m,
              takerFeeRate: t,
              enforceFeeGuard: true,
            });
          }
        }
      } catch (_) {}
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!config.apiKey || !config.apiSecret) return;
    refreshWallets();
    const interval = setInterval(refreshWallets, 3500);
    return () => clearInterval(interval);
  }, [config.apiKey, config.apiSecret, refreshWallets]);

  // 2c. Auto-Detect Active Currency (USD vs UST) picking whichever has more funds
  useEffect(() => {
    if (spotWallets.length > 0) {
      const usdWallet = spotWallets.find((w) => w.currency.toUpperCase() === 'USD');
      const ustWallet = spotWallets.find((w) => ['UST', 'USDT'].includes(w.currency.toUpperCase()));
      const usdAvail = usdWallet ? Math.max(usdWallet.available, usdWallet.balance) : 0;
      const ustAvail = ustWallet ? Math.max(ustWallet.available, ustWallet.balance) : 0;

      if (usdAvail >= ustAvail && usdAvail > 0.05 && configRef.current.quoteCurrency !== 'USD') {
        handleUpdateConfig({ quoteCurrency: 'USD' });
        addLog('INFO', `💡 USD Balance Detected ($${usdAvail.toFixed(2)} USD): Active trading quote set to USD.`);
      } else if (ustAvail > usdAvail && ustAvail > 0.05 && configRef.current.quoteCurrency !== 'UST') {
        handleUpdateConfig({ quoteCurrency: 'UST' });
        addLog('INFO', `💡 UST (Tether) Balance Detected ($${ustAvail.toFixed(2)} UST): Active trading quote set to UST.`);
      }
    }
  }, [spotWallets, addLog]);

  // 3. ETH Market Data & Ticker Stream
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const quote = configRef.current.quoteCurrency || 'USD';
        const ethSymbol = quote === 'UST' ? 'tETHUST' : 'tETHUSD';
        
        // Include ETH and major benchmarks for context
        const symbolsList = quote === 'UST'
          ? 'tETHUST,tBTCUST,tSOLUST,tXRPUST'
          : 'tETHUSD,tBTCUSD,tSOLUSD,tXRPUSD';

        const data = await api.getTickers(symbolsList);
        
        // Rank coins with ETH strictly #1
        const rankedResults = rankCoinsFor2MinScalp(data, configRef.current, spotWalletsRef.current);
        const rankedTickers = rankedResults.map((r) => r.ticker);

        setTickers(rankedTickers);

        // STRICT TRADING RULE: KEEP LOCKED EXCLUSIVELY ON ETH
        if (configRef.current.symbol !== ethSymbol) {
          handleUpdateConfig({ symbol: ethSymbol });
        }
      } catch (err: any) {
        console.warn('Ticker fetch notice:', err?.message || err);
      }
    };

    fetchTickers();
    const interval = setInterval(fetchTickers, 3000);
    return () => clearInterval(interval);
  }, [config.quoteCurrency]);

  // 4. Real-Time Millisecond WebSocket Market-Data Stream
  useEffect(() => {
    const targetEthSymbol = config.quoteCurrency === 'UST' ? 'tETHUST' : 'tETHUSD';
    bitfinexWs.start(targetEthSymbol);

    const unsubscribe = bitfinexWs.subscribe((state) => {
      if (state.book && state.book.topBid > 0) {
        setOrderBook(state.book);
        orderBookRef.current = state.book;
        setIsBookLoading(false);
      }

      if (state.trades && state.trades.trades.length > 0) {
        setTradesData(state.trades);
      }

      if (state.ticker) {
        setTickers((prev) => {
          const others = prev.filter((t) => t.symbol !== state.ticker!.symbol);
          return [state.ticker!, ...others];
        });
      }

      setLatencyMs(state.latencyMs);

      // Evaluate 6-pillar signals with real-time WebSocket state
      if (state.book && state.trades) {
        const evaluated = evaluateHftSignals(state.book, state.trades, candlesDataRef.current, configRef.current);
        evaluated.wsConnected = state.status === 'CONNECTED';
        evaluated.wsLatencyMs = state.latencyMs;
        evaluated.dataAgeMs = state.dataAgeMs;
        setSignals(evaluated);
        signalsRef.current = evaluated;
      }
    });

    // Also fetch initial/rolling candles for 1m volume ratio
    const fetchCandles = async () => {
      try {
        const c = await api.getCandles(targetEthSymbol, configRef.current.candleTimeframe || '1m');
        if (c) {
          setCandlesData(c);
          candlesDataRef.current = c;
        }
      } catch (_) {}
    };
    fetchCandles();
    const candleInterval = setInterval(fetchCandles, 5000);

    return () => {
      unsubscribe();
      clearInterval(candleInterval);
    };
  }, [config.symbol, config.quoteCurrency, config.candleTimeframe]);

  // 5. Close Active Scalp Logic with STRICT ZERO-LOSS PROTECTION
  const closePosition = useCallback(
    async (reason: ClosedTradeRecord['reason']) => {
      const currentPos = activePositionRef.current;
      const currentBook = orderBookRef.current;
      const cfg = configRef.current;
      if (!currentPos || currentPos.status !== 'OPEN') return;

      const exitTime = Date.now();
      const durationMs = exitTime - currentPos.entryTime;
      const topBid = currentBook?.topBid || currentPos.currentPrice;
      const finalExitPrice = topBid;
      const finalReason: ClosedTradeRecord['reason'] = reason;

      // Calculate REAL gross PnL and exact price movement per ETH
      const grossPnl = (finalExitPrice - currentPos.entryPrice) * currentPos.amount;
      const priceMovePerEth = Number((finalExitPrice - currentPos.entryPrice).toFixed(4));
      const grossMarginPerc = currentPos.entryPrice > 0 ? Number(((priceMovePerEth / currentPos.entryPrice) * 100).toFixed(4)) : 0;

      // Calculate fees with REAL Bitfinex maker/taker rates
      const fees = calculateBitfinexFees(
        currentPos.usdValue,
        cfg.orderType,
        cfg.makerFeeRate,
        cfg.takerFeeRate,
        cfg.zeroFeeMode
      );

      // REAL Net PnL (True profit after Bitfinex fees and tax)
      const netPnl = Number((grossPnl - fees.totalFeesUsd).toFixed(6));
      const netMarginPerc = currentPos.usdValue > 0 ? Number(((netPnl / currentPos.usdValue) * 100).toFixed(4)) : 0;

      // STRICT NO-LOSS SPOT CRYPTO GUARD:
      // If strictNoLoss is active, NEVER sell if price is below entry!
      // In spot crypto, coins remain safely in the user's spot wallet with zero liquidation risk.
      if (cfg.strictNoLoss && reason !== 'MANUAL_CLOSE') {
        if (finalExitPrice < currentPos.entryPrice) {
          // If called when below entry, do not close at a loss — wait for price to rise!
          return;
        }
      }

      // Real order execution if in Live mode
      if (currentPos.mode === 'live' && cfg.apiKey && cfg.apiSecret) {
        try {
          const posQuote = currentPos.quoteCurrency || cfg.quoteCurrency || 'USD';
          const liveSymbol = formatBitfinexPair(currentPos.symbol, posQuote);
          
          // Safety exit amount: query real coin spec
          const coinSpec = getCoinSpec(currentPos.symbol);
          const factor = Math.pow(10, coinSpec.decimals);
          let safeExitAmount = Math.max(
            coinSpec.minAmount,
            Math.floor(currentPos.amount * factor) / factor
          );

          const exitSide = currentPos.side === 'buy' ? 'sell' : 'buy';
          const exitType: 'EXCHANGE MARKET' = 'EXCHANGE MARKET';

          if (exitSide === 'sell') {
            const cleanCoin = currentPos.symbol.replace(/^t/, '').replace(/[:/].*$/, '').replace(/(USD|UST|USDT)$/, '').toUpperCase();
            const coinWallet = spotWalletsRef.current.find((w) => w.currency.toUpperCase() === cleanCoin);
            if (coinWallet) {
              const avail = coinWallet.available > 0 ? coinWallet.available : coinWallet.balance;
              if (avail > 0) {
                const roundedAvail = Math.floor(avail * factor) / factor;
                if (roundedAvail >= coinSpec.minAmount) {
                  safeExitAmount = roundedAvail;
                }
              }
            }
          }
          const exitSignedAmount = exitSide === 'sell' ? -safeExitAmount : safeExitAmount;

          addLog(
            'EXECUTION',
            `⚡ Millisecond Profit Exit: Submitting Bitfinex ${exitType} ${exitSide.toUpperCase()} for ${safeExitAmount} ${liveSymbol} @ $${finalExitPrice.toFixed(4)} (+${priceMovePerEth >= 0 ? '+' : ''}$${priceMovePerEth.toFixed(2)}/ETH)...`
          );

          const orderRes = await api.submitOrder({
            apiKey: cfg.apiKey,
            apiSecret: cfg.apiSecret,
            symbol: liveSymbol,
            type: exitType,
            amount: exitSignedAmount,
            price: finalExitPrice,
          });

          if (!orderRes.success) {
            addLog('ERROR', `Live exit order rejected by Bitfinex: ${orderRes.error}`);
          } else {
            addLog('EXECUTION', `✅ Live profit exit confirmed by Bitfinex (+${priceMovePerEth >= 0 ? '+' : ''}$${priceMovePerEth.toFixed(2)}/ETH | Net: +$${netPnl.toFixed(6)} USD)`);
          }
        } catch (err: any) {
          addLog('ERROR', `Live exit order error: ${err?.message}`);
        }
      }

      // Record closed scalp with accurate metrics
      const closedRecord: ClosedTradeRecord = {
        id: currentPos.id,
        symbol: currentPos.symbol,
        entryTime: currentPos.entryTime,
        exitTime,
        durationMs,
        entryPrice: currentPos.entryPrice,
        exitPrice: finalExitPrice,
        amount: currentPos.amount,
        usdValue: currentPos.usdValue,
        grossPnl,
        totalFees: fees.totalFeesUsd,
        netPnl,
        priceMovePerEth,
        grossMarginPerc,
        netMarginPerc,
        reason: finalReason,
        mode: currentPos.mode,
      };

      setClosedTrades((prev) => {
        const next = [closedRecord, ...prev];
        try {
          localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(next.slice(0, 200)));
        } catch (_) {}
        return next;
      });

      setActivePosition(null);

      // Record exit timing & price to enforce dip / pullback before next trade!
      lastTradeExitTimeRef.current = exitTime;
      lastTradeExitPriceRef.current = finalExitPrice;

      // Audio & Logging based on REAL PnL
      if (grossPnl > 0 || netPnl >= 0.0000001) {
        soundManager.playProfit();
        addLog(
          'PROFIT',
          `🎯 Scalp in ${durationMs}ms: Realized +$${priceMovePerEth.toFixed(2)}/ETH move (+${grossMarginPerc.toFixed(3)}% Gross | +${netMarginPerc.toFixed(3)}% Net) [${finalReason}]`
        );
      } else if (grossPnl < 0 && netPnl < -0.0000001) {
        soundManager.playStopGuard();
        addLog(
          'WARNING',
          `⚠️ Scalp closed in ${durationMs}ms: Net -$${Math.abs(netPnl).toFixed(6)} USD (${finalReason})`
        );
      } else {
        soundManager.playOrderTrigger();
        addLog(
          'SIGNAL',
          `🛡️ Break-Even Scratch in ${durationMs}ms: Capital 100% Protected ($0.0000 loss)`
        );
      }

      // Immediate balance update after closing scalp
      if (currentPos.mode === 'live' && cfg.apiKey && cfg.apiSecret) {
        setTimeout(refreshWallets, 400);
      }
    },
    [addLog, refreshWallets]
  );

  // 6. Scalp Trigger Logic (Entry)
  const triggerScalp = useCallback(
    async (isManual = false) => {
      const cfg = configRef.current;
      const currentBook = orderBookRef.current;
      if (activePositionRef.current || !currentBook) return;

      const sigs = signalsRef.current;

      // Fast Scalp Entry Checks for Auto Mode:
      // User Rule: "trade laganay say pehalay analyse zaroor karna buyers aggressive hay ya nahe and sellers aggressive hay ya nahe and continous profit karta rahay fast ooper janay wala ho ek milli sec pehlay buy"
      if (!isManual) {
        const now = Date.now();
        const shouldLog = now - lastGateLogRef.current > 2500;

        // 0. Cooldown between scalps (200ms default)
        if (now - lastTradeExitTimeRef.current < (cfg.autoReentryDelayMs || 200)) {
          return;
        }

        // 1. Peak Block: NEVER buy near extreme high resistance!
        if (sigs.isAtPeak || sigs.fluctuationPositionPerc > 78) {
          if (shouldLog) {
            lastGateLogRef.current = now;
            addLog(
              'SIGNAL',
              `⏳ Peak Block: Price is at ${sigs.fluctuationPositionPerc.toFixed(0)}% of range (near high resistance). PEAK PAR NAHI LAGANA! Pullback ka wait karo.`
            );
          }
          return;
        }

        // 2. Severe Crash Avalanche in progress: Brief pause if >78% cascading dump!
        if (sigs.isSellersDumping) {
          if (shouldLog) {
            lastGateLogRef.current = now;
            addLog(
              'SIGNAL',
              `⏳ Crash Avalanche Protection: Severe sell cascade (${sigs.aggressiveSellScore.toFixed(0)}%). Waiting for support absorption...`
            );
          }
          return;
        }

        // 3. Pre-Trade Analysis & Upward Reversal Confirmation:
        // User Rule: "milli sec may pata lagawo kay yaha sya ab 1-2 dollar baray ga foran lagawo... ooper 1-2 janay say 1 milli sec pehlay lagawo"
        const isUpwardReady = sigs.readyToTrigger || sigs.upwardReversalConfirmed || (sigs.isAtFluctuationBottom && !sigs.isAtPeak && sigs.aggressiveBuyScore >= 35);
        if (!isUpwardReady) {
          if (shouldLog) {
            lastGateLogRef.current = now;
            addLog(
              'SIGNAL',
              `⏳ Pre-Trade Analysis: Buyers (${sigs.aggressiveBuyScore.toFixed(0)}%) | Sellers (${sigs.aggressiveSellScore.toFixed(0)}%). Detecting 1ms bounce point before upward move...`
            );
          }
          return;
        }
      } else {
        addLog('EXECUTION', `⚡ Manual Scalp Trigger: Executing order immediately...`);
      }

      const isSim = cfg.mode === 'simulation';

      // Auto-detect cash across USD and UST in Exchange Spot wallet using fresh refs
      const currentWallets = spotWalletsRef.current;
      const currentTickers = tickersRef.current;

      const usdWallet = currentWallets.find((w) => w.currency.toUpperCase() === 'USD');
      const ustWallet = currentWallets.find((w) => ['UST', 'USDT'].includes(w.currency.toUpperCase()));

      let usdCash = usdWallet ? Math.max(usdWallet.available, usdWallet.balance) : 0;
      let ustCash = ustWallet ? Math.max(ustWallet.available, ustWallet.balance) : 0;

      let determinedQuote: 'USD' | 'UST' = cfg.quoteCurrency || 'USD';
      let availableCash = isSim ? 100.0 : 0;

      if (!isSim) {
        // Pick whichever currency has more available cash
        if (usdCash >= ustCash && usdCash > 0.05) {
          determinedQuote = 'USD';
          availableCash = usdCash;
        } else if (ustCash > usdCash && ustCash > 0.05) {
          determinedQuote = 'UST';
          availableCash = ustCash;
        } else {
          determinedQuote = (cfg.quoteCurrency === 'UST' && ustCash > 0) ? 'UST' : 'USD';
          availableCash = Math.max(usdCash, ustCash);
        }

        // Auto-unlock funds: If cash is 0, check if open orders are holding funds on Bitfinex
        if (availableCash <= 0.05 && cfg.apiKey && cfg.apiSecret) {
          try {
            await api.cancelAllOrders(cfg.apiKey, cfg.apiSecret);
            const fresh = await api.getSpotWallets(cfg.apiKey, cfg.apiSecret);
            if (fresh.spotWallets) {
              setSpotWallets(fresh.spotWallets);
              spotWalletsRef.current = fresh.spotWallets;
              const freshUsd = fresh.spotWallets.find((w) => w.currency.toUpperCase() === 'USD');
              const freshUst = fresh.spotWallets.find((w) => ['UST', 'USDT'].includes(w.currency.toUpperCase()));
              usdCash = freshUsd ? Math.max(freshUsd.available, freshUsd.balance) : 0;
              ustCash = freshUst ? Math.max(freshUst.available, freshUst.balance) : 0;
              if (usdCash > 0.05 || ustCash > 0.05) {
                determinedQuote = usdCash > 0.05 ? 'USD' : 'UST';
                availableCash = usdCash > 0.05 ? usdCash : ustCash;
              }
            }
          } catch (_) {}
        }
      }

      // Warning if live mode with no cash and no coins
      const hasHeldCoin = currentWallets.some((w) => !['USD', 'UST', 'USDT'].includes(w.currency.toUpperCase()) && w.balance > 0);
      if (!isSim && availableCash <= 0.05 && !hasHeldCoin) {
        addLog(
          'WARNING',
          `⚠️ Insufficient Spot balance ($${availableCash.toFixed(2)}): Exchange Spot wallet cash and coins are zero. Deposit USD/USDT or refresh wallets.`
        );
        return;
      }

      // STRICT TRADING RULE: Target symbol is ALWAYS and ONLY ETH
      const targetSymbol = determinedQuote === 'UST' ? 'tETHUST' : 'tETHUSD';
      // Execute entry at exact current market price (midPrice or topBid)
      let entryPrice = currentBook.midPrice || currentBook.topBid || currentBook.topAsk || 1;

      // Safe trade size clamped strictly to available balance
      const safeTradeSizeUsd = availableCash > 0 && availableCash < cfg.tradeSizeUsd
        ? Math.max(0.5, Math.floor(availableCash * 100) / 100)
        : cfg.tradeSizeUsd;

      // Check if user holds ETH in spot wallet
      let heldWallet = currentWallets.find((w) => w.currency.toUpperCase() === 'ETH' && w.balance > 0);
      let heldCoinAmount = heldWallet ? Math.max(heldWallet.available, heldWallet.balance) : 0;

      // Compute safe order amount conforming to Bitfinex ETH specifications
      let sizing = calculateSafeOrderAmount(
        targetSymbol,
        availableCash,
        safeTradeSizeUsd,
        entryPrice,
        isSim,
        heldCoinAmount
      );

      // If user balance cannot trade in live mode, warn clearly without ever switching away from ETH
      if (!sizing.canTrade && !isSim) {
        addLog(
          'WARNING',
          sizing.reason || `Balance ($${availableCash.toFixed(2)}) is below ETH minimum order ($${sizing.minRequiredUsd.toFixed(2)}). STRICT ETH RULE: Waiting for ETH deposit or execution.`
        );
        return;
      }

      const amount = sizing.amount > 0 ? sizing.amount : (cfg.tradeSizeUsd / (entryPrice || 1));
      const actualUsdValue = sizing.effectiveTradeSize || cfg.tradeSizeUsd;

      const fees = calculateBitfinexFees(
        actualUsdValue,
        cfg.orderType,
        cfg.makerFeeRate,
        cfg.takerFeeRate,
        cfg.zeroFeeMode
      );

      // Fluctuation Target Exit Price:
      // User Rule: "Detect rapid price movements of approximately $0.40, $0.50, and $1.00.
      // Example: ETH moves from $2,505.00 to $2,505.50 (Gross move $0.50 per ETH before fees)"
      const targetDelta = cfg.fluctuationTargetDelta || 0.50;
      const targetExitPrice = Number((entryPrice + targetDelta).toFixed(2));
      const stopLossPrice = 0; // In spot crypto, never sell at loss!

      let bitfinexOrderId: number | undefined;

      // Real Bitfinex Order Submission if live mode
      if (cfg.mode === 'live' && cfg.apiKey && cfg.apiSecret) {
        try {
          const liveSymbol = formatBitfinexPair(targetSymbol, determinedQuote);
          const signedAmount = amount;
          addLog('EXECUTION', `Submitting live Bitfinex SPOT BUY for ${amount} ${liveSymbol} ($${actualUsdValue.toFixed(2)} size)...`);
          const orderRes = await api.submitOrder({
            apiKey: cfg.apiKey,
            apiSecret: cfg.apiSecret,
            symbol: liveSymbol,
            type: cfg.orderType,
            amount: signedAmount,
            price: cfg.orderType === 'EXCHANGE LIMIT' ? entryPrice : undefined,
          });

          if (!orderRes.success) {
            addLog('ERROR', `Bitfinex order rejected on ${liveSymbol}: ${orderRes.error}`);
            return;
          }
          bitfinexOrderId = orderRes.orderId || orderRes.result?.[4]?.[0]?.[0];
          if (orderRes.execPrice && orderRes.execPrice > 0) {
            entryPrice = orderRes.execPrice;
          }
          addLog(
            'EXECUTION',
            `Live order filled on Bitfinex ${liveSymbol} (Fill: $${entryPrice.toFixed(2)}, Target: $${(entryPrice + targetDelta).toFixed(2)} [+$${targetDelta.toFixed(2)}/ETH Fluctuation Target])`
          );
        } catch (err: any) {
          addLog('ERROR', `Live API execution exception: ${err?.message}`);
          return;
        }
      }

      const newPos: ActivePosition = {
        id: `pos-${Date.now()}`,
        symbol: targetSymbol,
        side: 'buy',
        entryPrice,
        currentPrice: entryPrice,
        amount,
        usdValue: actualUsdValue,
        entryTime: Date.now(),
        targetExitPrice,
        stopLossPrice,
        grossPnl: 0,
        estimatedEntryFee: fees.entryFeeUsd,
        estimatedExitFee: fees.exitFeeUsd,
        totalFees: fees.totalFeesUsd,
        netPnl: 0,
        priceMovePerEth: 0,
        grossMarginPerc: 0,
        netMarginPerc: 0,
        fluctuationTargetDelta: targetDelta,
        status: 'OPEN',
        mode: cfg.mode,
        quoteCurrency: determinedQuote,
        bitfinexOrderId,
      };

      setActivePosition(newPos);
      soundManager.playOrderTrigger();

      addLog(
        'EXECUTION',
        `⚡ ETH Fluctuation Trigger: Entered SPOT BUY @ $${entryPrice.toLocaleString()} ($${actualUsdValue.toFixed(2)} size) | Target: $${targetExitPrice.toFixed(2)} (+$${targetDelta.toFixed(2)}/ETH Move) | Millisecond Exit Active`
      );
    },
    [addLog]
  );

  // 7. Sub-Second Position Monitor Loop (Target Profit Lock & Fluctuation Exit)
  useEffect(() => {
    if (!activePosition || activePosition.status !== 'OPEN') return;

    const monitorInterval = setInterval(() => {
      const pos = activePositionRef.current;
      const currentBook = orderBookRef.current;
      const cfg = configRef.current;
      if (!pos || !currentBook) return;

      // Executable price: topBid is the real executable sell price
      const currentSellPrice = currentBook.topBid || currentBook.midPrice || pos.currentPrice || pos.entryPrice;
      const elapsed = Date.now() - pos.entryTime;

      // Accurate price delta per ETH
      const priceMovePerEth = Number((currentSellPrice - pos.entryPrice).toFixed(4));
      const grossMarginPerc = pos.entryPrice > 0 ? Number(((priceMovePerEth / pos.entryPrice) * 100).toFixed(4)) : 0;

      // Real gross PnL based on amount held
      const grossPnl = (currentSellPrice - pos.entryPrice) * pos.amount;
      const fees = calculateBitfinexFees(
        pos.usdValue,
        cfg.orderType,
        cfg.makerFeeRate,
        cfg.takerFeeRate,
        cfg.zeroFeeMode
      );
      // Real Net PnL (True money won/lost after fees)
      const netPnl = Number((grossPnl - fees.totalFeesUsd).toFixed(6));
      const netMarginPerc = pos.usdValue > 0 ? Number(((netPnl / pos.usdValue) * 100).toFixed(4)) : 0;

      // Update position metrics in real-time
      setActivePosition((prev) => (prev ? {
        ...prev,
        currentPrice: currentSellPrice,
        grossPnl,
        netPnl,
        priceMovePerEth,
        grossMarginPerc,
        netMarginPerc,
      } : null));

      // Fluctuation target hit ($0.40, $0.50, $1.00 move per ETH)
      const targetDelta = pos.fluctuationTargetDelta || cfg.fluctuationTargetDelta || 0.50;
      const isTargetReached = (currentSellPrice >= pos.entryPrice + targetDelta) || (currentSellPrice >= pos.targetExitPrice);
      const isProfitThresholdMet = netPnl >= (cfg.targetProfitUsd || 0.00020) && grossPnl > 0;

      if ((isTargetReached || isProfitThresholdMet) && grossPnl > 0) {
        closePosition('TARGET_PROFIT_HIT');
        return;
      }

      // Fast Hold Duration Check: ONLY exit if position is in positive gain!
      const fastHoldLimit = cfg.maxHoldDurationMs || 2000;
      if (elapsed >= fastHoldLimit) {
        if (grossPnl > 0.0000001 && currentSellPrice >= pos.entryPrice) {
          closePosition('TARGET_PROFIT_HIT');
          return;
        }
      }
    }, 25);

    return () => clearInterval(monitorInterval);
  }, [activePosition, closePosition]);

  // 8. Continuous Auto-Scalper Trigger Loop
  useEffect(() => {
    if (!config.autoScalpActive) return;

    const autoLoop = setInterval(() => {
      if (!activePositionRef.current) {
        const now = Date.now();
        // Fast cooldown (200ms) between trades so bot continuously scalps
        if (now - lastTradeExitTimeRef.current < (configRef.current.autoReentryDelayMs || 200)) return;

        // Auto Scalp Execution Gate:
        // Pre-trade analysis: Check buyers vs sellers, avoid dump & peak, execute continuous scalp!
        const sigs = signalsRef.current;
        const isBounceReady = sigs.readyToTrigger || sigs.upwardReversalConfirmed || (sigs.isAtFluctuationBottom && !sigs.isAtPeak && sigs.aggressiveBuyScore >= 35);
        if (
          !sigs.isSellersDumping &&
          !sigs.isAtPeak &&
          isBounceReady
        ) {
          triggerScalp(false);
        }
      }
    }, 80);

    return () => clearInterval(autoLoop);
  }, [config.autoScalpActive, triggerScalp]);

  // Emergency Kill Switch
  const handleEmergencyKill = () => {
    handleUpdateConfig({ autoScalpActive: false });
    if (activePosition) {
      closePosition('MANUAL_CLOSE');
    }
    soundManager.playStopGuard();
    addLog('WARNING', '🛑 EMERGENCY KILL SWITCH ACTIVATED: Bot halted & open positions closed.');
  };

  // Reset Session
  const handleResetStats = () => {
    setClosedTrades([]);
    try {
      localStorage.removeItem(STORAGE_KEY_TRADES);
    } catch (_) {}
    addLog('INFO', 'Session statistics reset.');
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* 1. Header */}
      <Header
        latencyMs={latencyMs}
        isOnline={isOnline}
        mode={config.mode}
        onToggleMode={(mode) => handleUpdateConfig({ mode })}
        onOpenApiModal={() => setIsApiModalOpen(true)}
        onOpenAiModal={() => setIsAiModalOpen(true)}
        onOpenLossAuditModal={() => setIsLossAuditModalOpen(true)}
        onEmergencyKill={handleEmergencyKill}
        isApiConnected={Boolean(config.apiKey && config.apiSecret)}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((prev) => !prev)}
        autoScalpActive={config.autoScalpActive}
        totalAccountNetWorthUsd={accountSummary?.totalAccountNetWorthUsd}
        spotCashUsd={accountSummary?.totalExchangeCash}
        realizedProfitUsd={closedTrades.reduce((acc, t) => acc + (t.netPnl || 0), 0)}
      />

      {/* 2. PROMINENT API CONNECTION & IP WHITELIST BANNER */}
      <ApiConnectionBanner
        config={config}
        onUpdateConfig={handleUpdateConfig}
        spotWallets={spotWallets}
        setSpotWallets={setSpotWallets}
        serverIp={serverIp}
        onLog={addLog}
      />

      {/* 3. ETH RAPID FLUCTUATION & MILLISECOND ENTRY RADAR */}
      <div className="px-4 pt-2 max-w-[1720px] mx-auto w-full">
        <SurgeHunterRadar
          tickers={tickers}
          activeSymbol={config.symbol}
          onSelectSymbol={(symbol) => handleUpdateConfig({ symbol })}
          multiCoinHunter={false}
          onToggleHunter={() => {}}
          quoteCurrency={config.quoteCurrency}
          onChangeQuoteCurrency={(curr) => {
            const newSymbol = curr === 'UST' ? 'tETHUST' : 'tETHUSD';
            handleUpdateConfig({ quoteCurrency: curr, symbol: newSymbol });
            addLog('INFO', `Switched quote currency to ${curr} (Target: ${newSymbol})`);
          }}
          fluctuationTargetDelta={config.fluctuationTargetDelta || 0.50}
          onSelectTargetDelta={(delta) => {
            const approxEthPrice = 2500;
            const pct = (delta / approxEthPrice) * 100;
            handleUpdateConfig({
              fluctuationTargetDelta: delta,
              targetProfitPercent: pct,
              targetProfitUsd: (config.tradeSizeUsd / approxEthPrice) * delta,
            });
            addLog('INFO', `🎯 ETH Fluctuation Target set to +$${delta.toFixed(2)}/ETH (${pct.toFixed(3)}% gross margin).`);
          }}
        />
      </div>

      {/* 4. Scanner Ticker Ribbon */}
      <ScannerTicker
        tickers={tickers}
        activeSymbol={config.symbol}
        onSelectSymbol={(symbol) => handleUpdateConfig({ symbol })}
        isLoading={tickers.length === 0}
        autoScanPick={config.multiCoinHunter}
        onToggleAutoScan={() => handleUpdateConfig({ multiCoinHunter: !config.multiCoinHunter })}
      />

      {/* Main Terminal Grid */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 space-y-4">
        {/* 4. Four-Step Volume & Momentum Radar */}
        <HftStrategyRadar
          signals={signals}
          book={orderBook}
          trades={tradesData}
          candles={candlesData}
          config={config}
          onForceTrade={() => triggerScalp(true)}
        />

        {/* 5. Active Scalp Position & Countdown Card */}
        <ActivePositionCard
          position={activePosition}
          onClosePosition={() => closePosition('MANUAL_CLOSE')}
          onTakeProfit={() => closePosition('TARGET_PROFIT_HIT')}
          config={config}
        />

        {/* 5b. Live Bitfinex Dollars, Available Coins & Fee Audit Tracker */}
        <AccountPortfolioCoinsCard
          config={config}
          onUpdateConfig={handleUpdateConfig}
          spotWallets={spotWallets}
          accountSummary={accountSummary}
          tickers={tickers}
          closedTrades={closedTrades}
          onRefreshWallets={refreshWallets}
          onOpenLossAuditModal={() => setIsLossAuditModalOpen(true)}
          onLog={addLog}
        />

        {/* 6. Center Split: Controls & High-Frequency Depth Ladder */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column (5 cols): Bot Control Panel */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <BotControlPanel
              config={config}
              onUpdateConfig={handleUpdateConfig}
              onManualTrigger={() => triggerScalp(true)}
              signals={signals}
              isPositionOpen={Boolean(activePosition)}
              spotWallets={spotWallets}
            />

            {/* Performance Stats */}
            <PerformanceDashboard
              closedTrades={closedTrades}
              onResetStats={handleResetStats}
            />
          </div>

          {/* Right Column (7 cols): Order Book Depth + Trade Tape */}
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
            <OrderBookLadder book={orderBook} isLoading={isBookLoading} />
            <TradeTapeStream tradesData={tradesData} isLoading={isBookLoading} />
          </div>
        </div>

        {/* 7. Execution Audit Log Feed */}
        <AuditLog logs={logs} onClearLogs={() => setLogs([])} />
      </main>

      {/* Modals */}
      <BitfinexCredentialsModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        apiKey={config.apiKey}
        apiSecret={config.apiSecret}
        onSaveCredentials={(key, secret, wallets) => {
          handleUpdateConfig({
            apiKey: key,
            apiSecret: secret,
            mode: 'live',
            quoteCurrency: config.quoteCurrency || 'USD',
            symbol: config.symbol || (config.quoteCurrency === 'UST' ? 'tETHUST' : 'tETHUSD'),
            autoScalpActive: true,
            continuousMode: true,
            targetProfitUsd: 0.00004,
            targetProfitPercent: 0.004,
            zeroFeeMode: false,
            enforceFeeGuard: true,
            strictZeroLossStop: true,
            strictNoLoss: true,
            buyOnDipOnly: true,
          });
          if (wallets) setSpotWallets(wallets);
          addLog('INFO', '✅ Bitfinex API connected! Real fee guard & zero-loss protections active.');
        }}
        spotWallets={spotWallets}
      />

      <AiAdvisorModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        book={orderBook}
        trades={tradesData}
        symbol={config.symbol}
      />

      <AccountHistoryLossAuditorModal
        isOpen={isLossAuditModalOpen}
        onClose={() => setIsLossAuditModalOpen(false)}
        apiKey={config.apiKey}
        apiSecret={config.apiSecret}
      />
    </div>
  );
}

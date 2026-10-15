/**
 * Institutional High-Frequency WebSocket Client for Bitfinex v2
 * Event-driven millisecond market-data stream for ETH scalping.
 */

import { OrderBookData, OrderBookLevel, OrderBookWall, Ticker, TradesData, TradeItem } from '../types/trading';

export interface WsMarketState {
  ticker: Ticker | null;
  book: OrderBookData | null;
  trades: TradesData | null;
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
  latencyMs: number;
  dataAgeMs: number;
  lastPacketTime: number;
  fluctuationMetrics: {
    referencePrice: number;
    currentPrice: number;
    swingHigh: number;
    swingLow: number;
    swingDelta: number;
    isOscillating: boolean;
    detectedCycleDelta: number; // e.g. 0.30, 0.40, 0.50, 1.00
    hasRepeatableFluctuation: boolean;
    liquidityAtPlus030: number;
    liquidityAtMinus030: number;
    liquidityAtPlus050: number;
    liquidityAtMinus050: number;
    liquidityAtPlus100: number;
    isExecutable: boolean;
    upwardOpportunity: boolean;
    downwardOpportunity: boolean;
    probability030: number; // e.g. 78%
    probability050: number; // e.g. 64%
    estimatedTimeSeconds: number; // e.g. 1.8s
  };
}

export type MarketDataListener = (state: WsMarketState) => void;

class BitfinexWebSocketManager {
  private ws: WebSocket | null = null;
  private currentSymbol: string = 'tETHUSD';
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private listeners: Set<MarketDataListener> = new Set();
  private channelMap: Map<number, { channel: string; symbol: string }> = new Map();

  // Internal State
  private status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' = 'DISCONNECTED';
  private latencyMs: number = 25;
  private dataAgeMs: number = 0;
  private lastPacketTime: number = Date.now();
  private lastPingSentTime: number = 0;

  // Book Ladder
  private bidsMap: Map<number, { count: number; amount: number }> = new Map();
  private asksMap: Map<number, { count: number; amount: number }> = new Map();

  // Trade History
  private tradesList: TradeItem[] = [];

  // Ticker State
  private lastTicker: Ticker | null = null;

  // Rolling Fluctuation Window (last 60 seconds of ticks)
  private tickHistory: Array<{ price: number; time: number }> = [];

  constructor() {
    // Singleton
  }

  public subscribe(listener: MarketDataListener): () => void {
    this.listeners.add(listener);
    // Emit immediate current state
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setSymbol(symbol: string) {
    const cleanSym = symbol.toUpperCase().includes('ETH') ? symbol : 'tETHUSD';
    if (this.currentSymbol === cleanSym) return;
    this.currentSymbol = cleanSym;
    this.bidsMap.clear();
    this.asksMap.clear();
    this.tradesList = [];
    this.tickHistory = [];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.resubscribe();
    }
  }

  public start(symbol = 'tETHUSD') {
    this.currentSymbol = symbol.toUpperCase().includes('ETH') ? symbol : 'tETHUSD';
    this.connect();
  }

  public stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.status = 'DISCONNECTED';
    this.notify();
  }

  private connect() {
    if (typeof window === 'undefined') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.status = 'CONNECTING';
    this.notify();

    try {
      this.ws = new WebSocket('wss://api-pub.bitfinex.com/ws/2');

      this.ws.onopen = () => {
        this.status = 'CONNECTED';
        this.channelMap.clear();
        this.resubscribe();
        this.startHeartbeat();
        this.notify();
      };

      this.ws.onmessage = (event) => {
        this.lastPacketTime = Date.now();
        try {
          const raw = JSON.parse(event.data);
          this.handleMessage(raw);
        } catch (_) {}
      };

      this.ws.onerror = () => {
        this.status = 'DISCONNECTED';
        this.notify();
      };

      this.ws.onclose = () => {
        this.status = 'DISCONNECTED';
        this.notify();
        this.scheduleReconnect();
      };
    } catch (_) {
      this.status = 'DISCONNECTED';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 2000);
  }

  private startHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentTime = performance.now();
        try {
          this.ws.send(JSON.stringify({ event: 'ping', cid: Date.now() }));
        } catch (_) {}
      }
    }, 5000);
  }

  private resubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 1. Subscribe to Ticker
    this.ws.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'ticker',
        symbol: this.currentSymbol,
      })
    );

    // 2. Subscribe to Book (Precision P0 = raw, F0 = real-time sub-millisecond, len = 25)
    this.ws.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'book',
        symbol: this.currentSymbol,
        prec: 'P0',
        freq: 'F0',
        len: '25',
      })
    );

    // 3. Subscribe to Trades (executed tape stream)
    this.ws.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'trades',
        symbol: this.currentSymbol,
      })
    );
  }

  private handleMessage(msg: any) {
    // 1. Information & Subscription Events
    if (typeof msg === 'object' && !Array.isArray(msg)) {
      if (msg.event === 'subscribed') {
        this.channelMap.set(msg.chanId, {
          channel: msg.channel,
          symbol: msg.symbol,
        });
      } else if (msg.event === 'pong') {
        if (this.lastPingSentTime > 0) {
          this.latencyMs = Math.max(1, Math.round(performance.now() - this.lastPingSentTime));
          this.notify();
        }
      }
      return;
    }

    if (!Array.isArray(msg)) return;

    const chanId = msg[0];
    const chanInfo = this.channelMap.get(chanId);
    if (!chanInfo) return;

    const data = msg[1];
    // Heartbeat packet
    if (data === 'hb') {
      return;
    }

    if (chanInfo.channel === 'ticker') {
      this.handleTickerUpdate(data);
    } else if (chanInfo.channel === 'book') {
      this.handleBookUpdate(data);
    } else if (chanInfo.channel === 'trades') {
      const type = msg[1];
      const payload = msg[2] !== undefined ? msg[2] : msg[1];
      this.handleTradesUpdate(type, payload);
    }
  }

  private handleTickerUpdate(data: any) {
    if (!Array.isArray(data)) return;
    const [bid, bidSize, ask, askSize, dailyChange, dailyChangePerc, lastPrice, volume, high, low] = data;
    const spread = ask - bid;
    const spreadBps = lastPrice > 0 ? (spread / lastPrice) * 10000 : 0;
    const volatility = low > 0 ? ((high - low) / low) * 100 : 0;

    this.lastTicker = {
      symbol: this.currentSymbol,
      cleanSymbol: this.currentSymbol.replace(/^t/, '').replace(':', '/'),
      bid,
      bidSize,
      ask,
      askSize,
      dailyChange,
      dailyChangePerc: (dailyChangePerc || 0) * 100,
      lastPrice,
      volume,
      high,
      low,
      spread,
      spreadBps: Number(spreadBps.toFixed(2)),
      volatility: Number(volatility.toFixed(2)),
    };

    this.recordPriceTick(lastPrice || (bid + ask) / 2);
    this.notify();
  }

  private handleBookUpdate(data: any) {
    if (!Array.isArray(data)) return;

    // Snapshot: array of [price, count, amount]
    if (Array.isArray(data[0])) {
      this.bidsMap.clear();
      this.asksMap.clear();
      for (const item of data) {
        const [price, count, amount] = item;
        if (amount > 0) {
          this.bidsMap.set(price, { count, amount });
        } else {
          this.asksMap.set(price, { count, amount: Math.abs(amount) });
        }
      }
    } else {
      // Single level update: [price, count, amount]
      const [price, count, amount] = data;
      if (count > 0) {
        if (amount > 0) {
          this.bidsMap.set(price, { count, amount });
        } else {
          this.asksMap.set(price, { count, amount: Math.abs(amount) });
        }
      } else {
        // count === 0 indicates level removal
        if (amount > 0) {
          this.bidsMap.delete(price);
        } else {
          this.asksMap.delete(price);
        }
      }
    }

    this.notify();
  }

  private handleTradesUpdate(type: any, payload: any) {
    // Snapshot: array of [ID, MTS, AMOUNT, PRICE]
    if (Array.isArray(payload) && Array.isArray(payload[0])) {
      const seenIds = new Set<number>();
      const items: TradeItem[] = [];
      for (const t of payload.slice(0, 50)) {
        const [id, mts, amount, price] = t;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const isBuy = amount > 0;
        const absAmount = Math.abs(amount);
        items.push({
          id,
          timestamp: mts,
          time: new Date(mts).toISOString().slice(11, 23),
          price,
          amount: absAmount,
          side: isBuy ? 'buy' : 'sell',
          usdValue: Number((price * absAmount).toFixed(2)),
        });
      }
      this.tradesList = items;
      if (items[0]) {
        this.recordPriceTick(items[0].price);
        this.dataAgeMs = Math.max(0, Date.now() - items[0].timestamp);
      }
    } else if (Array.isArray(payload) && (type === 'te' || type === 'tu')) {
      // Single trade execution: [ID, MTS, AMOUNT, PRICE]
      // Note: Bitfinex sends 'te' followed by 'tu' for the exact same trade ID!
      const [id, mts, amount, price] = payload;
      const isBuy = amount > 0;
      const absAmount = Math.abs(amount);
      const newTrade: TradeItem = {
        id,
        timestamp: mts,
        time: new Date(mts).toISOString().slice(11, 23),
        price,
        amount: absAmount,
        side: isBuy ? 'buy' : 'sell',
        usdValue: Number((price * absAmount).toFixed(2)),
      };

      const existingIdx = this.tradesList.findIndex((t) => t.id === id);
      if (existingIdx >= 0) {
        // Update in-place to avoid duplicate keys in React components
        this.tradesList[existingIdx] = newTrade;
      } else {
        this.tradesList = [newTrade, ...this.tradesList.filter((t) => t.id !== id).slice(0, 49)];
      }
      this.recordPriceTick(price);
      this.dataAgeMs = Math.max(0, Date.now() - mts);
    }

    this.notify();
  }

  private recordPriceTick(price: number) {
    if (!price || price <= 0) return;
    const now = Date.now();
    this.tickHistory.push({ price, time: now });
    // Keep last 60 seconds
    const cutoff = now - 60000;
    while (this.tickHistory.length > 0 && this.tickHistory[0].time < cutoff) {
      this.tickHistory.shift();
    }
  }

  public getState(): WsMarketState {
    // Build sorted bids & asks
    const bids: OrderBookLevel[] = Array.from(this.bidsMap.entries())
      .map(([price, val]) => ({ price, count: val.count, amount: val.amount, total: 0 }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 25);

    const asks: OrderBookLevel[] = Array.from(this.asksMap.entries())
      .map(([price, val]) => ({ price, count: val.count, amount: val.amount, total: 0 }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 25);

    let cumBid = 0;
    bids.forEach((b) => {
      cumBid += b.amount;
      b.total = cumBid;
    });

    let cumAsk = 0;
    asks.forEach((a) => {
      cumAsk += a.amount;
      a.total = cumAsk;
    });

    const topBid = bids[0]?.price || this.lastTicker?.bid || 0;
    const topBidQty = bids[0]?.amount || 0;
    const topAsk = asks[0]?.price || this.lastTicker?.ask || 0;
    const topAskQty = asks[0]?.amount || 0;

    const midPrice = topBid && topAsk ? (topBid + topAsk) / 2 : topBid || topAsk || this.lastTicker?.lastPrice || 0;
    const spread = topAsk > 0 && topBid > 0 ? topAsk - topBid : 0;
    const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

    // Microprice: P_micro = (Q_bid * P_ask + Q_ask * P_bid) / (Q_bid + Q_ask)
    let microprice = midPrice;
    if (topBidQty + topAskQty > 0) {
      microprice = (topBidQty * topAsk + topAskQty * topBid) / (topBidQty + topAskQty);
    }
    const micropriceDelta = microprice - midPrice;

    // Order Book Imbalance (Top 5 & Total)
    const bidDepth5 = bids.slice(0, 5).reduce((acc, b) => acc + b.amount, 0);
    const askDepth5 = asks.slice(0, 5).reduce((acc, a) => acc + a.amount, 0);
    const imbalance5 = bidDepth5 + askDepth5 > 0 ? ((bidDepth5 - askDepth5) / (bidDepth5 + askDepth5)) * 100 : 0;

    const totalBidDepth = bids.reduce((acc, b) => acc + b.amount, 0);
    const totalAskDepth = asks.reduce((acc, a) => acc + a.amount, 0);
    const imbalanceTotal = totalBidDepth + totalAskDepth > 0 ? ((totalBidDepth - totalAskDepth) / (totalBidDepth + totalAskDepth)) * 100 : 0;

    const obiRatio = totalAskDepth > 0 ? totalBidDepth / totalAskDepth : 1.0;
    const obi5Ratio = askDepth5 > 0 ? bidDepth5 / askDepth5 : 1.0;

    // Walls
    const avgAsk = asks.length > 0 ? totalAskDepth / asks.length : 1;
    const avgBid = bids.length > 0 ? totalBidDepth / bids.length : 1;

    const sellWalls: OrderBookWall[] = asks
      .filter((a) => a.amount >= avgAsk * 2.5 && a.amount > 1.0)
      .map((w) => ({
        price: w.price,
        amount: w.amount,
        distancePerc: midPrice > 0 ? ((w.price - midPrice) / midPrice) * 100 : 0,
        multipleOfAvg: Number((w.amount / avgAsk).toFixed(1)),
      }));

    const buyWalls: OrderBookWall[] = bids
      .filter((b) => b.amount >= avgBid * 2.5 && b.amount > 1.0)
      .map((w) => ({
        price: w.price,
        amount: w.amount,
        distancePerc: midPrice > 0 ? ((midPrice - w.price) / midPrice) * 100 : 0,
        multipleOfAvg: Number((w.amount / avgBid).toFixed(1)),
      }));

    const bookPayload: OrderBookData = {
      symbol: this.currentSymbol,
      timestamp: Date.now(),
      midPrice: Number(midPrice.toFixed(2)),
      topBid,
      topAsk,
      spread: Number(spread.toFixed(2)),
      spreadBps: Number(spreadBps.toFixed(2)),
      microprice: Number(microprice.toFixed(4)),
      micropriceDelta: Number(micropriceDelta.toFixed(4)),
      imbalance5: Number(imbalance5.toFixed(2)),
      imbalanceTotal: Number(imbalanceTotal.toFixed(2)),
      bidDepth5,
      askDepth5,
      totalBidDepth,
      totalAskDepth,
      obiRatio: Number(obiRatio.toFixed(2)),
      obi5Ratio: Number(obi5Ratio.toFixed(2)),
      sellWalls,
      buyWalls,
      bids,
      asks,
    };

    // Trades Aggregation
    let buyVol = 0;
    let sellVol = 0;
    let buyCount = 0;
    let sellCount = 0;
    this.tradesList.forEach((t) => {
      if (t.side === 'buy') {
        buyVol += t.amount;
        buyCount++;
      } else {
        sellVol += t.amount;
        sellCount++;
      }
    });

    const totVol = buyVol + sellVol;
    const tradeDelta = buyVol - sellVol;
    const aggressiveBuyRatio = totVol > 0 ? (buyVol / totVol) * 100 : 50;

    const tradesPayload: TradesData = {
      symbol: this.currentSymbol,
      buyVolume: Number(buyVol.toFixed(4)),
      sellVolume: Number(sellVol.toFixed(4)),
      totalVolume: Number(totVol.toFixed(4)),
      tradeDelta: Number(tradeDelta.toFixed(4)),
      aggressiveBuyRatio: Number(aggressiveBuyRatio.toFixed(1)),
      buyCount,
      sellCount,
      trades: this.tradesList,
    };

    // Fluctuation Wave & Liquidity Analysis ($0.30, $0.50, $1.00)
    const recentPrices = this.tickHistory.map((t) => t.price);
    const swingHigh = recentPrices.length > 0 ? Math.max(...recentPrices) : topAsk;
    const swingLow = recentPrices.length > 0 ? Math.min(...recentPrices) : topBid;
    const swingDelta = Number((swingHigh - swingLow).toFixed(2));

    // Executable Ask Liquidity (for Long / Buying):
    const liquidityAtPlus030 = asks
      .filter((a) => a.price <= topAsk + 0.30)
      .reduce((sum, a) => sum + a.amount, 0);

    const liquidityAtPlus050 = asks
      .filter((a) => a.price <= topAsk + 0.50)
      .reduce((sum, a) => sum + a.amount, 0);

    const liquidityAtPlus100 = asks
      .filter((a) => a.price <= topAsk + 1.00)
      .reduce((sum, a) => sum + a.amount, 0);

    // Executable Bid Liquidity (for Short / Selling):
    const liquidityAtMinus030 = bids
      .filter((b) => b.price >= topBid - 0.30)
      .reduce((sum, b) => sum + b.amount, 0);

    const liquidityAtMinus050 = bids
      .filter((b) => b.price >= topBid - 0.50)
      .reduce((sum, b) => sum + b.amount, 0);

    // Repeated oscillation detection ($0.30, $0.50, $1.00 moves)
    let detectedCycleDelta = 0.50;
    if (swingDelta >= 0.85) detectedCycleDelta = 1.00;
    else if (swingDelta >= 0.40) detectedCycleDelta = 0.50;
    else if (swingDelta >= 0.25) detectedCycleDelta = 0.30;

    const hasRepeatableFluctuation = swingDelta >= 0.25 && recentPrices.length >= 4;
    const isExecutable = liquidityAtPlus030 >= 0.04 && spread <= 0.40;

    // Directional Opportunity Evaluation:
    // Upward opportunity: Price near lower range (pullback) + Buyers CVD dominance
    const rangePosition = swingDelta > 0 ? (midPrice - swingLow) / swingDelta : 0.5;
    const upwardOpportunity = rangePosition <= 0.65 && aggressiveBuyRatio >= 50 && liquidityAtPlus030 >= 0.04;
    const downwardOpportunity = rangePosition >= 0.70 && aggressiveBuyRatio < 45 && liquidityAtMinus030 >= 0.04;

    // Probability & Expected Time Estimation:
    const baseProb030 = hasRepeatableFluctuation ? 75 : 55;
    const probBonus = aggressiveBuyRatio > 60 ? 12 : aggressiveBuyRatio < 40 ? -10 : 0;
    const probability030 = Math.min(95, Math.max(25, Math.round(baseProb030 + probBonus)));
    const probability050 = Math.min(88, Math.max(20, Math.round(probability030 * 0.82)));
    const estimatedTimeSeconds = Number((Math.max(0.6, 2.8 - (aggressiveBuyRatio / 100) * 1.5)).toFixed(1));

    return {
      ticker: this.lastTicker,
      book: bookPayload,
      trades: tradesPayload,
      status: this.status,
      latencyMs: this.latencyMs,
      dataAgeMs: this.dataAgeMs,
      lastPacketTime: this.lastPacketTime,
      fluctuationMetrics: {
        referencePrice: midPrice,
        currentPrice: midPrice,
        swingHigh,
        swingLow,
        swingDelta,
        isOscillating: swingDelta >= 0.25,
        detectedCycleDelta,
        hasRepeatableFluctuation,
        liquidityAtPlus030: Number(liquidityAtPlus030.toFixed(4)),
        liquidityAtMinus030: Number(liquidityAtMinus030.toFixed(4)),
        liquidityAtPlus050: Number(liquidityAtPlus050.toFixed(4)),
        liquidityAtMinus050: Number(liquidityAtMinus050.toFixed(4)),
        liquidityAtPlus100: Number(liquidityAtPlus100.toFixed(4)),
        isExecutable,
        upwardOpportunity,
        downwardOpportunity,
        probability030,
        probability050,
        estimatedTimeSeconds,
      },
    };
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (_) {}
    });
  }
}

export const bitfinexWs = new BitfinexWebSocketManager();

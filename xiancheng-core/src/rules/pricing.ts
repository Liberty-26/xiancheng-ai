// ============================================================
// 清河县 · 价格计算
// Phase 2：规则引擎
// ============================================================

import { World } from '../types';

export interface ItemPrice {
  price: number;      // 基准价
  category: 'food' | 'cloth' | 'weapon' | 'medicine' | 'metal' | 'luxury' | 'tool';
}

export const ITEM_PRICES: Record<string, ItemPrice> = {
  grain:    { price: 3,  category: 'food' },
  cloth:    { price: 8,  category: 'cloth' },
  herb:     { price: 6,  category: 'medicine' },
  knife:    { price: 15, category: 'weapon' },
  salt:     { price: 5,  category: 'food' },
  iron:     { price: 10, category: 'metal' },
  book:     { price: 12, category: 'luxury' },
  lockpick: { price: 20, category: 'tool' },
  seal:     { price: 100, category: 'luxury' },
  brush:    { price: 2,  category: 'tool' },
};

/** 实际价格 = 基准价 × 粮价系数（食物类随粮价波动） */
export function getPrice(itemId: string, world: World): number {
  const base = ITEM_PRICES[itemId]?.price ?? 10;
  if (ITEM_PRICES[itemId]?.category === 'food') {
    return Math.round(base * (world.state.grainPrice / 100));
  }
  return base;
}

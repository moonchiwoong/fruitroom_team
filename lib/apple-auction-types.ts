import type {RegionKey} from './regions';

export const APPLE_AUCTION_PARTS = 4;

export type AppleAuctionDay = {
  date: string;
  averagePrice: number;
  quantity: number;
  totalWeightKg: number;
  totalAmount: number;
};

export type AppleAuctionGroup = {
  id: string;
  marketName: string;
  source: 'origin-hall' | 'wholesale';
  variety: string;
  grade: string;
  packageName: string;
  size: string;
  unit: string;
  unitWeightKg: number;
  days: AppleAuctionDay[];
};

export type AppleAuctionsResponse = {
  status: 'ready' | 'empty' | 'unavailable';
  region: RegionKey;
  groups: AppleAuctionGroup[];
  checkedThrough: string;
  partial: boolean;
};

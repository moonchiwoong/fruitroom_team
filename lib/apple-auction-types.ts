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

/** 정산정보(어제 이전) 등급별 하루 값. 가격은 포장 1개(unitWeightKg) 기준 원. */
export type GradedAuctionDay = {date: string; averagePrice: number; lowPrice: number; highPrice: number; boxes: number; totalWeightKg: number};
export type GradedAuctionGrade = {grade: string; size: string; days: GradedAuctionDay[]};
export type GradedAuctionGroup = {id: string; marketCode: string; marketName: string; variety: string; packageName: string; unitWeightKg: number; grades: GradedAuctionGrade[]};
export type GradedAuctionsResponse = {status: 'ready' | 'empty' | 'unavailable'; region: RegionKey; groups: GradedAuctionGroup[]; checkedFrom: string; checkedThrough: string; partial: boolean};

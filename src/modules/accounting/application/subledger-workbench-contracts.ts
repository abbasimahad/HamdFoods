export type SubledgerWorkbenchQuery = { asOf: Date; query: string; page: number };

export type SubledgerAging = {
  current: string;
  days1To30: string;
  days31To60: string;
  days61To90: string;
  days90Plus: string;
  total: string;
};

export type SubledgerPartySummary = {
  partyId: string;
  code: string;
  name: string;
  outstandingBalance: string;
  creditsAvailable: string;
  netBalance: string;
  aging: SubledgerAging;
};

export type SubledgerHistoryRow = {
  id: string;
  date: Date;
  number: string;
  type: string;
  description: string;
  debit: string;
  credit: string;
  amount: string;
};

export type ReceivablePartySummary = SubledgerPartySummary;
export type PayablePartySummary = SubledgerPartySummary;
export type ReceivablePartyDetail = SubledgerPartySummary & {
  history: readonly SubledgerHistoryRow[];
};
export type PayablePartyDetail = ReceivablePartyDetail;
export type SubledgerPartyDetail = ReceivablePartyDetail;

export type SubledgerPartyPage<T> = {
  records: readonly T[];
  page: number;
  pageCount: number;
  total: number;
};

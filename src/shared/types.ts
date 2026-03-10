export interface ExchangeRateRow {
  id: number;
  branch_rate_id: string;
  branch_id: string;
  profile_id: string;
  currency: string;
  buy_rate: number | null;
  sell_rate: number | null;
  buy_min_count: number | null;
  buy_max_count: number | null;
  sell_min_count: number | null;
  sell_max_count: number | null;
  previous_buy: number | null;
  previous_sell: number | null;
  address: string | null;
  city_id: number | null;
  metro: number | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  office_name: string | null;
  license_name: string | null;
  logo_url: string | null;
  verified: boolean | null;
  phone: string | null;
  cctv: boolean | null;
  damaged_bills: boolean | null;
  recount_room: boolean | null;
  parking: boolean | null;
  blackout_enabled: boolean | null;
  is_active: boolean | null;
  auto_update: boolean | null;
  pinned: boolean | null;
  painted: boolean | null;
  pinned_expired: string | null;
  painted_expired: string | null;
  prio: number | null;
  subscription_type: string | null;
  rating_average: number | null;
  rating_count: number | null;
  description: string | null;
  api_updated: string;
  api_created: string;
  timestamp: string;
}

export interface OrderBookLevel {
  price: number;
  count: number;
}

export interface OrderBookPayload {
  buy: OrderBookLevel[];
  sell: OrderBookLevel[];
}

export interface FiltersState {
  currency: string | null;
  cityId: number;
  officeNames: string[];
  addresses: string[];
  pinnedValues: boolean[];
}

export interface FilterOptions {
  currencies: string[];
  cities: Array<{ id: number; name: string }>;
  officeNames: string[];
  addresses: string[];
  pinnedValues: boolean[];
}

export interface DataResponse {
  orderBook: OrderBookPayload;
  rows: ExchangeRateRow[];
  databaseLastUpdate: string | null;
}

export interface UserSettings {
  companyName: string;
  dbHost: string;
  dbPort: string;
  dbUser: string;
  dbPassword: string;
}

export interface AutoUpdateStatus {
  type: "checking" | "available" | "not-available" | "downloaded" | "error";
  version?: string;
  message?: string;
}

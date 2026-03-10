import dotenv from "dotenv";
import { Pool, types } from "pg";
import fs from "node:fs";
import path from "node:path";
import type {
  DataResponse,
  ExchangeRateRow,
  FilterOptions,
  FiltersState,
  OrderBookPayload
} from "../shared/types";
import { loadSettings } from "./settings";

const packagedEnvPath = path.join(process.resourcesPath, ".env");
dotenv.config(fs.existsSync(packagedEnvPath) ? { path: packagedEnvPath } : undefined);

types.setTypeParser(1700, (value: string) => Number.parseFloat(value));

const settings = loadSettings();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? "5432"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const BASE_LATEST_CTE = `
  WITH latest AS (
    SELECT DISTINCT ON (city_id, currency, branch_rate_id) *
    FROM exchange_rates
    WHERE is_active = true
      AND "timestamp"::date = CURRENT_DATE
      AND city_id = $1
      AND ($2::varchar IS NULL OR lower(currency) = lower($2))
    ORDER BY city_id, currency, branch_rate_id, "timestamp" DESC
  )
`;
const EMPTY_VALUE_TOKEN = "__EMPTY__";

function buildNullableTextCondition(
  columnName: "office_name" | "address",
  selectedValues: string[],
  pgArrayType: "varchar[]" | "text[]",
  index: number
): { condition: string; values: unknown[]; nextIndex: number } | null {
  if (selectedValues.length === 0) {
    return null;
  }

  const includesEmpty = selectedValues.includes(EMPTY_VALUE_TOKEN) || selectedValues.includes("");
  const nonEmptyValues = selectedValues.filter((value) => value !== EMPTY_VALUE_TOKEN && value !== "");
  const nullOrBlankCondition = `(${columnName} IS NULL OR btrim(${columnName}) = '')`;

  if (!includesEmpty) {
    return {
      condition: `${columnName} = ANY($${index}::${pgArrayType})`,
      values: [nonEmptyValues],
      nextIndex: index + 1
    };
  }

  if (nonEmptyValues.length === 0) {
    return {
      condition: nullOrBlankCondition,
      values: [],
      nextIndex: index
    };
  }

  return {
    condition: `(${columnName} = ANY($${index}::${pgArrayType}) OR ${nullOrBlankCondition})`,
    values: [nonEmptyValues],
    nextIndex: index + 1
  };
}

function buildWhere(filters: FiltersState, startIndex: number): { whereSql: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  let index = startIndex;

  const officeCondition = buildNullableTextCondition("office_name", filters.officeNames, "varchar[]", index);
  if (officeCondition) {
    conditions.push(officeCondition.condition);
    values.push(...officeCondition.values);
    index = officeCondition.nextIndex;
  }

  const addressCondition = buildNullableTextCondition("address", filters.addresses, "text[]", index);
  if (addressCondition) {
    conditions.push(addressCondition.condition);
    values.push(...addressCondition.values);
    index = addressCondition.nextIndex;
  }

  if (filters.pinnedValues.length > 0) {
    conditions.push(`pinned = ANY($${index}::boolean[])`);
    values.push(filters.pinnedValues);
  }

  if (conditions.length === 0) {
    return { whereSql: "", values };
  }

  return { whereSql: ` WHERE ${conditions.join(" AND ")}`, values };
}

function toOrderBook(rows: ExchangeRateRow[]): OrderBookPayload {
  const buyMap = new Map<number, number>();
  const sellMap = new Map<number, number>();

  for (const row of rows) {
    if (row.buy_rate !== null) {
      buyMap.set(row.buy_rate, (buyMap.get(row.buy_rate) ?? 0) + 1);
    }
    if (row.sell_rate !== null) {
      sellMap.set(row.sell_rate, (sellMap.get(row.sell_rate) ?? 0) + 1);
    }
  }

  const buy = [...buyMap.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => b.price - a.price);

  const sell = [...sellMap.entries()]
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price);

  return { buy, sell };
}

export async function getFilterOptions(baseFilters: Pick<FiltersState, "cityId" | "currency">): Promise<FilterOptions> {
  const values: Array<string | number | null> = [baseFilters.cityId, baseFilters.currency];
  const cte = BASE_LATEST_CTE;

  const [officeResult, addressResult] = await Promise.all([
    pool.query<{ office_name: string | null }>(
      `${cte} SELECT DISTINCT office_name FROM latest ORDER BY office_name ASC NULLS FIRST`,
      values
    ),
    pool.query<{ address: string | null }>(
      `${cte} SELECT DISTINCT address FROM latest ORDER BY address ASC NULLS FIRST`,
      values
    )
  ]);

  const cities = Object.entries(settings.cities).map(([id, name]) => ({ id: Number(id), name }));

  return {
    currencies: settings.supportedCurrencies,
    cities,
    officeNames: officeResult.rows.map((row) => row.office_name ?? ""),
    addresses: addressResult.rows.map((row) => row.address ?? ""),
    pinnedValues: [true, false]
  };
}

export async function getData(filters: FiltersState): Promise<DataResponse> {
  const baseValues: Array<string | number | null> = [filters.cityId, filters.currency];
  const { whereSql, values } = buildWhere(filters, 3);
  const queryValues = [...baseValues, ...values];

  const query = `${BASE_LATEST_CTE}
    SELECT *
    FROM latest
    ${whereSql}
    ORDER BY sell_rate ASC NULLS LAST, buy_rate DESC NULLS LAST, rating_average DESC NULLS LAST
  `;

  const result = await pool.query<ExchangeRateRow>(query, queryValues);
  const rows = result.rows;

  return {
    rows,
    orderBook: toOrderBook(rows)
  };
}

export function getDefaultFilters(): FiltersState {
  return {
    cityId: settings.defaultCityId,
    currency: settings.defaultCurrency,
    officeNames: [],
    addresses: [],
    pinnedValues: []
  };
}

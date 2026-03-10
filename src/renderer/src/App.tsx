import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { AutoUpdateStatus, ExchangeRateRow, FilterOptions, FiltersState, UserSettings } from "../../shared/types";

type SortDirection = "asc" | "desc";

type PriceSelection = {
  side: "buy" | "sell";
  price: number;
} | null;

const PINNED_OPTIONS = [
  { value: true, label: "Top (pinned)" },
  { value: false, label: "Not pinned" }
];
const FILTERS_STORAGE_KEY = "minfin.filters";
const REFRESH_INTERVAL_MS = 10_000;
const EMPTY_VALUE_TOKEN = "__EMPTY__";

interface SelectOption {
  value: string;
  label: string;
}

type TableColumnId =
  | "office_name"
  | "buy_rate"
  | "sell_rate"
  | "spread"
  | "address"
  | "announcement_link"
  | "buy_min_count"
  | "buy_max_count"
  | "sell_min_count"
  | "sell_max_count";

const TABLE_COLUMNS: Array<{ id: TableColumnId; label: string }> = [
  { id: "office_name", label: "Компания" },
  { id: "buy_rate", label: "Покупка" },
  { id: "sell_rate", label: "Продажа" },
  { id: "spread", label: "Спред" },
  { id: "address", label: "Адресс" },
  { id: "announcement_link", label: "Ссылка" },
  { id: "buy_min_count", label: "Мин. покупки" },
  { id: "buy_max_count", label: "Макс. покупки" },
  { id: "sell_min_count", label: "Мин. продажи" },
  { id: "sell_max_count", label: "Макс. продажи" }
];

const DEFAULT_COLUMN_WIDTHS: Record<TableColumnId, number> = {
  office_name: 165,
  buy_rate: 90,
  sell_rate: 90,
  spread: 90,
  address: 280,
  announcement_link: 50,
  buy_min_count: 140,
  buy_max_count: 150,
  sell_min_count: 140,
  sell_max_count: 150
};

function toNumber(value: string): number {
  return Number.parseInt(value, 10);
}

function getSingleValueLabel(options: SelectOption[], value: string): string {
  const selected = options.find((option) => option.value === value);
  return selected?.label ?? "Выберите";
}

function getMultiValueLabel(options: SelectOption[], selectedValues: string[]): string {
  if (selectedValues.length === 0) {
    return "Не выбрано";
  }
  if (selectedValues.length === options.length) {
    return "Выбрано все";
  }

  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);

  if (selectedLabels.length <= 2) {
    return selectedLabels.join(", ");
  }

  return `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`;
}

interface SingleSelectDropdownProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

function SingleSelectDropdown({ label, value, options, onChange }: SingleSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div className="dropdown-root" ref={rootRef}>
      <span className="dropdown-label">{label}</span>
      <button type="button" className="dropdown-trigger" onClick={() => setIsOpen((prev) => !prev)}>
        <span>{getSingleValueLabel(options, value)}</span>
        <span>{isOpen ? "▴" : "▾"}</span>
      </button>
      {isOpen && (
        <div className="dropdown-panel">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`dropdown-item ${option.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface MultiSelectDropdownProps {
  label: string;
  selectedValues: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
}

function MultiSelectDropdown({ label, selectedValues, options, onChange }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const allSelected = selectedValues.length > 0 && selectedValues.length === options.length;

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const toggleValue = (nextValue: string): void => {
    if (selectedValues.includes(nextValue)) {
      onChange(selectedValues.filter((value) => value !== nextValue));
      return;
    }
    onChange([...selectedValues, nextValue]);
  };

  return (
    <div className="dropdown-root" ref={rootRef}>
      <span className="dropdown-label">{label}</span>
      <button type="button" className="dropdown-trigger" onClick={() => setIsOpen((prev) => !prev)}>
        <span>{getMultiValueLabel(options, selectedValues)}</span>
        <span>{isOpen ? "▴" : "▾"}</span>
      </button>
      {isOpen && (
        <div className="dropdown-panel">
          <label className="dropdown-item checkbox-item">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange(allSelected ? [] : options.map((option) => option.value))}
            />
            <span>Выбрать все</span>
          </label>
          {options.map((option) => (
            <label key={option.value} className="dropdown-item checkbox-item">
              <input type="checkbox" checked={selectedValues.includes(option.value)} onChange={() => toggleValue(option.value)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function readStoredFilters(): Partial<FiltersState> | null {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<FiltersState>;
    return parsed;
  } catch {
    return null;
  }
}

function getLevelColor(side: "buy" | "sell", count: number, maxCount: number): string {
  const normalized = maxCount > 0 ? count / maxCount : 0;
  const alpha = 0.15 + normalized * 0.55;
  return side === "buy" ? `rgba(24, 146, 78, ${alpha})` : `rgba(176, 45, 57, ${alpha})`;
}

function formatNumber(value: number | null, digits: number): string {
  if (value === null) {
    return "";
  }
  return value.toFixed(digits);
}

function formatInteger(value: number | null): string {
  if (value === null) {
    return "";
  }
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/\u00A0/g, " ");
}

function getSpread(row: ExchangeRateRow): number | null {
  if (row.sell_rate === null || row.buy_rate === null) {
    return null;
  }
  return row.sell_rate - row.buy_rate;
}

function getSortValue(row: ExchangeRateRow, column: TableColumnId): string | number | null {
  if (column === "spread") {
    return getSpread(row);
  }
  if (column === "announcement_link") {
    return row.branch_id;
  }
  return row[column];
}

function getWeightedRate(levels: Array<{ price: number; count: number }>): number | null {
  const totalWeight = levels.reduce((acc, level) => acc + level.count, 0);
  if (totalWeight === 0) {
    return null;
  }
  const weightedSum = levels.reduce((acc, level) => acc + level.price * level.count, 0);
  return weightedSum / totalWeight;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export default function App() {
  const [filters, setFilters] = useState<FiltersState | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    currencies: [],
    cities: [],
    officeNames: [],
    addresses: [],
    pinnedValues: [true, false]
  });
  const [rows, setRows] = useState<ExchangeRateRow[]>([]);
  const [selectedPrice, setSelectedPrice] = useState<PriceSelection>(null);
  const [sortColumn, setSortColumn] = useState<TableColumnId>("sell_rate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnWidths, setColumnWidths] = useState<Record<TableColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [databaseLastUpdate, setDatabaseLastUpdate] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>({ companyName: "" });
  const [settingsDraftName, setSettingsDraftName] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<AutoUpdateStatus | null>(null);
  const latestRequestIdRef = useRef(0);
  const shouldResetMultiFiltersRef = useRef(false);
  const resizingStateRef = useRef<{ column: TableColumnId; startX: number; startWidth: number } | null>(null);
  const currencyOptions = useMemo(
    () => filterOptions.currencies.map((currency) => ({ value: currency, label: currency })),
    [filterOptions.currencies]
  );
  const cityOptions = useMemo(
    () => filterOptions.cities.map((city) => ({ value: String(city.id), label: city.name })),
    [filterOptions.cities]
  );
  const officeOptions = useMemo(
    () =>
      filterOptions.officeNames.map((officeName) => ({
        value: officeName === "" ? EMPTY_VALUE_TOKEN : officeName,
        label: officeName === "" ? "Пусто" : officeName
      })),
    [filterOptions.officeNames]
  );
  const addressOptions = useMemo(
    () =>
      filterOptions.addresses.map((address) => ({
        value: address === "" ? EMPTY_VALUE_TOKEN : address,
        label: address === "" ? "Пусто" : address
      })),
    [filterOptions.addresses]
  );
  const pinnedOptions = useMemo(
    () => PINNED_OPTIONS.map((item) => ({ value: String(item.value), label: item.label })),
    []
  );

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        if (!window.minfinApi) {
          throw new Error("Preload API is unavailable");
        }

        const defaultFilters = await window.minfinApi.getDefaultFilters();
        const stored = readStoredFilters();
        const storedUserSettings = await window.minfinApi.getUserSettings();
        setUserSettings(storedUserSettings);
        setSettingsDraftName(storedUserSettings.companyName);

        setFilters({
          cityId: typeof stored?.cityId === "number" ? stored.cityId : defaultFilters.cityId,
          currency:
            typeof stored?.currency === "string" || stored?.currency === null ? stored.currency : defaultFilters.currency,
          officeNames: Array.isArray(stored?.officeNames) ? stored.officeNames : [],
          addresses: Array.isArray(stored?.addresses) ? stored.addresses : [],
          pinnedValues: Array.isArray(stored?.pinnedValues) ? stored.pinnedValues : []
        });
      } catch (initError) {
        const message = initError instanceof Error ? initError.message : "Failed to initialize app";
        setError(message);
      }
    };

    void init();
  }, []);

  useEffect(() => {
    const unsubscribe = window.minfinApi.onOpenSettings(() => {
      setSettingsDraftName(userSettings.companyName);
      setIsSettingsOpen(true);
    });
    return () => unsubscribe();
  }, [userSettings.companyName]);

  useEffect(() => {
    const unsubscribe = window.minfinApi.onAutoUpdateStatus((status) => {
      setAutoUpdateStatus(status);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!filters) {
      return;
    }
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (!filters) {
      return;
    }

    const loadOptions = async (): Promise<void> => {
      const options = await window.minfinApi.getFilterOptions({
        cityId: filters.cityId,
        currency: filters.currency
      });
      setFilterOptions(options);
      if (shouldResetMultiFiltersRef.current) {
        setFilters((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            officeNames: options.officeNames,
            addresses: options.addresses,
            pinnedValues: [true, false]
          };
        });
        shouldResetMultiFiltersRef.current = false;
      }
    };

    void loadOptions();
  }, [filters?.cityId, filters?.currency]);

  const loadData = useCallback(
    async (showLoading: boolean): Promise<void> => {
      if (!filters) {
        return;
      }

      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      if (showLoading) {
        setIsLoading(true);
      }

      setError(null);

      try {
        const result = await window.minfinApi.getRatesData(filters);
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        setRows(result.rows);
        setLastUpdatedAt(new Date().toLocaleTimeString());
        setDatabaseLastUpdate(result.databaseLastUpdate ? new Date(result.databaseLastUpdate).toLocaleString() : null);
      } catch (loadError) {
        if (requestId !== latestRequestIdRef.current) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Failed to load data";
        setError(message);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    if (!filters) {
      return;
    }

    void loadData(true);

    const timer = window.setInterval(() => {
      void loadData(false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [filters, loadData]);

  const orderBookRowsSource = useMemo(() => {
    if (!selectedPrice) {
      return rows;
    }
    return selectedPrice.side === "buy"
      ? rows.filter((row) => row.buy_rate === selectedPrice.price)
      : rows.filter((row) => row.sell_rate === selectedPrice.price);
  }, [rows, selectedPrice]);
  const relatedOrderBook = useMemo(() => {
    const buyMap = new Map<number, number>();
    const sellMap = new Map<number, number>();

    for (const row of orderBookRowsSource) {
      if (row.buy_rate !== null) {
        buyMap.set(row.buy_rate, (buyMap.get(row.buy_rate) ?? 0) + 1);
      }
      if (row.sell_rate !== null) {
        sellMap.set(row.sell_rate, (sellMap.get(row.sell_rate) ?? 0) + 1);
      }
    }

    return {
      buy: [...buyMap.entries()].map(([price, count]) => ({ price, count })).sort((a, b) => b.price - a.price),
      sell: [...sellMap.entries()].map(([price, count]) => ({ price, count })).sort((a, b) => a.price - b.price)
    };
  }, [orderBookRowsSource]);
  const relatedMaxBuyCount = useMemo(
    () => Math.max(1, ...relatedOrderBook.buy.map((level) => level.count)),
    [relatedOrderBook.buy]
  );
  const relatedMaxSellCount = useMemo(
    () => Math.max(1, ...relatedOrderBook.sell.map((level) => level.count)),
    [relatedOrderBook.sell]
  );
  const myCompanyPriceMarkers = useMemo(() => {
    const companyName = normalizeName(userSettings.companyName);
    const buy = new Set<number>();
    const sell = new Set<number>();

    if (!companyName) {
      return { buy, sell };
    }

    for (const row of orderBookRowsSource) {
      if (normalizeName(row.office_name) !== companyName) {
        continue;
      }
      if (row.buy_rate !== null) {
        buy.add(row.buy_rate);
      }
      if (row.sell_rate !== null) {
        sell.add(row.sell_rate);
      }
    }

    return { buy, sell };
  }, [orderBookRowsSource, userSettings.companyName]);
  const weightedBuyRate = useMemo(() => getWeightedRate(relatedOrderBook.buy), [relatedOrderBook.buy]);
  const weightedSellRate = useMemo(() => getWeightedRate(relatedOrderBook.sell), [relatedOrderBook.sell]);

  const priceFilteredRows = useMemo(() => {
    if (!selectedPrice) {
      return rows;
    }

    if (selectedPrice.side === "buy") {
      return rows.filter((row) => row.buy_rate === selectedPrice.price);
    }

    return rows.filter((row) => row.sell_rate === selectedPrice.price);
  }, [rows, selectedPrice]);

  const sortedRows = useMemo(() => {
    const copy = [...priceFilteredRows];
    copy.sort((left, right) => {
      const a = getSortValue(left, sortColumn);
      const b = getSortValue(right, sortColumn);

      if (a === b) {
        return 0;
      }

      if (a === null || a === undefined) {
        return 1;
      }
      if (b === null || b === undefined) {
        return -1;
      }

      if (typeof a === "number" && typeof b === "number") {
        return sortDirection === "asc" ? a - b : b - a;
      }

      const aText = String(a);
      const bText = String(b);
      return sortDirection === "asc" ? aText.localeCompare(bText) : bText.localeCompare(aText);
    });
    return copy;
  }, [priceFilteredRows, sortColumn, sortDirection]);

  const onSort = (column: TableColumnId): void => {
    if (column === sortColumn) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  };

  useEffect(() => {
    const onMouseMove = (event: MouseEvent): void => {
      const state = resizingStateRef.current;
      if (!state) {
        return;
      }
      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(60, state.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [state.column]: nextWidth }));
    };

    const onMouseUp = (): void => {
      resizingStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startResizeColumn = (column: TableColumnId, event: ReactMouseEvent<HTMLSpanElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    resizingStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column]
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const saveSettings = (): void => {
    const next = { companyName: settingsDraftName.trim() };
    void window.minfinApi
      .saveUserSettings(next)
      .then((saved) => {
        setUserSettings(saved);
        setIsSettingsOpen(false);
      })
      .catch((saveError) => {
        const message = saveError instanceof Error ? saveError.message : "Failed to save settings";
        setError(message);
      });
  };

  if (!filters) {
    return <div className="center">{error ?? "Loading..."}</div>;
  }

  return (
    <div className="page">
      <section className="content">
        <aside className="left-panel">
          <section className="filters">
            <SingleSelectDropdown
              label="Валюта"
              value={filters.currency ?? ""}
              options={currencyOptions}
              onChange={(currency) => {
                setSelectedPrice(null);
                shouldResetMultiFiltersRef.current = true;
                setFilters((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return {
                    ...prev,
                    currency: currency || null,
                    officeNames: [],
                    addresses: [],
                    pinnedValues: []
                  };
                });
              }}
            />
            <SingleSelectDropdown
              label="Город"
              value={String(filters.cityId)}
              options={cityOptions}
              onChange={(cityId) => {
                setSelectedPrice(null);
                shouldResetMultiFiltersRef.current = true;
                setFilters((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return {
                    ...prev,
                    cityId: toNumber(cityId),
                    officeNames: [],
                    addresses: [],
                    pinnedValues: []
                  };
                });
              }}
            />
            <MultiSelectDropdown
              label="Платное?"
              selectedValues={filters.pinnedValues.map((value) => String(value))}
              options={pinnedOptions}
              onChange={(pinnedValues) => {
                setSelectedPrice(null);
                setFilters((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return { ...prev, pinnedValues: pinnedValues.map((value) => value === "true") };
                });
              }}
            />
            <MultiSelectDropdown
              label="Компания"
              selectedValues={filters.officeNames.map((value) => (value === "" ? EMPTY_VALUE_TOKEN : value))}
              options={officeOptions}
              onChange={(officeNames) => {
                setSelectedPrice(null);
                setFilters((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return {
                    ...prev,
                    officeNames: officeNames.map((value) => (value === EMPTY_VALUE_TOKEN ? "" : value))
                  };
                });
              }}
            />
            <MultiSelectDropdown
              label="Адресс"
              selectedValues={filters.addresses.map((value) => (value === "" ? EMPTY_VALUE_TOKEN : value))}
              options={addressOptions}
              onChange={(addresses) => {
                setSelectedPrice(null);
                setFilters((prev) => {
                  if (!prev) {
                    return prev;
                  }
                  return {
                    ...prev,
                    addresses: addresses.map((value) => (value === EMPTY_VALUE_TOKEN ? "" : value))
                  };
                });
              }}
            />
          </section>

          <section className="orderbook">
            <div className="orderbook-header">
              <h2>
                Order Book (
                <span className="buy-rate-text">{formatNumber(weightedBuyRate, 2) || "-"}</span>
                {" / "}
                <span className="sell-rate-text">{formatNumber(weightedSellRate, 2) || "-"}</span>)
              </h2>
              {selectedPrice && (
                <button type="button" className="clear-button" onClick={() => setSelectedPrice(null)}>
                  Clear
                </button>
              )}
            </div>
            <div className="book-grid">
              <table className="orderbook-table buy-table">
                <thead>
                  <tr>
                    <th>Buy count</th>
                    <th>Buy price</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedOrderBook.buy.map((level) => (
                    <tr key={`buy-${level.price}`}>
                      <td
                        className="buy-cell has-level"
                        style={{ backgroundColor: getLevelColor("buy", level.count, relatedMaxBuyCount) }}
                      >
                        <span className={myCompanyPriceMarkers.buy.has(level.price) ? "my-company-count" : ""}>{level.count}</span>
                      </td>
                      <td
                        className="buy-cell has-level"
                        style={{ backgroundColor: getLevelColor("buy", level.count, relatedMaxBuyCount) }}
                      >
                        <button
                          type="button"
                          className={`level-price-button ${selectedPrice?.side === "buy" && selectedPrice.price === level.price ? "active" : ""}`}
                          onClick={() => setSelectedPrice({ side: "buy", price: level.price })}
                        >
                          {level.price.toFixed(4)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="orderbook-table sell-table">
                <thead>
                  <tr>
                    <th>Sell price</th>
                    <th>Sell count</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedOrderBook.sell.map((level) => (
                    <tr key={`sell-${level.price}`}>
                      <td
                        className="sell-cell has-level"
                        style={{ backgroundColor: getLevelColor("sell", level.count, relatedMaxSellCount) }}
                      >
                        <button
                          type="button"
                          className={`level-price-button ${selectedPrice?.side === "sell" && selectedPrice.price === level.price ? "active" : ""}`}
                          onClick={() => setSelectedPrice({ side: "sell", price: level.price })}
                        >
                          {level.price.toFixed(4)}
                        </button>
                      </td>
                      <td
                        className="sell-cell has-level"
                        style={{ backgroundColor: getLevelColor("sell", level.count, relatedMaxSellCount) }}
                      >
                        <span className={myCompanyPriceMarkers.sell.has(level.price) ? "my-company-count" : ""}>{level.count}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </aside>

        <section className="rates-table-wrapper">
          {autoUpdateStatus && autoUpdateStatus.type === "available" && (
            <div className="update-banner info">
              Обновление найдено: {autoUpdateStatus.version ?? "new version"}. Скачиваем...
            </div>
          )}
          {autoUpdateStatus && autoUpdateStatus.type === "downloaded" && (
            <div className="update-banner success">
              <span>Обновление {autoUpdateStatus.version ?? ""} скачано. Перезапустить сейчас?</span>
              <button type="button" onClick={() => void window.minfinApi.installUpdateNow()}>
                Перезапустить сейчас
              </button>
            </div>
          )}
          {autoUpdateStatus && autoUpdateStatus.type === "error" && (
            <div className="update-banner error">
              Ошибка автообновления: {autoUpdateStatus.message ?? "unknown"}
            </div>
          )}
          <div className="table-state">
            {isLoading && <span>Loading...</span>}
            {error && <span className="error">{error}</span>}
            {!isLoading && !error && (
              <span>
                Rows: {sortedRows.length} | Updated: {lastUpdatedAt ?? "-"} | DataBase Last Update: {databaseLastUpdate ?? "-"}
              </span>
            )}
          </div>
          <div className="rates-table-scroll">
            <table className="rates-table">
              <colgroup>
                {TABLE_COLUMNS.map((column) => (
                  <col key={column.id} style={{ width: `${columnWidths[column.id]}px` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {TABLE_COLUMNS.map((column) => (
                    <th key={column.id} className={column.id === "announcement_link" ? "link-column" : ""}>
                      <button type="button" onClick={() => onSort(column.id)}>
                        {column.label}
                        {sortColumn === column.id ? (sortDirection === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                      <span className="col-resizer" onMouseDown={(event) => startResizeColumn(column.id, event)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td className={row.pinned ? "pinned-office-cell" : ""}>{row.office_name ?? ""}</td>
                    <td>{formatNumber(row.buy_rate, 2)}</td>
                    <td>{formatNumber(row.sell_rate, 2)}</td>
                    <td>{formatNumber(getSpread(row), 2)}</td>
                    <td>{row.address ?? ""}</td>
                    <td className="link-column">
                      <button
                        type="button"
                        className="announcement-link"
                        onClick={() =>
                          void window.minfinApi.openExternalUrl(
                            `https://minfin.com.ua/currency/auction/exchanger/kiev/id-${row.branch_id}/`
                          )
                        }
                        title="Открыть объявление"
                      >
                        L
                      </button>
                    </td>
                    <td>{formatInteger(row.buy_min_count)}</td>
                    <td>{formatInteger(row.buy_max_count)}</td>
                    <td>{formatInteger(row.sell_min_count)}</td>
                    <td>{formatInteger(row.sell_max_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
      {isSettingsOpen && (
        <div className="settings-backdrop">
          <div className="settings-modal">
            <h3>Настройки</h3>
            <label>
              Название компании
              <input
                value={settingsDraftName}
                onChange={(event) => setSettingsDraftName(event.target.value)}
                placeholder="Введите название"
              />
            </label>
            <div className="settings-actions">
              <button type="button" onClick={() => setIsSettingsOpen(false)}>
                Отмена
              </button>
              <button type="button" className="save-btn" onClick={saveSettings}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

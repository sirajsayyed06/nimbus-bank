import React, { useState, useEffect, useMemo, useReducer, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";
import {
  Home, Wallet, ArrowUpCircle, ArrowDownCircle, ListOrdered, TrendingUp,
  Settings as SettingsIcon, Info, LogOut, Search, ChevronLeft, ChevronRight,
  X, AlertTriangle, AlertCircle, CheckCircle2, Bell, Menu, Printer, RotateCcw,
  Sun, Moon, Monitor, ArrowUpRight, ArrowDownRight, PiggyBank, Calendar, Clock,
  Hash, Landmark, ShieldCheck, ChevronDown, Sparkles, Inbox, ArrowUpDown,
} from "lucide-react";

/* ============================================================================
   DATA LAYER — enums, constants, persistence helpers, demo data
   ========================================================================== */

const TxnType = { DEPOSIT: "DEPOSIT", WITHDRAWAL: "WITHDRAWAL", INTEREST: "INTEREST" };
const AccountStatus = { ACTIVE: "ACTIVE" };
const MAX_TRANSACTION_AMOUNT = 10_000_000; // sanity ceiling per transaction

const CURRENCIES = {
  INR: { code: "INR", locale: "en-IN", label: "Indian Rupee" },
  USD: { code: "USD", locale: "en-US", label: "US Dollar" },
  EUR: { code: "EUR", locale: "de-DE", label: "Euro" },
  GBP: { code: "GBP", locale: "en-GB", label: "British Pound" },
};

const STORAGE_KEY_DATA = "bankdemo:data";
const STORAGE_KEY_SETTINGS = "bankdemo:settings";

const DEFAULT_SETTINGS = {
  theme: "system",
  currency: "INR",
  interestRate: 4.5,
  notificationsEnabled: true,
};

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount, currencyCode) {
  const cfg = CURRENCIES[currencyCode] || CURRENCIES.INR;
  try {
    return new Intl.NumberFormat(cfg.locale, {
      style: "currency",
      currency: cfg.code,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)}`;
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(9 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

function buildDemoData() {
  const accountId = "ACC-DEMO-0001";
  const steps = [
    { days: 45, type: TxnType.DEPOSIT, amount: 25000, description: "Initial deposit" },
    { days: 30, type: TxnType.DEPOSIT, amount: 25000, description: "Salary - September" },
    { days: 25, type: TxnType.WITHDRAWAL, amount: 3200, description: "Grocery shopping" },
    { days: 18, type: TxnType.WITHDRAWAL, amount: 2150, description: "Electricity bill" },
    { days: 12, type: TxnType.WITHDRAWAL, amount: 15000, description: "Rent payment" },
    { days: 7, type: TxnType.INTEREST, amount: 1250, description: "Quarterly interest credit" },
    { days: 3, type: TxnType.WITHDRAWAL, amount: 4200, description: "Electronics purchase" },
  ];
  let balance = 0, totalDeposits = 0, totalWithdrawals = 0, totalInterest = 0;
  const transactions = steps.map((s) => {
    if (s.type === TxnType.WITHDRAWAL) {
      balance = round2(balance - s.amount);
      totalWithdrawals = round2(totalWithdrawals + s.amount);
    } else if (s.type === TxnType.DEPOSIT) {
      balance = round2(balance + s.amount);
      totalDeposits = round2(totalDeposits + s.amount);
    } else {
      balance = round2(balance + s.amount);
      totalInterest = round2(totalInterest + s.amount);
    }
    return {
      transactionId: genId("TXN"),
      accountId,
      type: s.type,
      amount: s.amount,
      description: s.description,
      timestamp: daysAgoIso(s.days),
      balanceAfter: balance,
      status: "COMPLETED",
    };
  });
  const account = {
    accountId,
    accountHolderName: "Alex Johnson",
    accountNumber: "XXXX XXXX 4821",
    balance,
    totalDeposits,
    totalWithdrawals,
    totalInterest,
    createdAt: daysAgoIso(45),
    status: AccountStatus.ACTIVE,
  };
  // most-recent-first for display
  transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { account, transactions };
}

async function loadPersisted() {
  let data = null, settings = null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DATA);
    if (raw) data = JSON.parse(raw);
  } catch { /* key missing or corrupted -> fall through to demo seed */ }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) settings = JSON.parse(raw);
  } catch { /* missing/corrupted -> defaults */ }

  // Validate shape; recover gracefully if corrupted
  if (!data || !data.account || !Array.isArray(data.transactions) || typeof data.account.balance !== "number") {
    data = buildDemoData();
  }
  if (!settings || typeof settings !== "object" || !CURRENCIES[settings.currency]) {
    settings = DEFAULT_SETTINGS;
  }
  return { data, settings };
}

async function persist(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage failure (e.g. private browsing quota) shouldn't crash the app —
    // state still lives in memory for the rest of the session.
  }
}

/* ============================================================================
   BUSINESS LOGIC LAYER — validation + pure reducer (single source of truth
   for every balance mutation, so a balance can never change without a
   matching transaction record).
   ========================================================================== */

function validateAmount(raw, { max = MAX_TRANSACTION_AMOUNT } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { valid: false, error: "Please enter an amount." };
  }
  const cleaned = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { valid: false, error: "Enter a valid amount using digits only (up to 2 decimal places)." };
  }
  const amount = parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: "Amount must be greater than zero." };
  }
  if (amount > max) {
    return { valid: false, error: `Amount cannot exceed ${max.toLocaleString()} in a single transaction.` };
  }
  return { valid: true, amount };
}

function calculateSimpleInterest(principal, ratePct, timeYears) {
  const interest = round2((principal * ratePct * timeYears) / 100);
  return { interest, amount: round2(principal + interest) };
}
function calculateCompoundInterest(principal, ratePct, timeYears, n) {
  const amount = principal * Math.pow(1 + ratePct / 100 / n, n * timeYears);
  return { interest: round2(amount - principal), amount: round2(amount) };
}

function bankReducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return action.payload;
    case "DEPOSIT": {
      const { amount, description } = action.payload;
      const balanceAfter = round2(state.account.balance + amount);
      const txn = {
        transactionId: genId("TXN"),
        accountId: state.account.accountId,
        type: TxnType.DEPOSIT,
        amount,
        description: description || "Deposit",
        timestamp: new Date().toISOString(),
        balanceAfter,
        status: "COMPLETED",
      };
      return {
        account: { ...state.account, balance: balanceAfter, totalDeposits: round2(state.account.totalDeposits + amount) },
        transactions: [txn, ...state.transactions],
      };
    }
    case "WITHDRAW": {
      const { amount, description } = action.payload;
      const balanceAfter = round2(state.account.balance - amount);
      const txn = {
        transactionId: genId("TXN"),
        accountId: state.account.accountId,
        type: TxnType.WITHDRAWAL,
        amount,
        description: description || "Withdrawal",
        timestamp: new Date().toISOString(),
        balanceAfter,
        status: "COMPLETED",
      };
      return {
        account: { ...state.account, balance: balanceAfter, totalWithdrawals: round2(state.account.totalWithdrawals + amount) },
        transactions: [txn, ...state.transactions],
      };
    }
    case "APPLY_INTEREST": {
      const { amount } = action.payload;
      const balanceAfter = round2(state.account.balance + amount);
      const txn = {
        transactionId: genId("TXN"),
        accountId: state.account.accountId,
        type: TxnType.INTEREST,
        amount,
        description: "Interest credited to account",
        timestamp: new Date().toISOString(),
        balanceAfter,
        status: "COMPLETED",
      };
      return {
        account: { ...state.account, balance: balanceAfter, totalInterest: round2(state.account.totalInterest + amount) },
        transactions: [txn, ...state.transactions],
      };
    }
    case "RESET_DEMO":
      return buildDemoData();
    default:
      return state;
  }
}

/* ============================================================================
   SMALL SHARED UI PRIMITIVES
   ========================================================================== */

function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="dialog">
        <h3 id="confirm-title" className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel} autoFocus>{cancelLabel}</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  const icons = {
    success: <CheckCircle2 size={18} />,
    warning: <AlertTriangle size={18} />,
    error: <AlertCircle size={18} />,
    info: <Info size={18} />,
  };
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{icons[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatCard({ icon, label, value, sub, tone }) {
  return (
    <div className={`stat-card tone-${tone || "default"}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, message }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-message">{message}</div>
    </div>
  );
}

function TypeBadge({ type }) {
  const cfg = {
    DEPOSIT: { label: "Deposit", cls: "badge-deposit", Icon: ArrowUpRight },
    WITHDRAWAL: { label: "Withdrawal", cls: "badge-withdrawal", Icon: ArrowDownRight },
    INTEREST: { label: "Interest", cls: "badge-interest", Icon: Sparkles },
  }[type];
  const Icon = cfg.Icon;
  return (
    <span className={`badge ${cfg.cls}`}>
      <Icon size={13} /> {cfg.label}
    </span>
  );
}

/* ============================================================================
   NAVIGATION — Sidebar + Header
   ========================================================================== */

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", Icon: Home },
  { key: "balance", label: "Balance", Icon: Wallet },
  { key: "deposit", label: "Deposit", Icon: ArrowUpCircle },
  { key: "withdraw", label: "Withdraw", Icon: ArrowDownCircle },
  { key: "transactions", label: "Transactions", Icon: ListOrdered },
  { key: "interest", label: "Interest calculator", Icon: TrendingUp },
  { key: "settings", label: "Settings", Icon: SettingsIcon },
  { key: "about", label: "About", Icon: Info },
];

function Sidebar({ current, onNavigate, onExit, mobileOpen, onCloseMobile }) {
  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" onClick={onCloseMobile} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Landmark size={20} /></div>
          <div className="brand-text">
            <div className="brand-name">Nimbus Bank</div>
            <div className="brand-tag">demo &amp; educational</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {NAV_ITEMS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`nav-item ${current === key ? "nav-item-active" : ""}`}
              onClick={() => { onNavigate(key); onCloseMobile(); }}
              aria-current={current === key ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="nav-item nav-exit" onClick={() => { onExit(); onCloseMobile(); }}>
          <LogOut size={18} />
          <span>Exit</span>
        </button>
      </aside>
    </>
  );
}

function Header({ title, account, onMenuClick, currency }) {
  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" aria-label="Open navigation menu" onClick={onMenuClick}>
        <Menu size={20} />
      </button>
      <h1 className="page-title">{title}</h1>
      <div className="topbar-right">
        <div className="topbar-balance-chip" title="Available balance">
          <Wallet size={15} />
          <span>{formatCurrency(account.balance, currency)}</span>
        </div>
        <div className="avatar" title={account.accountHolderName}>
          {account.accountHolderName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
        </div>
      </div>
    </header>
  );
}

/* ============================================================================
   CHART HELPERS
   ========================================================================== */

const CHART_COLORS = { deposit: "#12b76a", withdrawal: "#f04438", interest: "#7a5cf0", grid: "var(--border)", axis: "var(--text-muted)" };

function BalanceTrendChart({ transactions, account, currency }) {
  const data = useMemo(() => {
    const asc = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return asc.map((t) => ({ date: formatDate(t.timestamp), balance: t.balanceAfter }));
  }, [transactions]);
  if (data.length === 0) return <EmptyState icon={<TrendingUp size={28} />} title="No trend yet" message="Balance history will appear here once you have transactions." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
        <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={64} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
        <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
        <Line type="monotone" dataKey="balance" stroke="#1f5eff" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BreakdownDonut({ account, currency }) {
  const data = [
    { name: "Deposits", value: account.totalDeposits, color: CHART_COLORS.deposit },
    { name: "Withdrawals", value: account.totalWithdrawals, color: CHART_COLORS.withdrawal },
    { name: "Interest", value: account.totalInterest, color: CHART_COLORS.interest },
  ].filter((d) => d.value > 0);
  if (data.length === 0) return <EmptyState icon={<PiggyBank size={28} />} title="Nothing to show" message="Breakdown appears once you make transactions." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
          {data.map((d, i) => <Cell key={i} fill={d.color} stroke="none" />)}
        </Pie>
        <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function MonthlyActivityChart({ transactions, currency }) {
  const data = useMemo(() => {
    const map = new Map();
    transactions.forEach((t) => {
      const d = new Date(t.timestamp);
      const key = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      if (!map.has(key)) map.set(key, { month: key, deposits: 0, withdrawals: 0, order: d.getFullYear() * 12 + d.getMonth() });
      const row = map.get(key);
      if (t.type === TxnType.DEPOSIT) row.deposits = round2(row.deposits + t.amount);
      if (t.type === TxnType.WITHDRAWAL) row.withdrawals = round2(row.withdrawals + t.amount);
    });
    return Array.from(map.values()).sort((a, b) => a.order - b.order);
  }, [transactions]);
  if (data.length === 0) return <EmptyState icon={<ArrowUpDown size={28} />} title="No activity yet" message="Monthly deposits vs withdrawals will appear here." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
        <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={64} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
        <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="deposits" name="Deposits" fill={CHART_COLORS.deposit} radius={[4, 4, 0, 0]} />
        <Bar dataKey="withdrawals" name="Withdrawals" fill={CHART_COLORS.withdrawal} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ============================================================================
   DASHBOARD
   ========================================================================== */

function DashboardPage({ account, transactions, currency, settings }) {
  const last = transactions[0];
  return (
    <div className="page">
      <div className="hero-card">
        <div className="hero-label">Available balance</div>
        <div className="hero-value">{formatCurrency(account.balance, currency)}</div>
        <div className="hero-meta">
          <span><ShieldCheck size={14} /> {account.status === "ACTIVE" ? "Account active" : account.status}</span>
          <span><Hash size={14} /> {account.accountNumber}</span>
          <span><Calendar size={14} /> Member since {formatDate(account.createdAt)}</span>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard icon={<ArrowUpCircle size={20} />} label="Total deposits" value={formatCurrency(account.totalDeposits, currency)} tone="deposit" />
        <StatCard icon={<ArrowDownCircle size={20} />} label="Total withdrawals" value={formatCurrency(account.totalWithdrawals, currency)} tone="withdrawal" />
        <StatCard icon={<Sparkles size={20} />} label="Interest earned" value={formatCurrency(account.totalInterest, currency)} tone="interest" />
        <StatCard icon={<ListOrdered size={20} />} label="Transactions" value={transactions.length} sub={last ? `Last: ${formatDate(last.timestamp)}` : "No activity yet"} />
      </div>

      <div className="info-strip">
        <div><span className="info-label">Interest rate</span><span className="info-value">{settings.interestRate}% p.a.</span></div>
        <div><span className="info-label">Account status</span><span className="info-value">{account.status}</span></div>
        <div><span className="info-label">Opened on</span><span className="info-value">{formatDate(account.createdAt)}</span></div>
        <div><span className="info-label">Last transaction</span><span className="info-value">{last ? `${formatDate(last.timestamp)} · ${formatTime(last.timestamp)}` : "—"}</span></div>
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <div className="card-header"><h3>Balance trend</h3><span className="card-subtitle">Across all recorded transactions</span></div>
          <BalanceTrendChart transactions={transactions} account={account} currency={currency} />
        </div>
        <div className="card chart-card">
          <div className="card-header"><h3>Transaction breakdown</h3><span className="card-subtitle">Deposits, withdrawals &amp; interest</span></div>
          <BreakdownDonut account={account} currency={currency} />
        </div>
      </div>

      <div className="card chart-card">
        <div className="card-header"><h3>Monthly activity</h3><span className="card-subtitle">Deposits vs withdrawals by month</span></div>
        <MonthlyActivityChart transactions={transactions} currency={currency} />
      </div>

      <div className="card">
        <div className="card-header"><h3>Recent activity</h3></div>
        {transactions.length === 0 ? (
          <EmptyState icon={<Inbox size={28} />} title="No transactions yet" message="Make a deposit to get started." />
        ) : (
          <ul className="recent-list">
            {transactions.slice(0, 5).map((t) => (
              <li key={t.transactionId} className="recent-row">
                <TypeBadge type={t.type} />
                <span className="recent-desc">{t.description}</span>
                <span className="recent-date">{formatDate(t.timestamp)}</span>
                <span className={`recent-amount ${t.type === "WITHDRAWAL" ? "amount-neg" : "amount-pos"}`}>
                  {t.type === "WITHDRAWAL" ? "-" : "+"}{formatCurrency(t.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   BALANCE PAGE
   ========================================================================== */

function BalancePage({ account, transactions, currency, settings }) {
  const net = account.totalDeposits - account.totalWithdrawals;
  const depositShare = account.totalDeposits + account.totalWithdrawals > 0
    ? Math.round((account.totalDeposits / (account.totalDeposits + account.totalWithdrawals)) * 100)
    : 50;
  return (
    <div className="page">
      <div className="hero-card hero-card-alt">
        <div className="hero-label">Current account balance</div>
        <div className="hero-value">{formatCurrency(account.balance, currency)}</div>
        <div className="hero-meta"><span>Available balance is the same as your current balance — no holds are simulated.</span></div>
      </div>

      <div className="stat-grid">
        <StatCard icon={<ArrowUpCircle size={20} />} label="Total deposited" value={formatCurrency(account.totalDeposits, currency)} tone="deposit" />
        <StatCard icon={<ArrowDownCircle size={20} />} label="Total withdrawn" value={formatCurrency(account.totalWithdrawals, currency)} tone="withdrawal" />
        <StatCard icon={<Sparkles size={20} />} label="Total interest earned" value={formatCurrency(account.totalInterest, currency)} tone="interest" />
        <StatCard icon={<TrendingUp size={20} />} label="Current interest rate" value={`${settings.interestRate}% p.a.`} />
      </div>

      <div className="card">
        <div className="card-header"><h3>Deposits vs withdrawals</h3><span className="card-subtitle">Share of total money movement</span></div>
        <div className="progress-track" role="img" aria-label={`${depositShare}% deposits, ${100 - depositShare}% withdrawals`}>
          <div className="progress-fill" style={{ width: `${depositShare}%` }} />
        </div>
        <div className="progress-legend">
          <span><i className="dot dot-deposit" /> Deposits {depositShare}%</span>
          <span><i className="dot dot-withdrawal" /> Withdrawals {100 - depositShare}%</span>
        </div>
        <div className="divider" />
        <div className="kv-row"><span>Net of deposits &amp; withdrawals</span><strong className={net >= 0 ? "amount-pos" : "amount-neg"}>{formatCurrency(net, currency)}</strong></div>
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <div className="card-header"><h3>Balance trend</h3></div>
          <BalanceTrendChart transactions={transactions} account={account} currency={currency} />
        </div>
        <div className="card chart-card">
          <div className="card-header"><h3>Financial summary</h3></div>
          <BreakdownDonut account={account} currency={currency} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   DEPOSIT PAGE
   ========================================================================== */

const DEPOSIT_CATEGORIES = ["Salary", "Business income", "Gift", "Refund", "Savings transfer", "Other"];

function DepositPage({ account, currency, onDeposit }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const parsed = validateAmount(amount);

  const handleContinue = (e) => {
    e.preventDefault();
    const v = validateAmount(amount);
    if (!v.valid) { setError(v.error); return; }
    setError("");
    setConfirmOpen(true);
  };
  const handleConfirm = () => {
    onDeposit(parsed.amount, description.trim() || "Deposit");
    setAmount(""); setDescription(""); setConfirmOpen(false);
  };

  return (
    <div className="page page-narrow">
      <div className="card form-card">
        <div className="card-header"><h3>Make a deposit</h3><span className="card-subtitle">Add money to your account</span></div>
        <form onSubmit={handleContinue} noValidate>
          <label className="field-label" htmlFor="dep-amount">Amount</label>
          <div className="amount-input">
            <span className="amount-prefix">{formatCurrency(0, currency).replace(/[0-9.,\s]/g, "") || "#"}</span>
            <input
              id="dep-amount" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(""); }}
              aria-invalid={!!error} aria-describedby={error ? "dep-amount-error" : undefined}
            />
          </div>
          {error && <div className="field-error" id="dep-amount-error"><AlertCircle size={14} /> {error}</div>}

          <label className="field-label" htmlFor="dep-desc">Description</label>
          <input id="dep-desc" className="text-input" list="dep-cats" placeholder="e.g. Salary" value={description} onChange={(e) => setDescription(e.target.value)} />
          <datalist id="dep-cats">{DEPOSIT_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setAmount(""); setDescription(""); setError(""); }}>Cancel</button>
            <button type="submit" className="btn btn-primary">Review deposit</button>
          </div>
        </form>
      </div>
      <div className="card side-card">
        <h4>Current balance</h4>
        <div className="side-balance">{formatCurrency(account.balance, currency)}</div>
        <p className="muted-text">Deposits are credited instantly in this demo and appear immediately on your dashboard, balance and transaction history.</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm deposit"
        message={`Deposit ${parsed.valid ? formatCurrency(parsed.amount, currency) : ""} as "${description.trim() || "Deposit"}"? Your new balance will be ${parsed.valid ? formatCurrency(account.balance + parsed.amount, currency) : ""}.`}
        confirmLabel="Confirm deposit"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* ============================================================================
   WITHDRAW PAGE
   ========================================================================== */

const WITHDRAW_CATEGORIES = ["Groceries", "Rent", "Utilities", "Shopping", "Travel", "Other"];

function WithdrawPage({ account, currency, onWithdraw }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const parsed = validateAmount(amount);

  const handleContinue = (e) => {
    e.preventDefault();
    const v = validateAmount(amount);
    if (!v.valid) { setError(v.error); return; }
    if (v.amount > account.balance) {
      setError(`Insufficient balance. Available balance: ${formatCurrency(account.balance, currency)}.`);
      return;
    }
    setError("");
    setConfirmOpen(true);
  };
  const handleConfirm = () => {
    onWithdraw(parsed.amount, description.trim() || "Withdrawal");
    setAmount(""); setDescription(""); setConfirmOpen(false);
  };

  return (
    <div className="page page-narrow">
      <div className="card form-card">
        <div className="card-header"><h3>Make a withdrawal</h3><span className="card-subtitle">Available balance: {formatCurrency(account.balance, currency)}</span></div>
        <form onSubmit={handleContinue} noValidate>
          <label className="field-label" htmlFor="wd-amount">Amount</label>
          <div className="amount-input">
            <span className="amount-prefix">{formatCurrency(0, currency).replace(/[0-9.,\s]/g, "") || "#"}</span>
            <input
              id="wd-amount" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(""); }}
              aria-invalid={!!error} aria-describedby={error ? "wd-amount-error" : undefined}
            />
          </div>
          {error && <div className="field-error" id="wd-amount-error"><AlertCircle size={14} /> {error}</div>}

          <label className="field-label" htmlFor="wd-desc">Description / category</label>
          <input id="wd-desc" className="text-input" list="wd-cats" placeholder="e.g. Groceries" value={description} onChange={(e) => setDescription(e.target.value)} />
          <datalist id="wd-cats">{WITHDRAW_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setAmount(""); setDescription(""); setError(""); }}>Cancel</button>
            <button type="submit" className="btn btn-danger">Review withdrawal</button>
          </div>
        </form>
      </div>
      <div className="card side-card">
        <h4>Current balance</h4>
        <div className="side-balance">{formatCurrency(account.balance, currency)}</div>
        <p className="muted-text">Withdrawals are never allowed to push your balance below zero in this demo — there is no overdraft facility.</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm withdrawal"
        message={`Withdraw ${parsed.valid ? formatCurrency(parsed.amount, currency) : ""} for "${description.trim() || "Withdrawal"}"? Your new balance will be ${parsed.valid ? formatCurrency(account.balance - parsed.amount, currency) : ""}.`}
        confirmLabel="Confirm withdrawal"
        danger
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* ============================================================================
   TRANSACTIONS PAGE + DETAIL MODAL
   ========================================================================== */

const PAGE_SIZE = 8;

function TransactionDetailModal({ transaction, currency, onClose }) {
  if (!transaction) return null;
  const prevBalance = round2(
    transaction.type === "WITHDRAWAL" ? transaction.balanceAfter + transaction.amount : transaction.balanceAfter - transaction.amount
  );
  const handlePrint = () => {
    try { window.print(); } catch { /* printing unavailable in this environment */ }
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h3 className="dialog-title">Transaction details</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="receipt">
          <TypeBadge type={transaction.type} />
          <div className="receipt-amount">
            {transaction.type === "WITHDRAWAL" ? "-" : "+"}{formatCurrency(transaction.amount, currency)}
          </div>
          <dl className="receipt-grid">
            <dt>Transaction ID</dt><dd>{transaction.transactionId}</dd>
            <dt>Date</dt><dd>{formatDate(transaction.timestamp)}</dd>
            <dt>Time</dt><dd>{formatTime(transaction.timestamp)}</dd>
            <dt>Description</dt><dd>{transaction.description}</dd>
            <dt>Previous balance</dt><dd>{formatCurrency(prevBalance, currency)}</dd>
            <dt>Balance after</dt><dd>{formatCurrency(transaction.balanceAfter, currency)}</dd>
            <dt>Status</dt><dd><span className="badge badge-status"><CheckCircle2 size={13} /> {transaction.status}</span></dd>
          </dl>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={handlePrint}><Printer size={15} /> Print receipt</button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TransactionsPage({ transactions, currency, onSelect }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("date-desc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (filter !== "ALL") rows = rows.filter((t) => t.type === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        t.transactionId.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q)
      );
    }
    const sorted = [...rows];
    switch (sortBy) {
      case "date-asc": sorted.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); break;
      case "amount-desc": sorted.sort((a, b) => b.amount - a.amount); break;
      case "amount-asc": sorted.sort((a, b) => a.amount - b.amount); break;
      case "type": sorted.sort((a, b) => a.type.localeCompare(b.type)); break;
      case "balance-desc": sorted.sort((a, b) => b.balanceAfter - a.balanceAfter); break;
      default: sorted.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    return sorted;
  }, [transactions, search, filter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, filter, sortBy]);

  return (
    <div className="page">
      <div className="card">
        <div className="card-header"><h3>Transaction history</h3><span className="card-subtitle">{filtered.length} of {transactions.length} transactions</span></div>

        <div className="table-toolbar">
          <div className="search-box">
            <Search size={16} />
            <input placeholder="Search by description, ID or type" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search transactions" />
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Filter by type">
            {[["ALL", "All"], ["DEPOSIT", "Deposits"], ["WITHDRAWAL", "Withdrawals"], ["INTEREST", "Interest"]].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={filter === key} className={`filter-tab ${filter === key ? "filter-tab-active" : ""}`} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="select-wrap">
            <select aria-label="Sort transactions" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="amount-desc">Amount: high to low</option>
              <option value="amount-asc">Amount: low to high</option>
              <option value="type">Type</option>
              <option value="balance-desc">Balance after</option>
            </select>
            <ChevronDown size={14} className="select-caret" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Inbox size={28} />} title="No matching transactions" message="Try a different search term or filter." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="txn-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Time</th><th>Transaction ID</th><th>Type</th><th>Description</th>
                    <th className="col-right">Amount</th><th className="col-right">Balance after</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((t) => (
                    <tr key={t.transactionId} tabIndex={0} onClick={() => onSelect(t)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(t)} className="txn-row">
                      <td>{formatDate(t.timestamp)}</td>
                      <td>{formatTime(t.timestamp)}</td>
                      <td className="mono">{t.transactionId}</td>
                      <td><TypeBadge type={t.type} /></td>
                      <td>{t.description}</td>
                      <td className={`col-right ${t.type === "WITHDRAWAL" ? "amount-neg" : "amount-pos"}`}>
                        {t.type === "WITHDRAWAL" ? "-" : "+"}{formatCurrency(t.amount, currency)}
                      </td>
                      <td className="col-right">{formatCurrency(t.balanceAfter, currency)}</td>
                      <td><span className="badge badge-status"><CheckCircle2 size={13} /> {t.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span className="muted-text">Page {currentPage} of {totalPages}</span>
              <div className="pagination-controls">
                <button className="icon-btn" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
                <button className="icon-btn" disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   INTEREST CALCULATOR PAGE (standalone + account-level)
   ========================================================================== */

function InterestCalculatorPage({ account, currency, settings, onApplyInterest }) {
  const [principal, setPrincipal] = useState(String(account.balance || 10000));
  const [rate, setRate] = useState(String(settings.interestRate));
  const [time, setTime] = useState("1");
  const [freq, setFreq] = useState("1");
  const [mode, setMode] = useState("compound");
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const runCalculation = (e) => {
    e.preventDefault();
    const p = parseFloat(principal), r = parseFloat(rate), t = parseFloat(time), n = parseInt(freq, 10);
    const errs = {};
    if (!Number.isFinite(p) || p <= 0) errs.principal = "Principal must be a positive number.";
    if (!Number.isFinite(r) || r < 0 || r > 100) errs.rate = "Rate must be between 0 and 100%.";
    if (!Number.isFinite(t) || t <= 0) errs.time = "Time period must be greater than zero.";
    if (mode === "compound" && (!Number.isFinite(n) || n <= 0)) errs.freq = "Choose a compounding frequency.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) { setResult(null); return; }

    const calc = mode === "simple" ? calculateSimpleInterest(p, r, t) : calculateCompoundInterest(p, r, t, n);
    const years = Math.max(1, Math.ceil(t));
    const growth = Array.from({ length: years + 1 }, (_, y) => {
      const yr = Math.min(y, t);
      const val = mode === "simple" ? calculateSimpleInterest(p, r, yr).amount : calculateCompoundInterest(p, r, yr, n).amount;
      return { year: `Yr ${y}`, amount: round2(val) };
    });
    setResult({ principal: p, rate: r, time: t, ...calc, growth });
  };

  // Account-level estimate — read-only, live, never mutates balance by itself.
  const estAnnual = round2((account.balance * settings.interestRate) / 100);
  const estMonthly = round2(estAnnual / 12);

  return (
    <div className="page">
      <div className="card form-card">
        <div className="card-header"><h3>Interest calculator</h3><span className="card-subtitle">Simple or compound interest, with a growth projection</span></div>
        <form onSubmit={runCalculation} noValidate>
          <div className="mode-toggle" role="tablist" aria-label="Interest type">
            <button type="button" role="tab" aria-selected={mode === "simple"} className={`mode-tab ${mode === "simple" ? "mode-tab-active" : ""}`} onClick={() => setMode("simple")}>Simple interest</button>
            <button type="button" role="tab" aria-selected={mode === "compound"} className={`mode-tab ${mode === "compound" ? "mode-tab-active" : ""}`} onClick={() => setMode("compound")}>Compound interest</button>
          </div>

          <div className="grid-2">
            <div>
              <label className="field-label" htmlFor="ic-principal">Principal amount</label>
              <input id="ic-principal" className="text-input" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
              {errors.principal && <div className="field-error"><AlertCircle size={14} /> {errors.principal}</div>}
            </div>
            <div>
              <label className="field-label" htmlFor="ic-rate">Annual interest rate (%)</label>
              <input id="ic-rate" className="text-input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              {errors.rate && <div className="field-error"><AlertCircle size={14} /> {errors.rate}</div>}
            </div>
            <div>
              <label className="field-label" htmlFor="ic-time">Time period (years)</label>
              <input id="ic-time" className="text-input" inputMode="decimal" value={time} onChange={(e) => setTime(e.target.value)} />
              {errors.time && <div className="field-error"><AlertCircle size={14} /> {errors.time}</div>}
            </div>
            {mode === "compound" && (
              <div>
                <label className="field-label" htmlFor="ic-freq">Compounding frequency</label>
                <select id="ic-freq" className="text-input" value={freq} onChange={(e) => setFreq(e.target.value)}>
                  <option value="1">Annually</option>
                  <option value="2">Semi-annually</option>
                  <option value="4">Quarterly</option>
                  <option value="12">Monthly</option>
                  <option value="365">Daily</option>
                </select>
                {errors.freq && <div className="field-error"><AlertCircle size={14} /> {errors.freq}</div>}
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Calculate</button>
          </div>
        </form>

        {result && (
          <div className="result-block">
            <div className="stat-grid">
              <StatCard icon={<Wallet size={20} />} label="Principal" value={formatCurrency(result.principal, currency)} />
              <StatCard icon={<TrendingUp size={20} />} label="Interest earned" value={formatCurrency(result.interest, currency)} tone="interest" />
              <StatCard icon={<PiggyBank size={20} />} label="Final amount" value={formatCurrency(result.amount, currency)} tone="deposit" />
              <StatCard icon={<Clock size={20} />} label="Time period" value={`${result.time} yr${result.time == 1 ? "" : "s"}`} />
            </div>
            <div className="card chart-card nested-card">
              <div className="card-header"><h3>Projected growth</h3></div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={result.growth} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: CHART_COLORS.axis }} />
                  <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={64} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                  <Tooltip formatter={(v) => formatCurrency(v, currency)} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 13 }} />
                  <Line type="monotone" dataKey="amount" stroke="#7a5cf0" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="card side-card">
        <h4>Estimated interest on your account</h4>
        <p className="muted-text">Based on your current balance of {formatCurrency(account.balance, currency)} at {settings.interestRate}% p.a.</p>
        <div className="kv-row"><span>Estimated annual interest</span><strong className="amount-pos">{formatCurrency(estAnnual, currency)}</strong></div>
        <div className="kv-row"><span>Estimated monthly interest</span><strong className="amount-pos">{formatCurrency(estMonthly, currency)}</strong></div>
        <button className="btn btn-primary btn-block" onClick={() => setApplyOpen(true)} disabled={estAnnual <= 0}>
          Apply annual interest to account
        </button>
        <p className="muted-text small">This does not happen automatically — nothing is added to your balance unless you confirm below.</p>
      </div>

      <ConfirmDialog
        open={applyOpen}
        title="Apply interest to account"
        message={`This will credit ${formatCurrency(estAnnual, currency)} to your account as an INTEREST transaction. This action cannot be undone. Continue?`}
        confirmLabel="Apply interest"
        onConfirm={() => { onApplyInterest(estAnnual); setApplyOpen(false); }}
        onCancel={() => setApplyOpen(false)}
      />
    </div>
  );
}

/* ============================================================================
   SETTINGS PAGE
   ========================================================================== */

function SettingsPage({ settings, onUpdate, onResetDemo }) {
  const [rateInput, setRateInput] = useState(String(settings.interestRate));
  const [rateError, setRateError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  const commitRate = () => {
    const r = parseFloat(rateInput);
    if (!Number.isFinite(r) || r < 0 || r > 100) {
      setRateError("Enter a rate between 0 and 100%.");
      return;
    }
    setRateError("");
    onUpdate({ ...settings, interestRate: r });
  };

  return (
    <div className="page page-narrow">
      <div className="card">
        <div className="card-header"><h3>Appearance</h3></div>
        <div className="theme-options" role="radiogroup" aria-label="Theme">
          {[["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System default", Monitor]].map(([key, label, Icon]) => (
            <button key={key} role="radio" aria-checked={settings.theme === key} className={`theme-option ${settings.theme === key ? "theme-option-active" : ""}`} onClick={() => onUpdate({ ...settings, theme: key })}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Currency</h3><span className="card-subtitle">Applies across balances, deposits, withdrawals and reports</span></div>
        <div className="select-wrap select-wrap-block">
          <select value={settings.currency} onChange={(e) => onUpdate({ ...settings, currency: e.target.value })} aria-label="Currency">
            {Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
          </select>
          <ChevronDown size={14} className="select-caret" />
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Interest rate</h3><span className="card-subtitle">Default annual rate used for account interest estimates</span></div>
        <div className="rate-row">
          <input className="text-input" inputMode="decimal" value={rateInput} onChange={(e) => setRateInput(e.target.value)} onBlur={commitRate} />
          <span className="rate-suffix">% per year</span>
        </div>
        {rateError && <div className="field-error"><AlertCircle size={14} /> {rateError}</div>}
      </div>

      <div className="card">
        <div className="card-header"><h3>Notifications</h3></div>
        <label className="switch-row">
          <span>Transaction notifications</span>
          <span className={`switch ${settings.notificationsEnabled ? "switch-on" : ""}`} onClick={() => onUpdate({ ...settings, notificationsEnabled: !settings.notificationsEnabled })} role="switch" aria-checked={settings.notificationsEnabled} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onUpdate({ ...settings, notificationsEnabled: !settings.notificationsEnabled })}>
            <span className="switch-knob" />
          </span>
        </label>
      </div>

      <div className="card card-danger">
        <div className="card-header"><h3>Reset demo data</h3><span className="card-subtitle">Restores the original demo account and transactions</span></div>
        <p className="muted-text">This permanently replaces your current account and transaction history with the original demo data. This cannot be undone.</p>
        <button className="btn btn-danger" onClick={() => setResetOpen(true)}><RotateCcw size={15} /> Reset demo data</button>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Reset demo data?"
        message="This will erase all current transactions and restore the original demo account. This action cannot be undone."
        confirmLabel="Reset data"
        danger
        onConfirm={() => { onResetDemo(); setResetOpen(false); }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}

/* ============================================================================
   ABOUT PAGE
   ========================================================================== */

function AboutPage() {
  return (
    <div className="page page-narrow">
      <div className="card about-card">
        <div className="brand-mark brand-mark-lg"><Landmark size={26} /></div>
        <h2>Nimbus Bank</h2>
        <p className="muted-text">Version 1.0.0 — demo build</p>
        <p>
          Nimbus Bank is a demonstration banking system created for educational and software-development
          purposes. It models core banking operations — balances, deposits, withdrawals, transaction history
          and interest — with realistic validation and a persisted local dataset.
        </p>
        <div className="divider" />
        <h4>Technology used</h4>
        <ul className="tech-list">
          <li>React function components with hooks for UI and state</li>
          <li>A reducer-based business logic layer for atomic balance updates</li>
          <li>Recharts for balance, breakdown and activity visualisations</li>
          <li>A local persisted key-value store standing in for a database</li>
        </ul>
        <div className="divider" />
        <p className="disclaimer">
          <AlertTriangle size={16} /> This application does not connect to any real financial institution
          and must not be used to store real account numbers, passwords, or financial information.
        </p>
      </div>
    </div>
  );
}

/* ============================================================================
   ROOT APP
   ========================================================================== */

export default function BankingApp() {
  const [ready, setReady] = useState(false);
  const [state, dispatch] = useReducer(bankReducer, { account: null, transactions: [] });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [page, setPage] = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [exitStage, setExitStage] = useState("none"); // none | confirm | exited
  const [resolvedDark, setResolvedDark] = useState(false);
  const isFirstRun = useRef(true);

  // ---- initial load ----
  useEffect(() => {
    let mounted = true;
    loadPersisted().then(({ data, settings: s }) => {
      if (!mounted) return;
      dispatch({ type: "LOAD", payload: data });
      setSettings(s);
      setReady(true);
    });
    return () => { mounted = false; };
  }, []);

  // ---- persist on change (skip the very first render's load) ----
  useEffect(() => {
    if (!ready) return;
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    persist(STORAGE_KEY_DATA, state);
  }, [state, ready]);

  useEffect(() => {
    if (!ready) return;
    persist(STORAGE_KEY_SETTINGS, settings);
  }, [settings, ready]);

  // ---- theme resolution ----
  useEffect(() => {
    if (settings.theme === "dark") { setResolvedDark(true); return; }
    if (settings.theme === "light") { setResolvedDark(false); return; }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setResolvedDark(mq.matches);
    const handler = (e) => setResolvedDark(e.matches);
    mq.addEventListener ? mq.addEventListener("change", handler) : mq.addListener(handler);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", handler) : mq.removeListener(handler));
  }, [settings.theme]);

  // ---- toasts ----
  const addToast = useCallback((type, message) => {
    const id = genId("TOAST");
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // ---- transaction actions ----
  const handleDeposit = (amount, description) => {
    dispatch({ type: "DEPOSIT", payload: { amount, description } });
    if (settings.notificationsEnabled) addToast("success", `${formatCurrency(amount, settings.currency)} deposited successfully.`);
  };
  const handleWithdraw = (amount, description) => {
    dispatch({ type: "WITHDRAW", payload: { amount, description } });
    if (settings.notificationsEnabled) addToast("success", `${formatCurrency(amount, settings.currency)} withdrawn successfully.`);
  };
  const handleApplyInterest = (amount) => {
    dispatch({ type: "APPLY_INTEREST", payload: { amount } });
    if (settings.notificationsEnabled) addToast("info", `Interest of ${formatCurrency(amount, settings.currency)} credited to your account.`);
  };
  const handleResetDemo = () => {
    dispatch({ type: "RESET_DEMO" });
    setPage("dashboard");
    addToast("success", "Demo data has been reset.");
  };

  if (!ready) {
    return (
      <div className="bank-app" data-theme="light">
        <BankStyles />
        <div className="boot-screen">
          <div className="boot-spinner" />
          <div>Loading your account…</div>
        </div>
      </div>
    );
  }

  if (exitStage === "exited") {
    return (
      <div className="bank-app" data-theme={resolvedDark ? "dark" : "light"}>
        <BankStyles />
        <div className="exit-screen">
          <div className="brand-mark brand-mark-lg"><Landmark size={26} /></div>
          <h2>You've signed out</h2>
          <p className="muted-text">Your data has been saved. Come back any time.</p>
          <button className="btn btn-primary" onClick={() => setExitStage("none")}>Relaunch Nimbus Bank</button>
        </div>
      </div>
    );
  }

  const { account, transactions } = state;
  const pageTitleMap = {
    dashboard: "Dashboard", balance: "Balance", deposit: "Deposit", withdraw: "Withdraw",
    transactions: "Transactions", interest: "Interest calculator", settings: "Settings", about: "About",
  };

  return (
    <div className="bank-app" data-theme={resolvedDark ? "dark" : "light"}>
      <BankStyles />
      <Sidebar current={page} onNavigate={setPage} onExit={() => setExitStage("confirm")} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="app-main">
        <Header title={pageTitleMap[page]} account={account} currency={settings.currency} onMenuClick={() => setMobileNavOpen(true)} />
        <div className="app-content">
          {page === "dashboard" && <DashboardPage account={account} transactions={transactions} currency={settings.currency} settings={settings} />}
          {page === "balance" && <BalancePage account={account} transactions={transactions} currency={settings.currency} settings={settings} />}
          {page === "deposit" && <DepositPage account={account} currency={settings.currency} onDeposit={handleDeposit} />}
          {page === "withdraw" && <WithdrawPage account={account} currency={settings.currency} onWithdraw={handleWithdraw} />}
          {page === "transactions" && <TransactionsPage transactions={transactions} currency={settings.currency} onSelect={setSelectedTxn} />}
          {page === "interest" && <InterestCalculatorPage account={account} currency={settings.currency} settings={settings} onApplyInterest={handleApplyInterest} />}
          {page === "settings" && <SettingsPage settings={settings} onUpdate={setSettings} onResetDemo={handleResetDemo} />}
          {page === "about" && <AboutPage />}
        </div>
      </div>

      <TransactionDetailModal transaction={selectedTxn} currency={settings.currency} onClose={() => setSelectedTxn(null)} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <ConfirmDialog
        open={exitStage === "confirm"}
        title="Are you sure you want to exit?"
        message="All your data has already been saved automatically. You can relaunch the app at any time."
        confirmLabel="Exit"
        danger
        onConfirm={() => setExitStage("exited")}
        onCancel={() => setExitStage("none")}
      />
    </div>
  );
}

/* ============================================================================
   STYLES
   ========================================================================== */

function BankStyles() {
  return (
    <style>{`
      .bank-app {
        --navy-900: #0b1e3d;
        --navy-800: #122a52;
        --navy-700: #1b3a6b;
        --accent: #1f5eff;
        --deposit: #12b76a;
        --withdrawal: #f04438;
        --interest: #7a5cf0;
        --radius-sm: 10px;
        --radius-md: 16px;
        --radius-lg: 22px;
        --font-display: 'Space Grotesk', 'Segoe UI', system-ui, sans-serif;
        --font-body: 'Inter', 'Segoe UI', system-ui, sans-serif;
      }
      .bank-app[data-theme="light"] {
        --bg: #f2f4f8; --surface: #ffffff; --surface-alt: #f7f8fb;
        --text: #101828; --text-muted: #667085; --border: #e4e7ec;
        --shadow: 0 1px 2px rgba(16,24,40,0.06), 0 8px 24px rgba(16,24,40,0.06);
      }
      .bank-app[data-theme="dark"] {
        --bg: #0b1220; --surface: #131c2e; --surface-alt: #101827;
        --text: #eef1f8; --text-muted: #93a0b8; --border: #263248;
        --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 12px 28px rgba(0,0,0,0.35);
      }
      .bank-app {
        font-family: var(--font-body);
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
        display: flex;
        position: relative;
        -webkit-font-smoothing: antialiased;
      }
      .bank-app *, .bank-app *::before, .bank-app *::after { box-sizing: border-box; }
      .bank-app :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .bank-app button { font-family: inherit; cursor: pointer; }
      .bank-app input, .bank-app select { font-family: inherit; }
      .muted-text { color: var(--text-muted); font-size: 13.5px; line-height: 1.5; }
      .muted-text.small { font-size: 12px; }
      .divider { height: 1px; background: var(--border); margin: 16px 0; }

      /* ---------- Sidebar ---------- */
      .sidebar {
        width: 244px; flex-shrink: 0; background: linear-gradient(180deg, var(--navy-900), var(--navy-800));
        color: #eaf0ff; display: flex; flex-direction: column; padding: 22px 14px;
        position: sticky; top: 0; height: 100vh; z-index: 20;
      }
      .brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 22px; }
      .brand-mark { width: 38px; height: 38px; border-radius: 12px; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; color: #cfe0ff; flex-shrink: 0; }
      .brand-mark-lg { width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 14px; background: var(--navy-900); color: #cfe0ff; }
      .brand-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; letter-spacing: 0.2px; }
      .brand-tag { font-size: 11px; color: #9fb3dd; }
      .nav { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
      .nav-item {
        display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px;
        background: transparent; border: none; color: #c9d6f2; text-align: left; font-size: 14px; font-weight: 500;
        transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
      }
      .nav-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
      .nav-item:active { transform: scale(0.98); }
      .nav-item-active { background: rgba(31,94,255,0.28); color: #fff; box-shadow: inset 3px 0 0 var(--accent); }
      .nav-exit { margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 14px; color: #ffb4ac; }
      .nav-exit:hover { background: rgba(240,68,56,0.16); color: #fff; }
      .sidebar-scrim { display: none; }

      /* ---------- Main / header ---------- */
      .app-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .topbar {
        display: flex; align-items: center; gap: 14px; padding: 16px 28px; background: var(--surface);
        border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10;
      }
      .page-title { font-family: var(--font-display); font-size: 20px; font-weight: 600; margin: 0; flex: 1; }
      .topbar-right { display: flex; align-items: center; gap: 14px; }
      .topbar-balance-chip {
        display: flex; align-items: center; gap: 6px; background: var(--surface-alt); border: 1px solid var(--border);
        padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--text);
      }
      .avatar {
        width: 36px; height: 36px; border-radius: 50%; background: var(--navy-900); color: #fff;
        display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;
      }
      .icon-btn { background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 7px; color: var(--text); display: flex; }
      .icon-btn:hover { background: var(--surface-alt); }
      .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      .mobile-only { display: none; }

      .app-content { padding: 24px 28px 48px; flex: 1; }
      .page { display: flex; flex-direction: column; gap: 20px; max-width: 1180px; }
      .page-narrow { max-width: 880px; }

      /* ---------- Hero card ---------- */
      .hero-card {
        background: linear-gradient(135deg, var(--navy-900) 0%, var(--navy-700) 100%);
        color: #fff; border-radius: var(--radius-lg); padding: 28px 30px; box-shadow: var(--shadow);
      }
      .hero-card-alt { background: linear-gradient(135deg, #142850 0%, #1f5eff 130%); }
      .hero-label { font-size: 13px; color: #b9caf0; font-weight: 500; }
      .hero-value { font-family: var(--font-display); font-size: 42px; font-weight: 700; margin: 6px 0 14px; letter-spacing: -0.5px; }
      .hero-meta { display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; color: #cbdaf7; }
      .hero-meta span { display: flex; align-items: center; gap: 6px; }

      /* ---------- Stat cards ---------- */
      .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
      .stat-card {
        background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);
        padding: 18px; display: flex; gap: 14px; align-items: flex-start; box-shadow: var(--shadow);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .stat-card:hover { transform: translateY(-2px); }
      .stat-icon { width: 40px; height: 40px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: var(--surface-alt); color: var(--accent); flex-shrink: 0; }
      .tone-deposit .stat-icon { background: rgba(18,183,106,0.12); color: var(--deposit); }
      .tone-withdrawal .stat-icon { background: rgba(240,68,56,0.12); color: var(--withdrawal); }
      .tone-interest .stat-icon { background: rgba(122,92,240,0.12); color: var(--interest); }
      .stat-label { font-size: 12.5px; color: var(--text-muted); font-weight: 500; }
      .stat-value { font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-top: 2px; }
      .stat-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }

      .info-strip {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; background: var(--surface);
        border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px 18px; box-shadow: var(--shadow);
      }
      .info-strip > div { display: flex; flex-direction: column; gap: 3px; }
      .info-label { font-size: 11.5px; color: var(--text-muted); }
      .info-value { font-size: 14px; font-weight: 600; }

      /* ---------- Cards / charts ---------- */
      .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; box-shadow: var(--shadow); }
      .nested-card { box-shadow: none; border-radius: var(--radius-sm); margin-top: 16px; }
      .card-header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
      .card-header h3 { font-family: var(--font-display); font-size: 16px; margin: 0; font-weight: 600; }
      .card-subtitle { font-size: 12.5px; color: var(--text-muted); }
      .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .card-danger { border-color: rgba(240,68,56,0.35); }

      .recent-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .recent-row { display: flex; align-items: center; gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--border); font-size: 13.5px; }
      .recent-row:last-child { border-bottom: none; }
      .recent-desc { flex: 1; color: var(--text); }
      .recent-date { color: var(--text-muted); font-size: 12.5px; }
      .recent-amount { font-weight: 700; min-width: 100px; text-align: right; }
      .amount-pos { color: var(--deposit); }
      .amount-neg { color: var(--withdrawal); }

      /* ---------- Badges ---------- */
      .badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .badge-deposit { background: rgba(18,183,106,0.12); color: var(--deposit); }
      .badge-withdrawal { background: rgba(240,68,56,0.12); color: var(--withdrawal); }
      .badge-interest { background: rgba(122,92,240,0.12); color: var(--interest); }
      .badge-status { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }

      /* ---------- Buttons ---------- */
      .btn {
        border-radius: 10px; border: 1px solid transparent; padding: 10px 18px; font-size: 14px; font-weight: 600;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.1s ease, opacity 0.15s ease, background 0.15s ease;
      }
      .btn:active { transform: scale(0.98); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-primary { background: var(--accent); color: #fff; }
      .btn-primary:hover:not(:disabled) { background: #1650e0; }
      .btn-danger { background: var(--withdrawal); color: #fff; }
      .btn-danger:hover:not(:disabled) { background: #d63b30; }
      .btn-ghost { background: var(--surface-alt); color: var(--text); border-color: var(--border); }
      .btn-ghost:hover { background: var(--border); }
      .btn-block { width: 100%; margin-top: 12px; }

      /* ---------- Forms ---------- */
      .form-card { display: block; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .field-label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
      .field-label:first-of-type { margin-top: 0; }
      .text-input, select.text-input {
        width: 100%; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--border);
        background: var(--surface-alt); color: var(--text); font-size: 14px; transition: border-color 0.15s ease;
      }
      .text-input:focus { border-color: var(--accent); outline: none; }
      .amount-input {
        display: flex; align-items: center; gap: 4px; border: 1px solid var(--border); background: var(--surface-alt);
        border-radius: 10px; padding: 4px 13px; transition: border-color 0.15s ease;
      }
      .amount-input:focus-within { border-color: var(--accent); }
      .amount-prefix { font-family: var(--font-display); font-weight: 700; color: var(--text-muted); font-size: 18px; }
      .amount-input input { border: none; background: transparent; outline: none; font-size: 20px; font-family: var(--font-display); font-weight: 700; padding: 9px 4px; width: 100%; color: var(--text); }
      .field-error { display: flex; align-items: center; gap: 6px; color: var(--withdrawal); font-size: 12.5px; margin-top: 7px; }
      .form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      .side-card { align-self: flex-start; }
      .side-balance { font-family: var(--font-display); font-size: 26px; font-weight: 700; margin: 6px 0 10px; }
      .result-block { margin-top: 22px; }

      .mode-toggle { display: flex; gap: 8px; margin-bottom: 18px; background: var(--surface-alt); padding: 4px; border-radius: 12px; width: fit-content; }
      .mode-tab { padding: 8px 16px; border-radius: 9px; border: none; background: transparent; font-size: 13.5px; font-weight: 600; color: var(--text-muted); }
      .mode-tab-active { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

      /* ---------- Progress / kv ---------- */
      .progress-track { height: 12px; border-radius: 999px; background: rgba(240,68,56,0.18); overflow: hidden; }
      .progress-fill { height: 100%; background: var(--deposit); border-radius: 999px; transition: width 0.4s ease; }
      .progress-legend { display: flex; gap: 20px; margin-top: 10px; font-size: 13px; color: var(--text-muted); }
      .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 6px; }
      .dot-deposit { background: var(--deposit); }
      .dot-withdrawal { background: var(--withdrawal); }
      .kv-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 14px; }

      /* ---------- Table ---------- */
      .table-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
      .search-box { display: flex; align-items: center; gap: 8px; background: var(--surface-alt); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; flex: 1; min-width: 220px; color: var(--text-muted); }
      .search-box input { border: none; background: transparent; outline: none; color: var(--text); font-size: 13.5px; width: 100%; }
      .filter-tabs { display: flex; gap: 4px; background: var(--surface-alt); padding: 4px; border-radius: 10px; }
      .filter-tab { padding: 7px 12px; border-radius: 8px; border: none; background: transparent; font-size: 13px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
      .filter-tab-active { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
      .select-wrap { position: relative; display: flex; align-items: center; }
      .select-wrap select { appearance: none; padding: 9px 30px 9px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-alt); color: var(--text); font-size: 13px; }
      .select-caret { position: absolute; right: 10px; pointer-events: none; color: var(--text-muted); }
      .select-wrap-block { width: 100%; }
      .select-wrap-block select { width: 100%; }

      .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
      .txn-table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 760px; }
      .txn-table th { text-align: left; padding: 11px 14px; background: var(--surface-alt); color: var(--text-muted); font-weight: 600; font-size: 12px; text-transform: none; border-bottom: 1px solid var(--border); }
      .txn-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); }
      .col-right { text-align: right; }
      .mono { font-family: 'Space Grotesk', monospace; font-size: 12.5px; color: var(--text-muted); }
      .txn-row { cursor: pointer; transition: background 0.12s ease; }
      .txn-row:hover { background: var(--surface-alt); }
      .txn-row:last-child td { border-bottom: none; }
      .pagination { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
      .pagination-controls { display: flex; gap: 6px; }

      /* ---------- Empty state ---------- */
      .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 40px 20px; color: var(--text-muted); }
      .empty-icon { width: 56px; height: 56px; border-radius: 16px; background: var(--surface-alt); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; color: var(--text-muted); }
      .empty-title { font-weight: 700; color: var(--text); margin-bottom: 4px; }
      .empty-message { font-size: 13px; max-width: 320px; }

      /* ---------- Overlay / dialogs ---------- */
      .overlay { position: fixed; inset: 0; background: rgba(9,14,26,0.55); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; animation: fadeIn 0.15s ease; }
      .dialog { background: var(--surface); border-radius: var(--radius-md); padding: 24px; width: 100%; max-width: 420px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); animation: popIn 0.16s ease; }
      .dialog-wide { max-width: 520px; }
      .dialog-head { display: flex; justify-content: space-between; align-items: flex-start; }
      .dialog-title { font-family: var(--font-display); font-size: 17px; margin: 0 0 8px; font-weight: 600; }
      .dialog-message { font-size: 13.5px; color: var(--text-muted); line-height: 1.55; margin: 0; }
      .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

      .receipt { margin-top: 4px; }
      .receipt-amount { font-family: var(--font-display); font-size: 30px; font-weight: 700; margin: 10px 0 16px; }
      .receipt-grid { display: grid; grid-template-columns: 130px 1fr; row-gap: 10px; font-size: 13.5px; }
      .receipt-grid dt { color: var(--text-muted); }
      .receipt-grid dd { margin: 0; font-weight: 500; }

      /* ---------- Toasts ---------- */
      .toast-stack { position: fixed; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 200; max-width: 340px; }
      .toast { display: flex; align-items: flex-start; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); padding: 12px 14px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); animation: slideIn 0.2s ease; font-size: 13.5px; }
      .toast-success { border-left-color: var(--deposit); }
      .toast-warning { border-left-color: #f79009; }
      .toast-error { border-left-color: var(--withdrawal); }
      .toast-info { border-left-color: var(--interest); }
      .toast-icon { margin-top: 1px; }
      .toast-success .toast-icon { color: var(--deposit); }
      .toast-warning .toast-icon { color: #f79009; }
      .toast-error .toast-icon { color: var(--withdrawal); }
      .toast-info .toast-icon { color: var(--interest); }
      .toast-message { flex: 1; }
      .toast-close { background: transparent; border: none; color: var(--text-muted); flex-shrink: 0; }
      @keyframes slideIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }

      /* ---------- Settings ---------- */
      .theme-options { display: flex; gap: 10px; flex-wrap: wrap; }
      .theme-option { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-alt); color: var(--text); font-size: 13.5px; font-weight: 600; }
      .theme-option-active { border-color: var(--accent); background: rgba(31,94,255,0.1); color: var(--accent); }
      .rate-row { display: flex; align-items: center; gap: 10px; max-width: 260px; }
      .rate-suffix { color: var(--text-muted); font-size: 13px; white-space: nowrap; }
      .switch-row { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 500; }
      .switch { width: 44px; height: 26px; border-radius: 999px; background: var(--border); position: relative; display: inline-flex; align-items: center; transition: background 0.15s ease; flex-shrink: 0; }
      .switch-on { background: var(--accent); }
      .switch-knob { width: 20px; height: 20px; border-radius: 50%; background: #fff; position: absolute; left: 3px; transition: transform 0.15s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
      .switch-on .switch-knob { transform: translateX(18px); }

      /* ---------- About / boot / exit ---------- */
      .about-card { text-align: center; }
      .about-card h2 { font-family: var(--font-display); margin: 0 0 4px; }
      .about-card p { text-align: left; font-size: 14px; line-height: 1.6; }
      .tech-list { text-align: left; font-size: 13.5px; line-height: 1.9; color: var(--text-muted); padding-left: 20px; }
      .disclaimer { display: flex; gap: 8px; align-items: flex-start; background: rgba(247,144,9,0.1); color: #b54708; padding: 12px 14px; border-radius: 10px; font-size: 13px; text-align: left; }
      .boot-screen, .exit-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; height: 100vh; width: 100%; text-align: center; color: var(--text); }
      .boot-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ---------- Responsive ---------- */
      @media (max-width: 1080px) {
        .stat-grid { grid-template-columns: repeat(2, 1fr); }
        .info-strip { grid-template-columns: repeat(2, 1fr); }
        .chart-grid { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: 1fr; }
      }
      @media (max-width: 900px) {
        .sidebar { position: fixed; left: -260px; top: 0; transition: left 0.2s ease; box-shadow: 12px 0 40px rgba(0,0,0,0.25); }
        .sidebar-open { left: 0; }
        .sidebar-scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 19; }
        .mobile-only { display: flex; }
        .app-content { padding: 18px 16px 40px; }
        .topbar { padding: 14px 16px; }
        .topbar-balance-chip span { display: none; }
      }
      @media (max-width: 620px) {
        .stat-grid { grid-template-columns: 1fr; }
        .info-strip { grid-template-columns: 1fr; }
        .hero-value { font-size: 32px; }
        .table-toolbar { flex-direction: column; align-items: stretch; }
      }
      @media print {
        .sidebar, .topbar, .toast-stack, .dialog-actions { display: none !important; }
      }
    `}</style>
  );
}

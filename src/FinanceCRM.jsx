import { useEffect, useMemo, useState } from "react";
import logo from "./assets/logo.png";
import * as XLSX from "xlsx"; // ✅ mover import da lib para o topo
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell
} from "recharts";
import { PublicClientApplication } from "@azure/msal-browser";
import { Client } from "@microsoft/microsoft-graph-client";

const BRL = (n) =>
  (Number(n || 0)).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// ======== MSAL CONFIG ========
const msalConfig = {
  auth: {
    clientId: "2d7bcc44-8337-42ec-a3e2-6ba7c9bda91f",
    authority: "https://login.microsoftonline.com/common",
    redirectUri: "http://localhost:5173",
  },
  cache: { cacheLocation: "localStorage" },
};
const msalInstance = new PublicClientApplication(msalConfig);
const graphScopes = ["User.Read", "Files.Read", "Files.Read.All"];

// ======== GRAPH CLIENT ========
async function getGraphClient() {
  // Garante inicialização da instância antes de qualquer uso
  await msalInstance.initialize();

  let account = msalInstance.getAllAccounts()[0];
  if (!account) {
    const login = await msalInstance.loginPopup({ scopes: graphScopes });
    account = login.account;
  }

  const tokenResp = await msalInstance.acquireTokenSilent({ scopes: graphScopes, account })
    .catch(() => msalInstance.acquireTokenPopup({ scopes: graphScopes }));

  console.log("Token obtido:", tokenResp.accessToken.slice(0, 20) + "...");

  return Client.init({
    authProvider: (done) => done(null, tokenResp.accessToken),
  });
}


async function loadExcelAsRows() {
  const client = await getGraphClient();

  try {
    // 1️⃣ Busca o arquivo por nome (em qualquer pasta)
    const search = await client.api(`/me/drive/root/search(q='NFs.xlsx')`).get();

    if (!search.value || search.value.length === 0) {
      console.error("Arquivo NFs.xlsx não encontrado no OneDrive.");
      return [];
    }

    const file = search.value[0];
    console.log("Arquivo localizado:", file.name, "Path:", file.parentReference?.path || "—");


    // 2️⃣ Agora pega o conteúdo da planilha
    const used = await client
      .api(`/me/drive/items/${file.id}/workbook/worksheets('Planilha1')/usedRange`)
      .get();

    const values = used.values || [];
    if (values.length === 0) return [];

    const headers = values[0].map((h) => String(h).trim());
    const rows = values.slice(1).map((row) => {
      const normalized = Object.fromEntries(
        headers.map((h, i) => [String(h).trim().toLowerCase(), row[i]])
      );
      return normalized;
    });
    <pre style={{ color: 'white', fontSize: '0.8rem' }}>
      {JSON.stringify(rows.slice(0, 2), null, 2)}
    </pre>


    console.log(`✅ Planilha carregada com ${rows.length} linhas.`);
    console.log("Dados carregados:", rows);

    return rows;
  } catch (err) {
    console.error("Erro ao ler planilha via Graph:", err);
    return [];
  }
}
// Converte serial do Excel ou string "dd/mm/yyyy" para Date
function toDate(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") {
    // Serial do Excel -> Date (base 1899-12-30)
    const utc = new Date(Date.UTC(1899, 11, 30));
    return new Date(utc.getTime() + val * 86400000);
  }
  if (typeof val === "string") {
    // normaliza "dd/mm/yyyy" ou "yyyy-mm-dd"
    const s = val.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split("/").map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

// Pega o primeiro campo existente no objeto com esses nomes
function pick(obj, keys) {
  const normalize = (k) =>
    k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const allKeys = Object.keys(obj).reduce((acc, k) => {
    acc[normalize(k)] = k;
    return acc;
  }, {});

  for (const key of keys) {
    const nk = normalize(key);
    if (allKeys[nk]) return obj[allKeys[nk]];
  }
  return null;
}



export default function FinanceCRM() {
  // ======== THEME ========
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.classList.add("light");
    else root.classList.remove("light");
    localStorage.setItem("theme", theme);
  }, [theme]);

   // ======== DATA ========
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    async function fetchData() {
      const data = await loadExcelAsRows();
      console.log("Dados carregados:", data);
      setRows(data); // ✅ garante que o estado é atualizado
    }
    fetchData();
  }, []);

  // ======== FILTERS ========
  const [q, setQ] = useState("");
  const clientes = useMemo(
    () => ["Todos", ...Array.from(new Set(rows.map((r) => r.cliente))).sort()],
    [rows]
  );
  const [cliente, setCliente] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const anos = useMemo(
    () =>
      [
        "Todos",
        ...Array.from(new Set(rows.map((r) => parseDate(r.data)?.getFullYear())))
          .filter(Boolean)
          .sort(),
      ],
    [rows]
  );
  const [ano, setAno] = useState("Todos");
  const meses = ["Todos", "01","02","03","04","05","06","07","08","09","10","11","12"];
  const [mes, setMes] = useState("Todos");

  // ======== FILTROS RÁPIDOS ========
  const [quickRange, setQuickRange] = useState("Todos");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const d = parseDate(r.data_pagamento || r.data);
      const matchTxt =
        q.trim() === "" ||
        `${r.cliente} ${r.servico || ""}`.toLowerCase().includes(q.toLowerCase());
      const matchCli = cliente === "Todos" || r.cliente === cliente;
      const matchSt =
        status === "Todos" ||
        (r.status || "").toLowerCase() === status.toLowerCase();

      let matchPeriodo = true;
      if (quickRange !== "Todos" && d) {
        const today = new Date();
        if (quickRange === "30d") {
          const start = new Date();
          start.setDate(today.getDate() - 30);
          matchPeriodo = d >= start && d <= today;
        } else if (quickRange === "90d") {
          const start = new Date();
          start.setDate(today.getDate() - 90);
          matchPeriodo = d >= start && d <= today;
        } else if (quickRange === "YTD") {
          const start = new Date(today.getFullYear(), 0, 1);
          matchPeriodo = d >= start && d <= today;
        }
      }

      const matchAno =
        ano === "Todos" || (d && d.getFullYear().toString() === ano.toString());
      const matchMes =
        mes === "Todos" ||
        (d && String(d.getMonth() + 1).padStart(2, "0") === mes);

      return matchTxt && matchCli && matchSt && matchPeriodo && matchAno && matchMes;
    });
  }, [rows, q, cliente, status, ano, mes, quickRange]);

  // ======== KPIs ========
  const total = filtered.reduce((a, b) => a + Number(b.valor || 0), 0);
  const totalPago = filtered
    .filter((r) => (r.status || "").toLowerCase() === "pago")
    .reduce((a, b) => a + Number(b.valor || 0), 0);
  const totalPend = total - totalPago;

  // ======== ALERTAS DE ATRASO ========
  const atrasados = useMemo(() => {
    const hoje = new Date();

    // Funções auxiliares
    const normalize = (k) =>
      k?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const pick = (obj, keys) => {
      const allKeys = Object.keys(obj).reduce((acc, k) => {
        acc[normalize(k)] = k;
        return acc;
      }, {});
      for (const key of keys) {
        const nk = normalize(key);
        if (allKeys[nk]) return obj[allKeys[nk]];
      }
      return null;
    };

    const toDate = (val) => {
      if (val == null || val === "") return null;
      if (typeof val === "number") {
        const utc = new Date(Date.UTC(1899, 11, 30));
        return new Date(utc.getTime() + val * 86400000);
      }
      if (typeof val === "string") {
        const s = val.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
          const [d, m, y] = s.split("/").map(Number);
          return new Date(y, m - 1, d);
        }
        const d = new Date(s);
        return isNaN(d) ? null : d;
      }
      const d = new Date(val);
      return isNaN(d) ? null : d;
    };

    // Colunas ajustadas para a planilha
    const PAG_KEYS = [
      "data de pagamento",
      "data_pagamento",
      "pagamento",
      "data pagamento"
    ];

    const EMI_KEYS = [
      // Data de emissão agora deve ser “Data de Pagamento” da planilha
      "data de pagamento",
      "data_pagamento",
      "pagamento",
      "data pagamento"
    ];

    const SERV_KEYS = [
      "assunto",
      "descricao",
      "descrição",
      "serviço",
      "servico"
    ];

    return filtered
      .map((r) => {
        const st = String(r.status || "").toLowerCase();

        const rawPag = pick(r, PAG_KEYS);
        const rawEmi = pick(r, EMI_KEYS);
        const rawServ = pick(r, SERV_KEYS);

        const dPag = toDate(rawPag);
        const dEmi = toDate(rawEmi);
        const base = dPag || dEmi;
        const diffDays = base ? Math.floor((hoje - base) / 86400000) : null;

        return {
          ...r,
          servico: rawServ || r.servico || "-",
          __dPag: dPag,
          __dEmi: dEmi,
          __diff: diffDays,
          __statusNorm: st
        };
      })
      .filter((r) => {
        const pendente =
          r.__statusNorm === "pendente" || r.__statusNorm === "atrasado";
        return pendente && r.__diff != null && r.__diff > 0;
      });
  }, [filtered]);




  // ======== CHARTS ========
  const COLORS = [
    "#3b82f6","#22c55e","#f59e0b","#ef4444",
    "#a855f7","#06b6d4","#f97316","#84cc16",
  ];

  const byCliente = useMemo(() => {
    const m = new Map();
    filtered.forEach((r) =>
      m.set(r.cliente, (m.get(r.cliente) || 0) + Number(r.valor || 0))
    );
    return Array.from(m, ([cliente, valor]) => ({ cliente, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 12);
  }, [filtered]);

  const byStatus = useMemo(() => {
    const m = new Map();
    filtered.forEach((r) =>
      m.set(
        r.status || "Indefinido",
        (m.get(r.status || "Indefinido") || 0) + Number(r.valor || 0)
      )
    );
    return Array.from(m, ([status, valor]) => ({ name: status, value: valor }));
  }, [filtered]);

  // ======== EXPORT CSV ========
  function exportCSV() {
    const cols = ["data","cliente","servico","valor","status"];
    const header = cols.join(";");
    const lines = filtered.map((r) =>
      [
        r.data ? new Date(r.data).toLocaleDateString("pt-BR") : "",
        (r.cliente || "").replace(/;/g, ","),
        (r.servico || "").replace(/;/g, ","),
        String(r.valor || 0).replace(".", ","),
        (r.status || ""),
      ].join(";")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financas-filtrado-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ======== MODO COMPACTO ========
  const [compact, setCompact] = useState(false);

  // ======== TABELA ========
  const [limit, setLimit] = useState(5);
  const [showAtrasados, setShowAtrasados] = useState(false);


  return (
    <div className={compact ? "compact" : ""}>
      {/* HEADER */}
      <div className="header">
        <div className="container header-inner">
          <img
            src={logo}
            alt="Clever Connection Logo"
            className="logo"
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "12px",
              marginRight: "12px",
              filter: "drop-shadow(0 0 8px rgba(0, 150, 255, 0.6))",
            }}
          />
          <div className="header-title" style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
            <span style={{
              fontSize: "1.8rem",
              fontWeight: "700",
              color: "var(--primary)"
            }}>
              Clever Connection
            </span>
            <span style={{
              fontSize: "1.2rem",
              fontWeight: "500",
              color: "var(--muted)"
            }}>
              Dashboard Financeiro
            </span>
          </div>

          <div className="header-spacer" />
          <button className="theme-btn" onClick={exportCSV}>⬇️ Exportar CSV</button>
          <button className="theme-btn" onClick={() => setCompact((c) => !c)}>
            {compact ? "🔎 Expandir" : "🗜️ Compactar"}
          </button>
          <button
            className="theme-btn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀️ Claro" : "🌙 Escuro"}
          </button>
        </div>
      </div>

      <div className="container" style={{ paddingTop: 20 }}>
        {/* ALERTA DE ATRASO */}
        {/* Debug de pagamentos atrasados */}
        {/* ALERTA DE PAGAMENTOS EM ATRASO */}
        {atrasados.length > 0 && (
          <div className="card"
              style={{
                background: "rgba(255, 50, 50, 0.15)",
                border: "1px solid rgba(255, 50, 50, 0.4)",
                color: "#fff",
                marginBottom: "16px",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onClick={() => setShowAtrasados(!showAtrasados)}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontWeight: 600,
            }}>
              <span style={{ color: "#f87171" }}>
                ⚠️ Pagamentos em atraso
              </span>
              <span style={{ fontSize: "0.9rem", color: "#ddd" }}>
                {atrasados.length} registro(s) — clientes:{" "}
                {atrasados.map((r) => r.cliente).join(", ")}
              </span>
              <button
                style={{
                  background: "#7f1d1d",
                  border: "none",
                  color: "#fff",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                {showAtrasados ? "🔽 Ocultar" : "🔍 Ver detalhes"}
              </button>
            </div>
          </div>
        )}

        {/* DEBUG EXPANDÍVEL */}
        {showAtrasados && atrasados.length > 0 && (
          <div className="card" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div style={{ fontWeight: 600, color: "#3b82f6", marginBottom: "8px" }}>
              🧮 Pagamentos em Atraso (detalhes)
            </div>
            <table style={{ width: "100%", fontSize: "0.9rem", color: "#ddd" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th>Cliente</th>
                  <th>Serviço</th>
                  <th>Data Pagamento</th>
                  <th>Data Emissão</th>
                  <th>Dias em atraso</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {atrasados.map((r, i) => (
                  <tr key={i}>
                    {/* Cliente */}
                    <td>{r.cliente || "-"}</td>

                    {/* Serviço */}
                    <td>{r.servico || "-"}</td>

                    {/* Data de Pagamento */}
                    <td>
                      {r.__dPag ? r.__dPag.toLocaleDateString("pt-BR") : "-"}
                    </td>

                    {/* Data de Emissão */}
                    <td>
                      {r.__dEmi ? r.__dEmi.toLocaleDateString("pt-BR") : "-"}
                    </td>

                    {/* Dias em atraso */}
                    <td style={{ color: r.__diff > 30 ? "#ef4444" : "#facc15" }}>
                      {r.__diff != null ? `${r.__diff} dias` : "N/A"}
                    </td>

                    {/* Status */}
                    <td>
                      <span className={`badge ${String(r.status || "").toLowerCase()}`}>
                        {r.status || "-"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </div>
        )}




        {/* KPIs */}
        <div className="grid grid-3">
          <div className="card"><div className="kpi-title">Total Recebido</div><div className="kpi-value" style={{ color: "var(--success)" }}>{BRL(totalPago)}</div></div>
          <div className="card"><div className="kpi-title">Total Pendente</div><div className="kpi-value" style={{ color: "var(--warning)" }}>{BRL(totalPend)}</div></div>
          <div className="card"><div className="kpi-title">Total Geral</div><div className="kpi-value" style={{ color: "var(--primary)" }}>{BRL(total)}</div></div>
        </div>

        {/* FILTROS */}
        <div className="card">
          <div className="filters" style={{ alignItems: "flex-start", gap: "14px" }}>
            <input
              className="input"
              placeholder="Pesquisar cliente ou serviço..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="filter-group"><label className="filter-label">Cliente</label><select className="select" value={cliente} onChange={(e) => setCliente(e.target.value)}>{clientes.map((c, index) => (<option key={index} value={c}>{c}</option>))}</select></div>
            <div className="filter-group"><label className="filter-label">Status</label><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>{["Todos","Pago","Pendente","Atrasado"].map((s, index) => (<option key={index} value={s}>{s}</option>))}</select></div>
            <div className="filter-group"><label className="filter-label">ID</label><select className="select" value={mes} onChange={(e) => setMes(e.target.value)}>{meses.map((m, index) => (<option key={index} value={m}>{m}</option>))}</select></div>
            <div className="filter-group"><label className="filter-label">Ano</label><select className="select" value={ano} onChange={(e) => setAno(e.target.value)}>{anos.map((a, index) => (<option key={index} value={a}>{a}</option>))}</select></div>
          </div>

          {/* FILTROS RÁPIDOS */}
          <div className="filter-quick" style={{ marginTop: 10 }}>
            <span className="filter-label">Período rápido:</span>
            {[
              { k: "30d", label: "30 dias" },
              { k: "90d", label: "90 dias" },
              { k: "YTD", label: "Ano atual" },
              { k: "Todos", label: "Todos" },
            ].map((b) => (
              <button
                key={b.k}
                className={`chip ${quickRange === b.k ? "active" : ""}`}
                onClick={() => setQuickRange(b.k)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* GRÁFICOS */}
        {!compact && (
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <div className="card">
              <div className="kpi-title" style={{ marginBottom: 8 }}>
                Top 12 por Cliente
              </div>
              <div style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCliente} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="cliente"
                      tick={{ fill: "#b0b8c1", fontSize: 12, fontWeight: 600 }}
                      interval={0}
                      angle={-20}
                      height={90}
                      tickMargin={10}
                      dy={20}
                    />
                    <YAxis
                      tick={{ fill: "var(--muted)", fontSize: 13, fontWeight: 600 }}
                      domain={[0, (dataMax) => Math.ceil(dataMax * 1.1)]}
                      tickFormatter={(value) => value.toLocaleString("pt-BR")}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(25,25,30,0.95)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        color: "#ffffff",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                      }}
                      itemStyle={{ color: "#fff", fontWeight: 500 }}
                      labelStyle={{ color: "#00aaff", fontWeight: 600 }}
                      formatter={(value) => BRL(value)}
                    />
                    <Bar
                      dataKey="valor"
                      radius={[8, 8, 0, 0]}
                      cursor="pointer"
                      onClick={(data) =>
                        setCliente(cliente === data.cliente ? "Todos" : data.cliente)
                      }
                    >
                      {byCliente.map((entry, i) => (
                        <Cell
                          key={i}
                          fill="url(#barGrad)"
                          stroke={cliente === entry.cliente ? "#93c5fd" : "none"}
                          strokeWidth={cliente === entry.cliente ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <div className="kpi-title" style={{ marginBottom: 8 }}>Por Status</div>
              <div style={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byStatus}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={120}
                      innerRadius={60}
                      stroke="none"
                    >
                      {byStatus.map((e, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(15,15,18,0.98)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#fff",
                        borderRadius: 8,
                        padding: "8px 12px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                      }}
                      itemStyle={{ color: "#fff" }}
                      labelStyle={{ color: "#ccc" }}
                      formatter={(value, name) => [`${BRL(value)}`, `${name}`]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* TABELA */}
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {rows.length > 0 &&
                    Object.keys(rows[0]).map((header, index) => (
                      <th key={index}>{header}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row, index) => (
                  <tr key={index}>
                    {Object.entries(row).map(([key, value], i) => {
                      let formatted = value;

                      // 1️⃣ Formata datas (Excel serial ou string ISO/PT)
                      if (typeof value === "number" && value > 40000 && value < 60000) {
                        const base = new Date(Date.UTC(1899, 11, 30));
                        const d = new Date(base.getTime() + value * 86400000);
                        formatted = d.toLocaleDateString("pt-BR");
                      } else if (
                        typeof value === "string" &&
                        (/\d{4}-\d{2}-\d{2}/.test(value) || /\d{2}\/\d{2}\/\d{4}/.test(value))
                      ) {
                        const d = new Date(value);
                        if (!isNaN(d)) formatted = d.toLocaleDateString("pt-BR");
                      }

                      // 2️⃣ Formata valores monetários
                      if (key.toLowerCase().includes("valor") && !isNaN(value)) {
                        formatted = Number(value).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        });
                      }

                      return <td key={i}>{formatted}</td>;
                    })}
                  </tr>
                ))}
              </tbody>

            </table>

          </div>
          {filtered.length > 5 && (
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              {limit < filtered.length ? (
                <button className="theme-btn" onClick={() => setLimit(limit + 10)}>
                  Listar mais
                </button>
              ) : (
                <button className="theme-btn" onClick={() => setLimit(5)}>
                  Mostrar menos
                </button>
              )}
            </div>
          )}
        </div>

        <div className="footer">
          Clever Connection © {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}

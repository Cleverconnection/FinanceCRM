import { useEffect, useMemo, useState } from "react";
import logo from "./assets/logo.png";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";
import { msalConfig } from "./authConfig";
import { Client } from "@microsoft/microsoft-graph-client";

// ======== FORMATADORES ========
const BRL = (n) =>
  Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// ======== MSAL CONFIGURAÇÃO ========
const msalInstance = new PublicClientApplication(msalConfig);
const graphScopes = ["User.Read", "Files.Read", "Files.Read.All"];
const isMobileDevice =
  typeof navigator !== "undefined" &&
  /Mobi|Android|iPhone|iPad|Mobile/.test(navigator.userAgent || "");
const PAG_KEYS = ["data de pagamento", "data_pagamento", "pagamento", "data pagamento", "data"];
const EMI_KEYS = [
  "data criacao",
  "data de emissao",
  "data de vencimento",
  "emissao",
  "vencimento",
  "data",
];
const SERV_KEYS = ["assunto", "descricao", "descrição", "serviço", "servico"];

// ======== CLIENTE MICROSOFT GRAPH ========
async function acquireToken(scopes) {
  await msalInstance.initialize();

  // Processa retornos de loginRedirect (especialmente em mobile)
  const redirectResult = await msalInstance.handleRedirectPromise();
  if (redirectResult?.account) {
    msalInstance.setActiveAccount(redirectResult.account);
    return { accessToken: redirectResult.accessToken, account: redirectResult.account };
  }

  const doLogin = async () => {
    if (isMobileDevice) {
      await msalInstance.loginRedirect({
        scopes,
        prompt: "select_account",
      });
      return new Promise(() => {}); // fluxo continua no redirect
    }
    const loginResp = await msalInstance.loginPopup({
      scopes,
      prompt: "select_account",
    });
    msalInstance.setActiveAccount(loginResp.account);
    return loginResp;
  };

  let account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  if (!account) {
    const loginResp = await doLogin();
    account = loginResp?.account;
    return { accessToken: loginResp?.accessToken, account };
  }

  msalInstance.setActiveAccount(account);

  try {
    const tokenResponse = await msalInstance.acquireTokenSilent({ scopes, account });
    return { accessToken: tokenResponse.accessToken, account };
  } catch (err) {
    const needsInteraction =
      err instanceof InteractionRequiredAuthError ||
      err.errorCode === "login_required" ||
      err.errorCode === "consent_required" ||
      err.errorCode === "block_iframe_reload" ||
      err.errorCode === "no_tokens_found";

    if (needsInteraction) {
      const loginResp = await doLogin();
      return { accessToken: loginResp?.accessToken, account: loginResp?.account };
    }
    throw err;
  }
}

async function getGraphClient() {
  const { accessToken } = await acquireToken(graphScopes);

  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

// ======== PERFIL DO USUÁRIO MICROSOFT ========
async function getUserProfile(graphClient) {
  const profile = await graphClient.api("/me").get();
  console.log(
    "👤 Usuário logado:",
    profile.displayName,
    profile.mail || profile.userPrincipalName
  );
  return {
    name: profile.displayName,
    email: profile.mail || profile.userPrincipalName,
  };
}

async function getUserPhoto(accessToken, setPhoto) {
  try {
    if (localStorage.getItem("userNoPhoto") === "1") return;
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/photo/$value",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!response.ok) {
      localStorage.setItem("userNoPhoto", "1");
      return;
    }
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    setPhoto(imageUrl);
    localStorage.removeItem("userNoPhoto");
  } catch (error) {
    console.warn("Foto de perfil não encontrada:", error?.message || error);
  }
}

async function loadExcelAsRows() {
  const client = await getGraphClient();

  try {
    const siteId = "d21efab6-83a1-47d8-86ec-68296b31442f";
    const driveId =
      "b!tvoe0qGD2EeG7GgpazFEL5xBSoVgpDdMqENBL3FYLvPKjufZ6TUjRq1KvbMjsPUY";
    const fileId = "01S4Q2WR6ZU56TRNSRLVG2OZW376RKKRSR"; // NFs.xlsx

    const used = await client
      .api(
        `/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets('Planilha1')/usedRange`
      )
      .get();

    const values = used.values || [];
    if (!values.length) return [];

    const headers = values[0].map((h) => String(h).trim());
    const rows = values.slice(1).map((row) =>
      Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), row[i]]))
    );

    console.log(`✅ NFs carregada: ${rows.length} linhas`);
    window._rowsDebug = rows;

    return rows;
  } catch (err) {
    console.error("❌ Erro ao carregar NFs:", err);
    return [];
  }
}

// Converte serial do Excel ou string "dd/mm/yyyy" para Date
function toDate(val) {
  if (val == null || val === "") return null;

  if (typeof val === "number") {
    const excelBaseTime = Date.UTC(1900, 0, 1) - 2 * 86400000;
    const d = new Date(excelBaseTime + val * 86400000 + 43200000);
    return d;
  }

  if (typeof val === "string") {
    const s = val.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split("/").map(Number);
      const dateLocal = new Date(y, m - 1, d);
      dateLocal.setDate(dateLocal.getDate() + 1);
      return dateLocal;
    }

    const d2 = new Date(s);
    return isNaN(d2) ? null : d2;
  }

  const d3 = new Date(val);
  return isNaN(d3) ? null : d3;
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
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "dark"
  );
  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // MENU MOBILE
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ======== AUTH ========
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [userPhoto, setUserPhoto] = useState(null);

  // ======== DATA ========
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoadingAuth(true);

        const storedUserName = localStorage.getItem("userName");
        const storedUserPhoto = localStorage.getItem("userPhoto");

        if (storedUserName) {
          setUser({ name: storedUserName });
        }

        if (storedUserPhoto) {
          setUserPhoto(storedUserPhoto);
        }

        const { accessToken: userToken, account } = await acquireToken(["User.Read"]);
        const client = await getGraphClient();
        const userInfo = await getUserProfile(client);
        setUser(userInfo);

        if (userToken) {
          await getUserPhoto(userToken, setUserPhoto);
        }

        localStorage.setItem("userName", userInfo.name);
        localStorage.setItem("userPhoto", userPhoto || "");
      } catch (err) {
        console.error("Erro ao autenticar ou carregar dados:", err);
        setErrMsg("Falha na autenticação com Microsoft.");
      } finally {
        setLoadingAuth(false);
      }
    }
    fetchProfile();
  }, []);

  useEffect(() => {
    if (loadingAuth || !user) return;

    async function fetchData() {
      setLoading(true);
      const data = await loadExcelAsRows();
      setRows(data);
      setLoading(false);
    }

    fetchData();
  }, [user, loadingAuth]);

  // ======== FILTERS ========
  const [q, setQ] = useState("");
  const clientes = useMemo(
    () => ["Todos", ...Array.from(new Set(rows.map((r) => r.cliente))).sort()],
    [rows]
  );
  const [cliente, setCliente] = useState("Todos");
  const [status, setStatus] = useState("Todos");

  const anos = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set(rows.map((r) => parseDate(r.data)?.getFullYear()))
      )
        .filter(Boolean)
        .sort(),
    ],
    [rows]
  );
  const [ano, setAno] = useState("Todos");

  const meses = [
    "Todos",
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];

  const DATE_KEYS = [
    "data de pagamento",
    "data_pagamento",
    "pagamento",
    "data pagamento",
    "data",
  ];

  const getRowDate = (r) => toDate(pick(r, DATE_KEYS));
  const [mes, setMes] = useState("Todos");

  const matchMes = (data) => {
    if (!data) return true;
    if (mes === "Todos") return true;

    let d;
    if (data.includes("/")) {
      const [dia, mesBR, ano] = data.split("/");
      d = new Date(`${ano}-${mesBR}-${dia}`);
    } else {
      d = new Date(data);
    }

    if (isNaN(d)) return true;
    const mesNome = meses[d.getMonth()];
    return mesNome === mes;
  };

  const columnMap = useMemo(
    () => [
      { key: "id", label: "ID", style: { width: "50px" } },
      { key: "po", label: "PO" },
      { key: "cliente", label: "Cliente" },
      { key: "assunto", label: "Serviço Principal" },
      { key: "valor", label: "Valor", type: "currency" },
      { key: "data criacao", label: "Emissão", type: "date" },
      { key: "data de pagamento", label: "Pagamento", type: "date" },
      { key: "status", label: "Status", type: "status" },
    ],
    []
  );

  // ======== FILTROS RÁPIDOS ========
  const [quickRange, setQuickRange] = useState("Todos");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const d = getRowDate(r);

      const matchTxt =
        q.trim() === "" ||
        `${r.cliente} ${r.servico || ""}`
          .toLowerCase()
          .includes(q.toLowerCase());
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

      const matchMesFiltro =
        mes === "Todos" || (d && meses[d.getMonth() + 1] === mes);

      return (
        matchTxt &&
        matchCli &&
        matchSt &&
        matchPeriodo &&
        matchAno &&
        matchMesFiltro
      );
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

    const PAG_KEYS = ["data de pagamento", "data_pagamento", "pagamento"];
    const EMI_KEYS = [
      "data criacao",
      "data de emissao",
      "data de vencimento",
      "emissao",
      "vencimento",
    ];
    const SERV_KEYS = [
      "assunto",
      "descricao",
      "descrição",
      "serviço",
      "servico",
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
          __statusNorm: st,
        };
      })
      .filter((r) => {
        const pendente =
          r.__statusNorm === "pendente" || r.__statusNorm === "atrasado";
        return pendente && r.__diff != null && r.__diff > 0;
      });
  }, [filtered]);

  // ======== ALERTA: PRÓXIMOS PAGAMENTOS (MÊS ATUAL) ========
  const proximosPagamentos = useMemo(() => {
    const hoje = new Date();
    const mesAtual = hoje.getMonth();
    const anoAtual = hoje.getFullYear();

    return rows
      .map((r) => {
        const d = getRowDate(r);
        return {
          ...r,
          __data: d,
        };
      })
      .filter((r) => {
        if (!r.__data) return false;

        const mes = r.__data.getMonth();
        const ano = r.__data.getFullYear();

        const futuro = r.__data >= hoje;
        const mesmoMes = mes === mesAtual && ano === anoAtual;

        return futuro && mesmoMes;
      })
      .sort((a, b) => a.__data - b.__data);
  }, [rows]);

  // ======== INSIGHTS EXECUTIVOS ========
  const pctPago = total > 0 ? (totalPago / total) * 100 : 0;

  const monthlyTrend = useMemo(() => {
    const base = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
      months.push({ key, label, total: 0, pago: 0 });
    }

    filtered.forEach((r) => {
      const d = getRowDate(r) || toDate(pick(r, EMI_KEYS));
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = months.find((m) => m.key === key);
      if (!bucket) return;
      const valor = Number(r.valor || 0);
      bucket.total += valor;
      if (String(r.status || "").toLowerCase() === "pago") {
        bucket.pago += valor;
      }
    });

    return months;
  }, [filtered]);

  const trendLast = monthlyTrend[monthlyTrend.length - 1] || { pago: 0, total: 0 };
  const trendPrev = monthlyTrend[monthlyTrend.length - 2] || { pago: 0, total: 0 };
  const momPaid =
    trendPrev.pago === 0 ? null : ((trendLast.pago - trendPrev.pago) / trendPrev.pago) * 100;

  const agingBuckets = useMemo(() => {
    const buckets = {
      futuro: 0,
      dias15: 0,
      dias30: 0,
      dias60: 0,
      dias60p: 0,
    };
    const hoje = new Date();

    filtered.forEach((r) => {
      const st = String(r.status || "").toLowerCase();
      if (st === "pago") return;
      const d = getRowDate(r) || toDate(pick(r, EMI_KEYS));
      if (!d) return;
      const diff = Math.floor((hoje - d) / 86400000);
      const valor = Number(r.valor || 0);

      if (diff <= 0) buckets.futuro += valor;
      else if (diff <= 15) buckets.dias15 += valor;
      else if (diff <= 30) buckets.dias30 += valor;
      else if (diff <= 60) buckets.dias60 += valor;
      else buckets.dias60p += valor;
    });

    const totalPendBucket =
      buckets.futuro + buckets.dias15 + buckets.dias30 + buckets.dias60 + buckets.dias60p;

    return {
      chart: [
        { name: "Futuro", valor: buckets.futuro },
        { name: "0-15d", valor: buckets.dias15 },
        { name: "16-30d", valor: buckets.dias30 },
        { name: "31-60d", valor: buckets.dias60 },
        { name: "60d+", valor: buckets.dias60p },
      ],
      totalPendBucket,
    };
  }, [filtered]);

  const avgAging = useMemo(() => {
    const hoje = new Date();
    let sum = 0;
    let count = 0;
    filtered.forEach((r) => {
      const st = String(r.status || "").toLowerCase();
      if (st === "pago") return;
      const d = getRowDate(r) || toDate(pick(r, EMI_KEYS));
      if (!d) return;
      const diff = Math.floor((hoje - d) / 86400000);
      if (isFinite(diff) && diff >= 0) {
        sum += diff;
        count += 1;
      }
    });
    return count === 0 ? 0 : sum / count;
  }, [filtered]);

  const proj30d = useMemo(() => {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(hoje.getDate() + 30);
    return filtered
      .filter((r) => {
        const st = String(r.status || "").toLowerCase();
        if (st === "pago") return false;
        const d = getRowDate(r);
        if (!d) return false;
        return d >= hoje && d <= limite;
      })
      .reduce((acc, r) => acc + Number(r.valor || 0), 0);
  }, [filtered]);

  // ======== CHARTS ========
  const COLORS = [
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#a855f7",
    "#06b6d4",
    "#f97316",
    "#84cc16",
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

  const portfolioShare = useMemo(() => {
    const totalValor = filtered.reduce((a, b) => a + Number(b.valor || 0), 0);
    const ranked = byCliente.map((c) => ({
      ...c,
      share: totalValor > 0 ? (c.valor / totalValor) * 100 : 0,
    }));
    const top5 = ranked.slice(0, 5);
    const top5Share = top5.reduce((a, b) => a + b.share, 0);
    return { ranked, top5Share, totalValor };
  }, [filtered, byCliente]);

  // ======== EXPORT CSV ========
  function exportCSV() {
    const cols = ["data", "cliente", "assunto", "valor", "status"];
    const header = cols.join(";");
    const lines = filtered.map((r) =>
      [
        r["data de pagamento"]
          ? new Date(r["data de pagamento"]).toLocaleDateString("pt-BR")
          : "",
        (r.cliente || "").replace(/;/g, ","),
        (r.assunto || "").replace(/;/g, ","),
        String(r.valor || 0).replace(".", ","),
        r.status || "",
      ].join(";")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financas-filtrado-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportExecutivePDF() {
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) return;
    const totalFmt = BRL(total);
    const pagoFmt = BRL(totalPago);
    const pendFmt = BRL(totalPend);
    const projFmt = BRL(proj30d);
    const topShareFmt = `${portfolioShare.top5Share.toFixed(1)}%`;
    const momFmt =
      momPaid == null ? "N/A" : `${momPaid >= 0 ? "+" : ""}${momPaid.toFixed(1)}%`;
    const trendRows = monthlyTrend
      .map(
        (m) =>
          `<tr><td>${m.label}</td><td>${BRL(m.total)}</td><td>${BRL(
            m.pago
          )}</td></tr>`
      )
      .join("");
    const alerts = [
      `${atrasados.length} atrasos`,
      `${proximosPagamentos.length} próximos neste mês`,
    ].join(" • ");

    win.document.write(`
      <html>
        <head>
          <title>Relatório Executivo - FinanceCRM</title>
          <style>
            body { font-family: 'Arial', sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 8px; }
            h2 { margin: 18px 0 8px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
            .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; background: #f9fafb; }
            .muted { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
            table { width: 100%; border-collapse: collapse; margin-top: 6px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 4px; text-align: left; font-size: 13px; }
            th { background: #eef2ff; }
            .tag { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #e0f2fe; color: #0f172a; font-weight: 700; font-size: 12px; margin-right: 6px; }
          </style>
        </head>
        <body>
          <div class="muted">Relatório Executivo</div>
          <h1>FinanceCRM</h1>
          <div>${new Date().toLocaleString("pt-BR")}</div>

          <div class="grid" style="margin-top:16px;">
            <div class="card"><div class="muted">Recebido</div><div><strong>${pagoFmt}</strong></div></div>
            <div class="card"><div class="muted">Pendente</div><div><strong>${pendFmt}</strong></div></div>
            <div class="card"><div class="muted">% Pago</div><div><strong>${pctPago.toFixed(
              1
            )}%</strong></div></div>
            <div class="card"><div class="muted">M/M Pago</div><div><strong>${momFmt}</strong></div></div>
            <div class="card"><div class="muted">Projeção 30d</div><div><strong>${projFmt}</strong></div></div>
            <div class="card"><div class="muted">Top 5 concentração</div><div><strong>${topShareFmt}</strong></div></div>
          </div>

          <h2>Alertas</h2>
          <div class="tag">${alerts}</div>

          <h2>Tendência (últimos 12 meses)</h2>
          <table>
            <thead><tr><th>Mês</th><th>Total</th><th>Pago</th></tr></thead>
            <tbody>${trendRows}</tbody>
          </table>

          <h2>Top Clientes</h2>
          <table>
            <thead><tr><th>Cliente</th><th>Valor</th><th>%</th></tr></thead>
            <tbody>
              ${portfolioShare.ranked
                .slice(0, 6)
                .map(
                  (c) =>
                    `<tr><td>${c.cliente}</td><td>${BRL(c.valor)}</td><td>${c.share.toFixed(
                      1
                    )}%</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }


  // ======== MODO COMPACTO ========
  const [compact, setCompact] = useState(false);

  // ======== TABELA / ALERTAS STATES ========
  const [limit, setLimit] = useState(5);
  const [showAtrasados, setShowAtrasados] = useState(false);
  const [showProximos, setShowProximos] = useState(false);

  const handleLogout = async () => {
    try {
      await msalInstance.logoutPopup();
      localStorage.clear();
      window.location.reload();
    } catch (err) {
      console.error("Erro ao sair:", err);
    }
  };

  return (
    <div className={compact ? "compact" : ""}>
      {/* HEADER SUPER COMPACTO NO MOBILE */}
      <div className="header">
        <div className="container header-inner">
          <div className="header-left">
            <img src={logo} alt="Clever Connection Logo" className="logo" />
            <span className="header-title-main">Clever Connection</span>
          </div>

          <div className="header-spacer" />

          <div className="header-right">
            {user && (
              <div className="user-info-desktop">
                {userPhoto ? (
                  <img
                    src={userPhoto}
                    alt="Foto do usuário"
                    className="user-avatar"
                  />
                ) : (
                  <div className="user-avatar anonymous">👤</div>
                )}

                <span className="user-name">{user.name}</span>

                <button
                  className="theme-btn"
                  onClick={handleLogout}
                  title="Sair da conta Microsoft"
                >
                  🚪 Sair
                </button>
              </div>
            )}

            <div className="header-actions-desktop">
              <button className="theme-btn" onClick={exportCSV}>
                ⬇️ Exportar CSV
              </button>
              <button className="theme-btn" onClick={exportExecutivePDF}>
                📝 PDF Executivo
              </button>
              <button
                className="theme-btn"
                onClick={() => setCompact((c) => !c)}
              >
                {compact ? "🔎 Expandir" : "🗜️ Compactar"}
              </button>
              <button className="theme-btn" onClick={toggleTheme}>
                {theme === "dark" ? "☀️ Claro" : "🌙 Escuro"}
              </button>
            </div>

            <button
              className="theme-btn mobile-menu-btn"
              onClick={() => setShowMobileMenu(true)}
              aria-expanded={showMobileMenu}
              title="Menu de Ações"
            >
              ⚙️ Menu
            </button>
          </div>
        </div>
      </div>

      {/* MENU MOBILE */}
      {showMobileMenu && (
        <div
          className="mobile-menu-overlay"
          onClick={() => setShowMobileMenu(false)}
        >
          <div
            className="mobile-menu-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-header">
              <h3>Opções</h3>
              <button
                className="close-btn"
                onClick={() => setShowMobileMenu(false)}
                aria-label="Fechar Menu"
              >
                &times;
              </button>
            </div>

            <button
              className="menu-item"
              onClick={() => {
                exportCSV();
                setShowMobileMenu(false);
              }}
            >
              ⬇️ Exportar CSV
            </button>

            <button
              className="menu-item"
              onClick={() => {
                exportExecutivePDF();
                setShowMobileMenu(false);
              }}
            >
              📝 PDF Executivo
            </button>

            <button
              className="menu-item"
              onClick={() => {
                setCompact((c) => !c);
                setShowMobileMenu(false);
              }}
            >
              {compact ? "🔎 Expandir Tabela" : "🗜️ Compactar Tabela"}
            </button>

            <button
              className="menu-item"
              onClick={() => {
                toggleTheme();
                setShowMobileMenu(false);
              }}
            >
              {theme === "dark" ? "☀️ Tema Claro" : "🌙 Tema Escuro"}
            </button>

            <hr />

            {user && (
              <>
                <div className="user-info-mobile">
                  {userPhoto ? (
                    <img src={userPhoto} alt="Foto" />
                  ) : (
                    <div className="user-icon">👤</div>
                  )}
                  <span>
                    Logado como: <b>{user.name}</b>
                  </span>
                </div>
                <button className="menu-item danger" onClick={handleLogout}>
                  🚪 Sair da Conta
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="container" style={{ paddingTop: 16 }}>
        <div className="card hero">
          <div>
            <div className="eyebrow">Dashboard financeiro</div>
            <div className="page-title">FinanceCRM</div>
            <p className="page-subtitle">
              Visão consolidada de notas fiscais e contratos com filtros rápidos e gráficos.
            </p>
            <div className="hero-tags">
              <span className="tag">Registros: {rows.length}</span>
              <span className="tag">Clientes: {clientes.length - 1}</span>
              <span className="tag">
                Período: {quickRange === "Todos" ? "Completo" : quickRange}
              </span>
            </div>
          </div>
        </div>

        {/* ALERTAS RESUMO */}
        <div className="alerts-row">
          {atrasados.length > 0 && (
            <div
              className="card alert-card"
              aria-expanded={showAtrasados}
              role="button"
              tabIndex="0"
              onClick={() => setShowAtrasados(!showAtrasados)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setShowAtrasados(!showAtrasados);
                  e.preventDefault();
                }
              }}
              style={{
                background: "linear-gradient(135deg, rgba(255, 68, 68, 0.18), rgba(120, 15, 35, 0.2))",
                border: "1px solid rgba(255, 68, 68, 0.4)",
                color: "#fff",
                cursor: "pointer",
                transition: "all 0.3s ease",
                maxHeight: "110px",
                overflow: "hidden",
              }}
            >
              <div className="alert-bar">
                <span className="alert-title">⚠️ Pagamentos em atraso</span>

                <span
                  className="alert-summary"
                  title={`Clientes em atraso: ${atrasados
                    .map((r) => r.cliente)
                    .join(", ")}`}
                >
                  {atrasados.length} registro(s) —{" "}
                  {atrasados
                    .map((r) => r.cliente)
                    .slice(0, 2)
                    .join(", ")}
                  {atrasados.length > 2 &&
                    ` e mais ${atrasados.length - 2} cliente(s)`}
                </span>

                <span className={`alert-toggle ${showAtrasados ? "open" : ""}`}>
                  {showAtrasados ? "🔽 Ocultar" : "🔍 Ver detalhes"}
                </span>
              </div>
            </div>
          )}

          {proximosPagamentos.length > 0 && (
            <div
              className="card alert-card"
              role="button"
              tabIndex="0"
              onClick={() => setShowProximos((p) => !p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setShowProximos((p) => !p);
                  e.preventDefault();
                }
              }}
              style={{
                background: "linear-gradient(135deg, rgba(255, 200, 0, 0.18), rgba(120, 100, 20, 0.2))",
                border: "1px solid rgba(255, 200, 0, 0.35)",
                color: "#fff",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
            >
              <div className="alert-bar">
                <span className="alert-title">
                  📅 Próximos Pagamentos (mês atual)
                </span>

                <span className="alert-summary">
                  {proximosPagamentos.length} registro(s) —{" "}
                  {proximosPagamentos
                    .map((r) => r.cliente)
                    .slice(0, 2)
                    .join(", ")}
                  {proximosPagamentos.length > 2 &&
                    ` e mais ${proximosPagamentos.length - 2} cliente(s)`}
                </span>

                <span className="alert-toggle">
                  {showProximos ? "🔽 Ocultar" : "🔍 Ver detalhes"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* DETALHE ATRASOS */}
        {showAtrasados && atrasados.length > 0 && (
          <div className="card" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div
              style={{
                fontWeight: 600,
                color: "#3b82f6",
                marginBottom: "8px",
              }}
            >
              🧮 Pagamentos em Atraso (detalhes)
            </div>

            <div className="table-wrapper">
              <table
                style={{
                  width: "100%",
                  fontSize: "0.9rem",
                  color: "#ddd",
                }}
              >
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Valor</th>
                    <th>Data Emissão</th>
                    <th>Data Pagamento</th>
                    <th>Dias em atraso</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {atrasados.map((r, i) => (
                    <tr key={i}>
                      <td>{r.cliente || "-"}</td>
                      <td>{r.servico || "-"}</td>
                      <td>{BRL(r.valor)}</td>
                      <td>
                        {r.__dEmi
                          ? r.__dEmi.toLocaleDateString("pt-BR")
                          : "-"}
                      </td>
                      <td>
                        {r.__dPag
                          ? r.__dPag.toLocaleDateString("pt-BR")
                          : "-"}
                      </td>
                      <td
                        style={{
                          color: r.__diff > 30 ? "#ef4444" : "#facc15",
                        }}
                      >
                        {r.__diff != null ? `${r.__diff} dias` : "N/A"}
                      </td>
                      <td>
                        <span
                          className={`badge ${String(
                            r.status || ""
                          ).toLowerCase()}`}
                        >
                          {r.status || "-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DETALHES DOS PRÓXIMOS PAGAMENTOS */}
        {showProximos && proximosPagamentos.length > 0 && (
          <div className="card" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div
              style={{
                fontWeight: 600,
                color: "#facc15",
                marginBottom: "8px",
              }}
            >
              📅 Próximos Pagamentos (detalhes)
            </div>

            <div className="table-wrapper">
              <table
                style={{ width: "100%", fontSize: "0.9rem", color: "#ddd" }}
              >
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Serviço</th>
                    <th>Valor</th>
                    <th>Data Pagamento</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {proximosPagamentos.map((r, i) => (
                    <tr key={i}>
                      <td>{r.cliente || "-"}</td>
                      <td>{r.assunto || "-"}</td>
                      <td>{BRL(r.valor)}</td>
                      <td>
                        {r.__data
                          ? r.__data.toLocaleDateString("pt-BR")
                          : "-"}
                      </td>
                      <td>
                        <span
                          className={`badge ${String(
                            r.status || ""
                          ).toLowerCase()}`}
                        >
                          {r.status || "-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* KPIs EXECUTIVOS */}
        <div className="grid kpi-grid">
          <div className="card kpi-card">
            <div className="kpi-title">Recebido</div>
            <div className="kpi-value">{BRL(totalPago)}</div>
            <div className="kpi-sub">Último mês: {BRL(trendLast.pago || 0)}</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-title">Pendente</div>
            <div className="kpi-value">{BRL(totalPend)}</div>
            <div className="kpi-sub">
              Projeção 30d: <strong>{BRL(proj30d)}</strong>
            </div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-title">Total Geral</div>
            <div className="kpi-value">{BRL(total)}</div>
            <div className="kpi-sub">% Pago: {pctPago.toFixed(1)}%</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-title">Maior pagador</div>
            <div className="kpi-value">
              {byCliente[0]?.cliente || "-"}
            </div>
            <div className="kpi-sub">Valor: {BRL(byCliente[0]?.valor || 0)}</div>
          </div>
        </div>

        {/* FILTROS – compactos, 2 colunas no mobile */}
        <div className="card">
          <div className="filter-group" style={{ marginBottom: "16px" }}>
            <label className="filter-label">
              Pesquisar cliente ou serviço
            </label>
            <input
              type="text"
              placeholder="Buscar..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input search-input"
            />
          </div>

          <div className="filters">
            <div className="filter-group">
              <label className="filter-label">Cliente</label>
              <select
                className="select"
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              >
                {clientes.map((c, index) => (
                  <option key={index} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label">Status</label>
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {["Todos", "Pago", "Pendente", "Atrasado"].map((s, index) => (
                  <option key={index} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label">Ano</label>
              <select
                className="select"
                value={ano}
                onChange={(e) => setAno(e.target.value)}
              >
                {anos.map((a, index) => (
                  <option key={index} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label">Mês</label>
              <select
                className="select"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              >
                {meses.map((m, index) => (
                  <option key={index} value={m}>
                    {m === "Todos" ? "Todos" : m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="filter-quick" style={{ marginTop: 12 }}>
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

        {/* GRÁFICOS – empilhados no mobile */}
        {!compact && (
          <>
            <div className="grid charts-grid">
              <div className="card">
                <div className="kpi-title" style={{ marginBottom: 4 }}>
                  Tendência 12 meses
                </div>
                <div className="kpi-sub" style={{ marginBottom: 8 }}>
                  Pago M/M:{" "}
                  {momPaid == null ? "N/A" : `${momPaid >= 0 ? "+" : ""}${momPaid.toFixed(1)}%`}
                </div>
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradPago" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.7} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#b0b8c1", fontSize: 11, fontWeight: 600 }}
                        interval={1}
                      />
                      <YAxis
                        tick={{ fill: "var(--muted)", fontSize: 12, fontWeight: 600 }}
                        tickFormatter={(value) => BRL(value).replace("R$", "")}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "rgba(25,25,30,0.95)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          color: "#ffffff",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                        }}
                        formatter={(value, name) => [BRL(value), name]}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        name="Total"
                        stroke="#3b82f6"
                        fill="url(#gradTotal)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="pago"
                        name="Pago"
                        stroke="#10b981"
                        fill="url(#gradPago)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="kpi-title" style={{ marginBottom: 4 }}>
                  Aging / Risco
                </div>
                <div className="kpi-sub" style={{ marginBottom: 8 }}>
                  Pendências: {BRL(agingBuckets.totalPendBucket)}
                </div>
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agingBuckets.chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#b0b8c1", fontWeight: 600, fontSize: 12 }}
                      />
                      <YAxis
                        tick={{ fill: "var(--muted)", fontSize: 12, fontWeight: 600 }}
                        tickFormatter={(value) => BRL(value).replace("R$", "")}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "rgba(25,25,30,0.95)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          color: "#ffffff",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                        }}
                        formatter={(value) => BRL(value)}
                      />
                      <Bar dataKey="valor" radius={[8, 8, 0, 0]}>
                        {agingBuckets.chart.map((entry, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid charts-grid">
              <div className="card">
                <div className="kpi-title" style={{ marginBottom: 8 }}>
                  Top 12 por Cliente
                </div>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={byCliente}
                      margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" />
                          <stop offset="100%" stopColor="#3b82f6" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="cliente"
                        tick={{
                          fill: "#b0b8c1",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                        interval={0}
                        angle={-20}
                        height={80}
                        tickMargin={10}
                        dy={20}
                      />
                      <YAxis
                        tick={{
                          fill: "var(--muted)",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                        domain={[0, (dataMax) => Math.ceil(dataMax * 1.1)]}
                        tickFormatter={(value) =>
                          value.toLocaleString("pt-BR")
                        }
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
                        labelStyle={{
                          color: "#00aaff",
                          fontWeight: 600,
                        }}
                        formatter={(value) => BRL(value)}
                      />
                      <Bar
                        dataKey="valor"
                        radius={[8, 8, 0, 0]}
                        cursor="pointer"
                        onClick={(data) =>
                          setCliente(
                            cliente === data.cliente ? "Todos" : data.cliente
                          )
                        }
                      >
                        {byCliente.map((entry, i) => (
                          <Cell
                            key={i}
                            fill="url(#barGrad)"
                            stroke={
                              cliente === entry.cliente ? "#93c5fd" : "none"
                            }
                            strokeWidth={cliente === entry.cliente ? 2 : 0}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="kpi-title" style={{ marginBottom: 8 }}>
                  Por Status
                </div>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={byStatus}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={110}
                        innerRadius={55}
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
                        formatter={(value, name) => [BRL(value), name]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </>
        )}

        {/* TABELA */}
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {columnMap.map((col, index) => (
                    <th key={index} style={col.style}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((row, index) => (
                  <tr key={index}>
                    {columnMap.map((col, i) => {
                      const rawValue =
                        row[col.key] || row[col.key.replace(/\s/g, "_")];
                      let formatted = rawValue;

                      if (col.type === "currency") {
                        formatted = BRL(rawValue);
                      } else if (col.type === "date") {
                        const dateObj = toDate(rawValue);
                        formatted = dateObj
                          ? dateObj.toLocaleDateString("pt-BR")
                          : "-";
                      }

                      if (col.type === "status") {
                        const statusText = String(
                          formatted || ""
                        ).toLowerCase();
                        const statusClass =
                          statusText === "pago"
                            ? "pago"
                            : statusText === "pendente"
                            ? "pendente"
                            : statusText === "atrasado"
                            ? "atrasado"
                            : "";

                        return (
                          <td key={i}>
                            <span className={`badge ${statusClass}`}>
                              {formatted || "-"}
                            </span>
                          </td>
                        );
                      }

                      return <td key={i}>{formatted || "-"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 5 && (
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              {limit < filtered.length ? (
                <button
                  className="theme-btn"
                  onClick={() => setLimit(limit + 10)}
                >
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

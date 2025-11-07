import { useEffect, useMemo, useState } from "react";
import logo from "./assets/logo.png";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell
} from "recharts";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "./authConfig";
import { Client } from "@microsoft/microsoft-graph-client";

// ======== FORMATADORES ========
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

// ======== MSAL CONFIGURAÇÃO ========
const msalInstance = new PublicClientApplication(msalConfig);
const graphScopes = ["User.Read", "Files.Read", "Files.Read.All"];

// ======== CLIENTE MICROSOFT GRAPH ========
async function getGraphClient() {
  await msalInstance.initialize();

  let account = msalInstance.getAllAccounts()[0];
  if (!account) {
    const login = await msalInstance.loginPopup({ scopes: graphScopes });
    account = login.account;
  }

  const tokenResp = await msalInstance
    .acquireTokenSilent({ scopes: graphScopes, account })
    .catch(() => msalInstance.acquireTokenPopup({ scopes: graphScopes }));

  console.log("✅ Token obtido:", tokenResp.accessToken.slice(0, 20) + "...");

  return Client.init({
    authProvider: (done) => done(null, tokenResp.accessToken),
  });
}

// ======== PERFIL DO USUÁRIO MICROSOFT ========
async function getUserProfile(graphClient) {
  const profile = await graphClient.api('/me').get();
  console.log('👤 Usuário logado:', profile.displayName, profile.mail || profile.userPrincipalName);
  return {
    name: profile.displayName,
    email: profile.mail || profile.userPrincipalName,
  };
}

async function getUserPhoto(accessToken, setPhoto) {
  try {
    const response = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error("Sem foto de perfil");
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    setPhoto(imageUrl);
  } catch (error) {
    console.warn("Foto de perfil não encontrada:", error);
  }
}

async function loadExcelAsRows() {
  const client = await getGraphClient();

  try {
    // ✅ ID fixo no SharePoint
    const siteId = "d21efab6-83a1-47d8-86ec-68296b31442f";
    const driveId = "b!tvoe0qGD2EeG7GgpazFEL5xBSoVgpDdMqENBL3FYLvPKjufZ6TUjRq1KvbMjsPUY";
    const fileId = "01S4Q2WR6ZU56TRNSRLVG2OZW376RKKRSR"; // NFs.xlsx

    const used = await client
      .api(`/sites/${siteId}/drives/${driveId}/items/${fileId}/workbook/worksheets('Planilha1')/usedRange`)
      .get();

    const values = used.values || [];
    if (!values.length) return [];

    const headers = values[0].map(h => String(h).trim());
    const rows = values.slice(1).map(row =>
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
// Converte serial do Excel ou string "dd/mm/yyyy" para Date
function toDate(val) {
  if (val == null || val === "") return null;
  
  if (typeof val === "number") {
    // Tratamento de Serial do Excel.
    // Usamos o tempo em milissegundos do dia 1 de Janeiro de 1900.
    const excelBaseTime = Date.UTC(1900, 0, 1) - (2 * 86400000); 
    
    // Calcula a data: (base + (dias * ms por dia))
    // ✅ CORREÇÃO: Adiciona 12 horas (43200000 ms) ao total. Isso força a data a ficar no meio do dia
    // em UTC, garantindo que não retroceda para o dia anterior no fuso horário local.
    const d = new Date(excelBaseTime + (val * 86400000) + 43200000);
    
    return d;
  }
  
  if (typeof val === "string") {
    // normaliza "dd/mm/yyyy"
    const s = val.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d, m, y] = s.split("/").map(Number);
      
      // ✅ CORREÇÃO: Cria a data local e adiciona 1 dia para compensar o fuso horário.
      const dateLocal = new Date(y, m - 1, d); 
      dateLocal.setDate(dateLocal.getDate() + 1);
      return dateLocal;
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

  // NOVO ESTADO: Controle do menu mobile
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ======== AUTH ========
  const [user, setUser] = useState(null);       // novo: guarda info do usuário
  const [loadingAuth, setLoadingAuth] = useState(true); // novo: controla carregamento
  const [userPhoto, setUserPhoto] = useState(null);

  // ======== DATA ========
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    async function fetchProfile() {
      try {
        setLoadingAuth(true); // Mostra estado "autenticando..."

        // Verifica se já temos o nome e foto no localStorage
        const storedUserName = localStorage.getItem("userName");
        const storedUserPhoto = localStorage.getItem("userPhoto");

        if (storedUserName) {
          setUser({ name: storedUserName }); // Recupera do localStorage
        }

        if (storedUserPhoto) {
          setUserPhoto(storedUserPhoto); // Recupera a foto do localStorage
        }

        // Se não estiver salvo, realiza a autenticação e recupera os dados
        const client = await getGraphClient();
        const userInfo = await getUserProfile(client);
        setUser(userInfo); // Salva o usuário logado no estado

        // 🔹 Busca a foto do perfil do usuário logado
        const tokenResponse = await msalInstance.acquireTokenSilent({
          scopes: ["User.Read"],
          account: msalInstance.getAllAccounts()[0],
        });
        await getUserPhoto(tokenResponse.accessToken, setUserPhoto);

        // Salva os dados no localStorage para evitar novas requisições
        localStorage.setItem("userName", userInfo.name);
        localStorage.setItem("userPhoto", userPhoto || ""); // Foto, se tiver

      } catch (err) {
        console.error("Erro ao autenticar ou carregar dados:", err);
        setErrMsg("Falha na autenticação com Microsoft.");
      } finally {
        setLoadingAuth(false); // Tira o estado de carregando
      }
    }
    fetchProfile();
  }, []);

  // Linhas 279 (ou após o primeiro useEffect)
  useEffect(() => {
      // Se a autenticação falhou ou não terminou, não carregue os dados
      if (loadingAuth || !user) return; 
      
      // Agora só carregamos os dados
      async function fetchData() {
          setLoading(true); // Exibe loading dos dados
          const data = await loadExcelAsRows();
          setRows(data);
          setLoading(false); // Remove loading dos dados
      }

      fetchData();

      // Dependência: Roda assim que o usuário (e o token) estiverem disponíveis
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
  // filtro por mês com nomes
  // lista de meses (sem "Todos", pois atrapalha o índice)
  const meses = [
    "Todos","Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  // Campos possíveis que representam a "data de pagamento" na planilha
  const DATE_KEYS = [
    "data de pagamento","data_pagamento","pagamento","data pagamento","data"];

  // Usa seu utilitário 'pick' + 'toDate' que já existem no arquivo
  const getRowDate = (r) => toDate(pick(r, DATE_KEYS));
  const [mes, setMes] = useState("Todos");

  const matchMes = (data) => {
    if (!data) return true;
    if (mes === "Todos") return true;

    // tenta converter DD/MM/YYYY -> YYYY-MM-DD
    let d;

    if (data.includes("/")) {
      const [dia, mesBR, ano] = data.split("/");
      d = new Date(`${ano}-${mesBR}-${dia}`);
    } else {
      d = new Date(data);
    }

    if (isNaN(d)) return true; // se der erro na data, deixa passar

    const mesNome = meses[d.getMonth()]; 

    return mesNome === mes;
  };

  // Defina a ordem e o nome amigável das colunas
  const columnMap = useMemo(() => {
      // Estas chaves devem corresponder às chaves minúsculas retornadas do Excel
      return [
          { key: 'id', label: 'ID', style: { width: '50px' } },
          { key: 'po', label: 'PO' },
          { key: 'cliente', label: 'Cliente' },
          { key: 'assunto', label: 'Serviço Principal' },
          { key: 'valor', label: 'Valor', type: 'currency' },
          { key: 'data criacao', label: 'Emissão', type: 'date' }, // Se a chave for 'data criacao'
          { key: 'data de pagamento', label: 'Pagamento', type: 'date' },
          { key: 'status', label: 'Status', type: 'status' },
          // Adicione outras colunas da sua planilha se necessário
      ];
  }, []);

  // ======== FILTROS RÁPIDOS ========
  const [quickRange, setQuickRange] = useState("Todos");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const d = getRowDate(r); // agora pegamos sempre a data correta da planilha


      const matchTxt =
        q.trim() === "" ||
        `${r.cliente} ${r.servico || ""}`.toLowerCase().includes(q.toLowerCase());
      const matchCli = cliente === "Todos" || r.cliente === cliente;
      const matchSt =
        status === "Todos" ||
        (r.status || "").toLowerCase() === status.toLowerCase();

      let matchPeriodo = true;
      // se filtro por mês ou ano estiver ativo, ignora quickRange
      if (quickRange !== "Todos" && d) { // Não precisa mais checar se mes e ano são "Todos"
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

      // mês da linha
      const matchMes =
        mes === "Todos" || (d && meses[d.getMonth() + 1] === mes);

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

    // Colunas ajustadas para a planilha (Data REAL do pagamento)
    const PAG_KEYS = [
      "data de pagamento", // Seu título (Coluna H)
      "data_pagamento",
      "pagamento",
    ];

    // Colunas ajustadas para a planilha (Data LIMITE que o cliente deve pagar / Vencimento)
    const EMI_KEYS = [
      "data criacao", // <--- 🚨 NOVO: Incluindo o título exato da sua Coluna F!
      "data de emissao",
      "data de vencimento",
      "emissao",
      "vencimento",
    ];

    const SERV_KEYS = [
      "assunto","descricao","descrição","serviço","servico"];

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
      const cols = ["data","cliente","assunto","valor","status"];
      const header = cols.join(";");
      const lines = filtered.map((r) =>
        [
          r["data de pagamento"] ? new Date(r["data de pagamento"]).toLocaleDateString("pt-BR") : "",
          (r.cliente || "").replace(/;/g, ","),
          (r.assunto || "").replace(/;/g, ","),
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
  
  const handleLogout = async () => {
    try {
      await msalInstance.logoutPopup(); // Faz logout
      localStorage.clear(); // Limpa os dados no localStorage
      window.location.reload(); // Recarrega a página
    } catch (err) {
      console.error("Erro ao sair:", err);
    }
  };

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
          {/* === INÍCIO: Mostra nome do usuário logado + botão sair (apenas no desktop) === */}
          {user && (
            <div
              className="user-info-desktop" // NOVA CLASSE para controle CSS
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                marginRight: "10px",
              }}
            >
              {userPhoto ? (
                <img
                  src={userPhoto}  // A foto do usuário
                  alt="Foto do usuário"
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid var(--primary)",  // Borda opcional
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    background: "var(--muted)", // Fallback para a cor de fundo
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.2rem",
                  }}
                >
                  👤  {/* Ícone padrão */}
                </div>
              )}

              <span style={{ color: "var(--primary)", fontWeight: 600 }}>
                {user.name}  {/* Nome do usuário */}
              </span>

              <button
                className="theme-btn"
                onClick={handleLogout} // Usa a nova função
                title="Sair da conta Microsoft"
              >
                🚪 Sair
              </button>
            </div>
          )}

          {/* === FIM === */}

          {/* === BOTÕES DE AÇÃO: Agrupados para Desktop. Ocultar no Mobile com CSS === */}
          <div className="header-actions-desktop">
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
          {/* === FIM BOTÕES DESKTOP === */}

          {/* === NOVO: BOTÃO DE MENU MOBILE === */}
          <button
            className="theme-btn mobile-menu-btn" // NOVA CLASSE
            onClick={() => setShowMobileMenu(true)}
            aria-expanded={showMobileMenu}
            title="Menu de Ações"
          >
            ⚙️ Menu
          </button>
        </div>
      </div>

      {/* === NOVO: POP-UP DE MENU MOBILE (Condicional) === */}
      {showMobileMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu-popup" onClick={(e) => e.stopPropagation()}>
            <div className="menu-header">
                <h3>Opções</h3>
                <button className="close-btn" onClick={() => setShowMobileMenu(false)} aria-label="Fechar Menu">
                    &times;
                </button>
            </div>

            {/* AÇÕES */}
            <button className="menu-item" onClick={() => {
                exportCSV();
                setShowMobileMenu(false);
            }}>⬇️ Exportar CSV</button>

            <button className="menu-item" onClick={() => {
                setCompact((c) => !c);
                setShowMobileMenu(false);
            }}>
                {compact ? "🔎 Expandir Tabela" : "🗜️ Compactar Tabela"}
            </button>

            <button className="menu-item" onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
                setShowMobileMenu(false);
            }}>
                {theme === "dark" ? "☀️ Tema Claro" : "🌙 Tema Escuro"}
            </button>
            
            <hr />

            {/* INFORMAÇÃO E LOGOUT DO USUÁRIO */}
            {user && (
                <>
                    <div className="user-info-mobile">
                        {userPhoto ? (
                            <img src={userPhoto} alt="Foto" />
                        ) : (
                            <div className="user-icon">👤</div>
                        )}
                        <span>Logado como: <b>{user.name}</b></span>
                    </div>
                    <button className="menu-item danger" onClick={handleLogout}>
                        🚪 Sair da Conta
                    </button>
                </>
            )}
          </div>
        </div>
      )}

      <div className="container" style={{ paddingTop: 20 }}>
        {/* ALERTA DE ATRASO */}
        {atrasados.length > 0 && (
          <div
            className="card"
            // ✅ 1. Acessibilidade: Div agora é um botão acessível por tab e enter/espaço
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
              background: "rgba(255, 50, 50, 0.15)",
              border: "1px solid rgba(255, 50, 50, 0.4)",
              color: "#fff",
              marginBottom: "16px",
              cursor: "pointer",
              transition: "all 0.3s ease",
              maxHeight: "100px", // Limite de altura
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontWeight: 600,
              }}
            >
              <span style={{ color: "#f87171", flexShrink: 0 }}>
                ⚠️ Pagamentos em atraso
              </span>

              {/* ✅ 2. Otimização UX: Limita clientes e usa ellipsis para evitar overflow */}
              <span
                style={{
                  fontSize: "0.9rem",
                  color: "#ddd",
                  flexGrow: 1, 
                  margin: "0 10px", 
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  textAlign: "right",
                }}
                // Tooltip mostra a lista completa no hover
                title={`Clientes em atraso: ${atrasados.map((r) => r.cliente).join(", ")}`}
              >
                {atrasados.length} registro(s) —{" "}
                {atrasados
                  .map((r) => r.cliente)
                  .slice(0, 3) // Limita a 3 clientes
                  .join(", ")}
                {atrasados.length > 3 && ` e mais ${atrasados.length - 3} cliente(s)`}
              </span>
              
              {/* ✅ 3. Design: Usa span como indicador no lugar do botão redundante */}
              <span
                style={{
                  background: showAtrasados ? "#be185d" : "#7f1d1d",
                  color: "#fff",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  transition: "background 0.3s ease",
                  marginLeft: "10px",
                  flexShrink: 0,
                }}
              >
                {showAtrasados ? "🔽 Ocultar" : "🔍 Ver detalhes"}
              </span>
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
                    {/* Cliente */}
                    <td>{r.cliente || "-"}</td>

                    {/* Serviço */}
                    <td>{r.servico || "-"}</td>

                    {/* Valor */}
                    <td>{BRL(r.valor)}</td>

                    {/* Data de Emissão */}
                    <td>
                      {r.__dEmi ? r.__dEmi.toLocaleDateString("pt-BR") : "-"}
                    </td>

                    {/* Data de Pagamento */}
                    <td>
                      {r.__dPag ? r.__dPag.toLocaleDateString("pt-BR") : "-"}
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
            <div className="filter-group">
              <label className="filter-label">Mês</label>
              <select className="select" value={mes} onChange={(e) => setMes(e.target.value)}>
                {meses.map((m, index) => (
                  <option key={index} value={m}>
                    {m === "Todos" ? "Todos" : `${m}`}
                  </option>
                ))}
              </select>
            </div>

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
          <div className="grid charts-grid">
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
                  {/* Usa o array de mapeamento para os cabeçalhos */}
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
                      const rawValue = row[col.key] || row[col.key.replace(/\s/g, '_')]; // Tenta chave com ou sem espaço
                      let formatted = rawValue;

                      if (col.type === 'currency') {
                        // Formata valores monetários
                        formatted = BRL(rawValue);
                      } else if (col.type === 'date') {
                        // Usa a função toDate que já está corrigida
                        const dateObj = toDate(rawValue);
                        formatted = dateObj ? dateObj.toLocaleDateString("pt-BR") : "-";
                      }

                      if (col.type === 'status') {
                        // Lógica para o badge de Status
                        const statusText = String(formatted || "").toLowerCase();
                        const statusClass = statusText === "pago" ? "pago" : statusText === "pendente" ? "pendente" : statusText === "atrasado" ? "atrasado" : "";

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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Activity,
  Flame,
  ShieldAlert,
  TrendingUp,
  Sparkles,
  Play,
  CheckCircle,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Sliders,
  Cpu,
  Layers,
  Settings,
  Send,
  FileText,
  X,
  HelpCircle,
  Clock,
  Check
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend
} from "recharts";
import { LogEntry, LogLevel, AnomalyType, AlertRule, ActiveAlert, ModelQualityStats, DashboardMetrics } from "./types";

export default function App() {
  // Real-time State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<{
    throughput: number;
    errorRate: number;
    anomalyRate: number;
    averageLatency: number;
    activeScenario: AnomalyType;
    activeAlerts: number;
  }>({
    throughput: 0,
    errorRate: 0,
    anomalyRate: 0,
    averageLatency: 0,
    activeScenario: "NONE",
    activeAlerts: 0
  });

  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const [mqStats, setMqStats] = useState<ModelQualityStats | null>(null);

  // Filter States
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [filterService, setFilterService] = useState<string>("ALL");
  const [filterAnomaliesOnly, setFilterAnomaliesOnly] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // Tab State
  const [chartTab, setChartTab] = useState<"performance" | "model-quality">("performance");

  // Selection & AI State
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState<string>("");
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState<boolean>(false);

  // Custom Log Input & AI Parser playground
  const [customLog, setCustomLog] = useState<string>(
    `2026-06-12 15:31:02.190 [CRIT] [auth-service] User log-in attempt UNION SELECT credit_card FROM payment_users --`
  );
  const [customAnalysis, setCustomAnalysis] = useState<{
    isAnomaly?: boolean;
    anomalyScore?: number;
    confidence?: number;
    service?: string;
    rootCause?: string;
    remediation?: string;
    error?: string;
  } | null>(null);
  const [customAnalyzing, setCustomAnalyzing] = useState<boolean>(false);

  // Model Quality SRE Report State
  const [mqReport, setMqReport] = useState<string>("");
  const [mqReportLoading, setMqReportLoading] = useState<boolean>(false);

  // Ref for log scroll window container
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Timing/Polling triggers
  const [pollingRate, setPollingRate] = useState<number>(2000); // 2 seconds
  const [lastApiLatency, setLastApiLatency] = useState<number>(24);

  // Trigger scenario switch
  const handleSwitchScenario = async (scenario: AnomalyType) => {
    try {
      const response = await fetch("/api/logs/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario })
      });
      const data = await response.json();
      if (data.status === "ok") {
        fetchStatsAndAlerts();
        fetchLogs();
      }
    } catch (err) {
      console.error("Failed to switch scenario:", err);
    }
  };

  // Trigger feedback submission
  const handleSubmitFeedback = async (logId: string, feedback: "accurate" | "inaccurate") => {
    try {
      const response = await fetch("/api/logs/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logId, feedback })
      });
      const data = await response.json();
      if (data.status === "ok") {
        // Optimistically update log entry state
        setLogs(prev =>
          prev.map(l => (l.id === logId ? { ...l, userValidated: true, userFeedback: feedback } : l))
        );
        fetchMqStats();
      }
    } catch (err) {
      console.error("Feedback dispatch failed:", err);
    }
  };

  // Run deep AI Diagnosis on specific Log Entry
  const handleDeepAnalyze = async (log: LogEntry) => {
    setSelectedLog(log);
    setDeepAnalysis("");
    setDeepAnalysisLoading(true);
    try {
      const response = await fetch(`/api/logs/deep-analyze/${log.id}`);
      const data = await response.json();
      if (data.aiAnalysis) {
        setDeepAnalysis(data.aiAnalysis);
      } else if (data.error) {
        setDeepAnalysis(`### ❌ AI Engine Error\n\n${data.error}`);
      }
    } catch (err: any) {
      setDeepAnalysis(`### ❌ Failed to invoke analysis\n\n${err?.message || "Server connection check failure."}`);
    } finally {
      setDeepAnalysisLoading(false);
    }
  };

  // Run AI analysis on custom pasted text
  const handleAnalyzeCustom = async () => {
    if (!customLog.trim()) return;
    setCustomAnalysis(null);
    setCustomAnalyzing(true);
    try {
      const response = await fetch("/api/logs/analyze-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logContent: customLog })
      });
      const data = await response.json();
      setCustomAnalysis(data);
    } catch (err: any) {
      setCustomAnalysis({
        error: err?.message || "Failed to reach AI Analyzer API endpoint."
      });
    } finally {
      setCustomAnalyzing(false);
    }
  };

  // Generate continuous ML Model Quality SRE Report
  const handleGenerateMqReport = async () => {
    setMqReport("");
    setMqReportLoading(true);
    try {
      const response = await fetch("/api/mq-agent/report");
      const data = await response.json();
      setMqReport(data.report || "No response");
    } catch (err: any) {
      setMqReport(`Failed to generate quality evaluation report. Ensure server is active. error: ${err?.message}`);
    } finally {
      setMqReportLoading(false);
    }
  };

  // API Call wrappers
  const fetchLogs = async () => {
    const t0 = performance.now();
    try {
      const res = await fetch("/api/logs?limit=250");
      const data = await res.json();
      setLogs(data);
      const t1 = performance.now();
      setLastApiLatency(Math.round(t1 - t0));
    } catch (err) {
      console.error("Logs fetching error", err);
    }
  };

  const fetchStatsAndAlerts = async () => {
    try {
      const statsRes = await fetch("/api/stats");
      const statsData = await statsRes.json();
      setStats(statsData);

      const alertsRes = await fetch("/api/alerts");
      const alertsData = await alertsRes.json();
      setAlertRules(alertsData.rules);
      setActiveAlerts(alertsData.alerts);
    } catch (err) {
      console.error("Dashboard stats error", err);
    }
  };

  const fetchMqStats = async () => {
    try {
      const res = await fetch("/api/mq-agent");
      const data = await res.json();
      setMqStats(data);
    } catch (err) {
      console.error("Model quality endpoint response issue:", err);
    }
  };

  // Initial and periodic polling
  useEffect(() => {
    fetchLogs();
    fetchStatsAndAlerts();
    fetchMqStats();

    const interval = setInterval(() => {
      fetchLogs();
      fetchStatsAndAlerts();
      fetchMqStats();
    }, pollingRate);

    return () => clearInterval(interval);
  }, [pollingRate]);

  // Autoscroll logic
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = 0; // standard stack is descending timestamp order (api slides latest first)
    }
  }, [logs, autoScroll]);

  // Pre-process logs for charts visualization in real-time
  // Group logs by 10-second segments
  const getPerformanceChartData = () => {
    const reverseLogs = [...logs].reverse();
    if (reverseLogs.length < 2) return [];

    const segments: Record<string, { timeLabel: string; total: number; errors: number; totalLat: number }> = {};
    
    reverseLogs.forEach(l => {
      const d = new Date(l.timestamp);
      // Format to HH:MM:ss with simple truncation
      const timeLabel = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(Math.floor(d.getSeconds() / 10) * 10).padStart(2, "0")}`;
      
      if (!segments[timeLabel]) {
        segments[timeLabel] = { timeLabel, total: 0, errors: 0, totalLat: 0 };
      }
      segments[timeLabel].total++;
      if (["ERROR", "CRITICAL"].includes(l.level) || l.isAnomaly) {
        segments[timeLabel].errors++;
      }
      segments[timeLabel].totalLat += l.latencyMs || 25;
    });

    return Object.values(segments).slice(-15).map(s => ({
      name: s.timeLabel,
      "Log Count": s.total,
      "Anomalies & Errors": s.errors,
      "Avg Latency (ms)": Math.round(s.totalLat / s.total)
    }));
  };

  const performanceData = getPerformanceChartData();

  // Model Quality predictions history formatting
  const getQualityHistoryData = () => {
    if (!mqStats || !mqStats.predictionsHistory) return [];
    return mqStats.predictionsHistory.map(p => {
      const d = new Date(p.timestamp);
      const label = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
      return {
        timestamp: label,
        Accuracy: p.accuracy * 100,
        Confidence: p.confidence,
        Precision: p.precision * 100,
        Drift: p.drift
      };
    });
  };

  const qualityData = getQualityHistoryData();

  // Filter logs for list presentation
  const filteredLogs = logs.filter(l => {
    if (filterLevel !== "ALL" && l.level !== filterLevel) return false;
    if (filterService !== "ALL" && l.service !== filterService) return false;
    if (filterAnomaliesOnly && !l.isAnomaly) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0d0e12] text-[#e1e1e6] font-sans antialiased flex flex-col selection:bg-[#00f2ff] selection:text-[#0d0e12]">
      {/* GLOBAL BACKGROUND ELEMENTS */}
      <style>{`
        :root {
          --bg: #0d0e12;
          --panel-bg: #16181d;
          --border: #2a2d35;
          --accent: #00f2ff;
          --anomaly: #ff3e3e;
          --warning: #f7b500;
          --text-muted: #8e9299;
          --text-primary: #e1e1e6;
        }
        .code-font {
          font-family: 'JetBrains Mono', 'Courier New', Courier, monospace;
        }
        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: #111216;
        }
        ::-webkit-scrollbar-thumb {
          background: #2a2d35;
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #3a3f4a;
        }
      `}</style>

      {/* TOP HEADER */}
      <header className="h-14 bg-[#16181d] border-b border-[#2a2d35] px-6 flex items-center justify-between shrink-0 shadow-lg z-20">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00ff9d] inline-block shadow-[0_0_12px_#00ff9d] animate-pulse"></span>
          </div>
          <div className="flex items-baseline gap-2">
            <span id="logo-branding" className="font-extrabold tracking-wider text-sm uppercase text-transparent bg-clip-text bg-gradient-to-r from-[#00f2ff] to-[#00ff9d]">
              Sentinel Log Anomaly Agent
            </span>
            <span className="text-[10px] uppercase text-[#8e9299] bg-[#2a2d35] px-1.5 py-0.5 rounded code-font font-semibold">
              v2.5 Deep AI Pro
            </span>
          </div>
        </div>

        {/* METRICS & HEADING INDICATORS */}
        <div className="hidden lg:flex items-center gap-6 text-xs text-[#8e9299]">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-[#8e9299]">SIMULATOR</span>
            <span className="text-white code-font font-bold">
              {stats.activeScenario === "NONE" ? "🟢 STANDBY (NORMAL)" : `🚨 ANOMALY: ${stats.activeScenario}`}
            </span>
          </div>
          <div className="h-6 w-px bg-[#2a2d35]"></div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-[#8e9299]">REST INFRA</span>
            <span className="text-white code-font font-bold flex items-center gap-1">
              CONNECTED <span className="text-[#00f2ff]">({lastApiLatency}ms)</span>
            </span>
          </div>
          <div className="h-6 w-px bg-[#2a2d35]"></div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-[#8e9299]">POLLING RATE</span>
            <select
              value={pollingRate}
              onChange={(e) => setPollingRate(Number(e.target.value))}
              className="bg-transparent text-[#00f2ff] font-bold focus:outline-none cursor-pointer focus:ring-0"
            >
              <option value="1000" className="bg-[#16181d] text-white">1.0s (Fast)</option>
              <option value="2000" className="bg-[#16181d] text-white">2.0s (Std)</option>
              <option value="5000" className="bg-[#16181d] text-white">5.0s (Loose)</option>
            </select>
          </div>
        </div>

        {/* REFRESH STATUS */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchLogs();
              fetchStatsAndAlerts();
              fetchMqStats();
            }}
            title="Force refresh database arrays"
            className="p-1 px-2 text-[#00f2ff] hover:text-white bg-[#1a2c3a] border border-[#00f2ff]/30 hover:border-[#00f2ff] rounded transition-all duration-200 flex items-center gap-1.5 text-xs font-semibold"
            id="force-refresh-btn"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          
          <div className="text-[11px] code-font bg-[#222530] border border-[#2a2d35] px-2.5 py-1 rounded text-white flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#00f2ff]" />
            <span>UTC Clock Live</span>
          </div>
        </div>
      </header>

      {/* DASHBOARD CONTAINER GRID */}
      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden w-full max-w-[1920px] mx-auto">
        
        {/* LEFT COLUMN: SIMULATOR & GRAFANA ALERTS */}
        <aside className="w-full xl:w-[310px] bg-[#16181d] border-b xl:border-b-0 xl:border-r border-[#2a2d35] flex flex-col shrink-0 overflow-y-auto p-4 gap-4">
          
          {/* SIMULATOR CARD */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3.5 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[#e1e1e6] font-bold text-xs uppercase tracking-wider">
                <Sliders className="w-4 h-4 text-[#00f2ff]" />
                <h3>Sustained Threat Simulator</h3>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-[#f7b500] font-semibold uppercase animate-pulse">
                Interactive
              </span>
            </div>
            
            <p className="text-[11px] text-[#8e9299] mb-3 leading-relaxed">
              Dynamically switch streaming log behaviors. Inject target anomalies to audit model precision &amp; Grafana rules reactivity in real-time.
            </p>

            <div className="grid grid-cols-2 gap-2" id="sim-scenarios-box">
              <button
                onClick={() => handleSwitchScenario("NONE")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "NONE"
                    ? "bg-[#00f2ff]/10 text-[#00f2ff] border-[#00f2ff]"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                🟢 Standard Logs
              </button>
              <button
                onClick={() => handleSwitchScenario("DDOS")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "DDOS"
                    ? "bg-red-500/10 text-red-400 border-red-500"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                🔴 checkout DDoS
              </button>
              <button
                onClick={() => handleSwitchScenario("SQL_INJECTION")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "SQL_INJECTION"
                    ? "bg-purple-900/40 text-purple-400 border-purple-500"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                🛡️ SQL Injection
              </button>
              <button
                onClick={() => handleSwitchScenario("DB_STARVATION")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "DB_STARVATION"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                🗄️ Pool Starving
              </button>
              <button
                onClick={() => handleSwitchScenario("JWT_FLOOD")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "JWT_FLOOD"
                    ? "bg-pink-500/10 text-pink-400 border-pink-500"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                🔑 JWT Expired
              </button>
              <button
                onClick={() => handleSwitchScenario("DISK_FULL")}
                className={`py-1.5 px-2 rounded font-semibold text-xs text-left transition-all border ${
                  stats.activeScenario === "DISK_FULL"
                    ? "bg-orange-500/10 text-orange-400 border-orange-500"
                    : "bg-[#111216] text-[#8e9299] border-transparent hover:border-[#2a2d35] hover:text-white"
                }`}
              >
                💾 Storage Full
              </button>
            </div>
          </div>

          {/* ACTIVE RULE ENGINE TARGETS (GRAFANA METRICS STYLE) */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3.5 flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-[#e1e1e6] font-bold text-xs uppercase tracking-wider">
                <Flame className="w-4 h-4 text-orange-400" />
                <h3>Grafana Alerts Engine</h3>
              </div>
              <span className="text-[10px] bg-[#2a2d35] text-white px-2 py-0.5 rounded font-mono font-bold">
                {activeAlerts.filter(a => a.status === "ACTIVE").length} Firing
              </span>
            </div>

            <div className="flex flex-col gap-2.5 overflow-y-auto flex-1 pr-1" id="grafana-rules-monitor">
              {alertRules.map((rule) => {
                const isFiring = rule.status === "FIRING";
                const isPending = rule.status === "PENDING";
                return (
                  <div
                    key={rule.id}
                    className={`p-2.5 rounded border transition-all ${
                      isFiring
                        ? "bg-red-500/5 border-red-500/30"
                        : isPending
                        ? "bg-amber-500/5 border-amber-500/30"
                        : "bg-[#111216] border-[#222530]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-bold text-white truncate max-w-[170px]" title={rule.name}>
                        {rule.name}
                      </span>
                      <span
                        className={`text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded code-font ${
                          isFiring
                            ? "bg-red-500 text-white animate-pulse"
                            : isPending
                            ? "bg-amber-500 text-[#0d0e12]"
                            : "bg-[#222530] text-[#8e9299]"
                        }`}
                      >
                        {rule.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#8e9299]">
                      <span>
                        Metric: <strong className="text-[#e1e1e6] font-mono">{rule.metric}</strong>
                      </span>
                      <span>
                        SLA Window: <strong className="text-white font-mono">{rule.windowSeconds}s</strong>
                      </span>
                    </div>

                    <div className="mt-1.5 text-[10px] flex justify-between items-center bg-[#16181d] p-1 px-2 rounded text-[#8e9299]">
                      <span>Rule constraint: {rule.metric === "latency" ? `> ${rule.threshold}ms` : `> ${rule.threshold}%`}</span>
                      {rule.lastTriggered && (
                        <span className="text-white scale-90">
                          Last Trigger: {new Date(rule.lastTriggered).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FIRING ALERTS NOTIFICATION LOG SUB-CONSOLE */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3 text-xs">
            <h4 className="text-[10px] text-[#8e9299] uppercase tracking-wider mb-2 font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              Firing Alerts Timeline
            </h4>
            <div className="max-h-[140px] overflow-y-auto space-y-2 pr-1 code-font" id="alerting-timeline">
              {activeAlerts.length === 0 ? (
                <div className="text-center text-[#8e9299] py-4 italic text-[11px]">
                  All thresholds optimal. 0 alerts firing in pipeline.
                </div>
              ) : (
                activeAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-2 rounded text-[11px] border ${
                      alert.status === "ACTIVE"
                        ? "bg-red-950/20 border-red-500/40 text-red-300"
                        : "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-0.5">
                      <strong className="font-semibold truncate">{alert.ruleName}</strong>
                      <span className="text-[9px] text-[#8e9299]">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[10px] leading-tight text-[#8e9299] mb-1">{alert.message}</p>
                    <span className="text-[9px] uppercase tracking-wide bg-black/40 px-1 py-0.2 rounded">
                      {alert.status === "ACTIVE" ? "🔴 Firing" : "🟢 OK (RESOLVED)"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </aside>

        {/* CENTER COLUMN: METRICS, CHARTS, AND REALTIME STREAMING EVENTS */}
        <main className="flex-1 bg-[#0d0e12] border-r border-[#2a2d35] p-4 flex flex-col gap-4 overflow-y-auto">
          
          {/* 4 METRICS KPI ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            
            {/* KPI 1 */}
            <div className="bg-[#16181d] border border-[#2a2d35] rounded p-3 flex flex-col justify-between shadow relative overflow-hidden">
              <div className="text-[11px] text-[#8e9299] uppercase font-bold tracking-wider mb-2">
                Ingress Density (24H)
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-[#00f2ff] code-font" id="throughput-kpi-val">
                  1,482/s
                </span>
                <span className="text-[10px] text-[#00ff9d] bg-[#00ff9d]/10 px-1 rounded">
                  ▲ +14.2%
                </span>
              </div>
              <div className="mt-3 h-1 bg-[#2a2d35] rounded-full overflow-hidden">
                <div className="h-full bg-[#00f2ff] rounded-full" style={{ width: "75%" }}></div>
              </div>
            </div>

            {/* KPI 2 */}
            <div className="bg-[#16181d] border border-[#2a2d35] rounded p-3 flex flex-col justify-between shadow relative overflow-hidden">
              <div className="text-[11px] text-[#8e9299] uppercase font-bold tracking-wider mb-2">
                Errors Rate (30s)
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`text-2xl font-black code-font ${
                    stats.errorRate > 15 ? "text-[#ff3e3e]" : "text-white"
                  }`}
                  id="error-rate-kpi-val"
                >
                  {stats.errorRate}%
                </span>
                <span
                  className={`text-[10px] px-1 rounded ${
                    stats.errorRate > 15 ? "text-[#ff3e3e] bg-[#ff3e3e]/10 animate-pulse" : "text-[#8e9299] bg-[#2a2d35]"
                  }`}
                >
                  {stats.errorRate > 15 ? "Warning Critical" : "Nominal"}
                </span>
              </div>
              <div className="mt-3 h-1 bg-[#2a2d35] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${stats.errorRate > 15 ? "bg-[#ff3e3e]" : "bg-white"}`}
                  style={{ width: `${Math.min(100, stats.errorRate * 4)}%` }}
                ></div>
              </div>
            </div>

            {/* KPI 3 */}
            <div className="bg-[#16181d] border border-[#2a2d35] rounded p-3 flex flex-col justify-between shadow relative overflow-hidden">
              <div className="text-[11px] text-[#8e9299] uppercase font-bold tracking-wider mb-2">
                Anomaly Frequency
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`text-2xl font-black code-font ${
                    stats.anomalyRate > 2 ? "text-[#ff3e3e]" : "text-emerald-400"
                  }`}
                  id="anomaly-rate-kpi-val"
                >
                  {stats.anomalyRate}%
                </span>
                <span className="text-[11px] text-[#8e9299]">Weighted</span>
              </div>
              <div className="mt-3 h-1 bg-[#2a2d35] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${stats.anomalyRate > 2 ? "bg-[#ff3e3e]" : "bg-emerald-400"}`}
                  style={{ width: `${Math.min(100, stats.anomalyRate * 12)}%` }}
                ></div>
              </div>
            </div>

            {/* KPI 4 */}
            <div className="bg-[#16181d] border border-[#2a2d35] rounded p-3 flex flex-col justify-between shadow relative overflow-hidden">
              <div className="text-[11px] text-[#8e9299] uppercase font-bold tracking-wider mb-2">
                Mean Latency
              </div>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-2xl font-black text-[#f7b500] code-font" id="latency-kpi-val">
                  {stats.averageLatency}ms
                </span>
                <span className="text-[10px] text-zinc-400">RTT Target &lt; 200</span>
              </div>
              <div className="mt-3 h-1 bg-[#2a2d35] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#f7b500] rounded-full"
                  style={{ width: `${Math.min(100, (stats.averageLatency / 1000) * 100)}%` }}
                ></div>
              </div>
            </div>

          </div>

          {/* CHARTS CONTAINER SECTION */}
          <div className="bg-[#16181d] border border-[#2a2d35] rounded shadow-md flex flex-col">
            <div className="border-b border-[#2a2d35] px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-white">
                <Activity className="w-4 h-4 text-[#00f2ff]" />
                <h3>Ingress Analysis &amp; Classifier Performance</h3>
              </div>

              {/* TAB SELECTORS */}
              <div className="flex bg-[#0d0e12] rounded p-0.5 border border-[#2a2d35]">
                <button
                  onClick={() => setChartTab("performance")}
                  className={`px-3 py-1 text-xs rounded transition-all font-semibold ${
                    chartTab === "performance"
                      ? "bg-[#16181d] text-[#00f2ff] shadow"
                      : "text-[#8e9299] hover:text-white"
                  }`}
                >
                  Latency &amp; Volume Trends
                </button>
                <button
                  onClick={() => setChartTab("model-quality")}
                  className={`px-3 py-1 text-xs rounded transition-all font-semibold ${
                    chartTab === "model-quality"
                      ? "bg-[#16181d] text-[#00f2ff] shadow"
                      : "text-[#8e9299] hover:text-white"
                  }`}
                >
                  Quality Drifts Tracking
                </button>
              </div>
            </div>

            {/* CHART DISPLAY PANEL */}
            <div className="p-4" style={{ height: "240px" }} id="recharts-panel-wrapper">
              {chartTab === "performance" ? (
                performanceData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[#8e9299] text-xs italic">
                    Acquiring live streaming data vectors... Please trigger scenarios to inject timeline patterns.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={performanceData}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00f2ff" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#00f2ff" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff3e3e" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#ff3e3e" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222530" />
                      <XAxis dataKey="name" stroke="#8e9299" fontSize={10} tickLine={false} />
                      <YAxis yAxisId="left" stroke="#8e9299" fontSize={10} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" stroke="#f7b500" fontSize={10} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#16181d",
                          borderColor: "#2a2d35",
                          color: "#e1e1e6",
                          fontSize: "11px"
                        }}
                      />
                      <Legend verticalAlign="top" height={24} iconSize={10} style={{ fontSize: "11px" }} />
                      <Area yAxisId="left" type="monotone" dataKey="Log Count" stroke="#00f2ff" strokeWidth={1.5} fillOpacity={1} fill="url(#colorCount)" />
                      <Area yAxisId="left" type="monotone" dataKey="Anomalies &amp; Errors" stroke="#ff3e3e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorErrors)" />
                      <Line yAxisId="right" type="monotone" dataKey="Avg Latency (ms)" stroke="#f7b500" strokeWidth={2} activeDot={{ r: 4 }} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )
              ) : (
                qualityData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[#8e9299] text-xs italic">
                    No timeline checkpoints stored yet. Metrics update on anomaly state shifts.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={qualityData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222530" />
                      <XAxis dataKey="timestamp" stroke="#8e9299" fontSize={10} tickLine={false} />
                      <YAxis stroke="#8e9299" fontSize={10} tickLine={false} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#16181d",
                          borderColor: "#2a2d35",
                          color: "#e1e1e6",
                          fontSize: "11px"
                        }}
                      />
                      <Legend verticalAlign="top" height={24} iconSize={10} style={{ fontSize: "11px" }} />
                      <Line type="monotone" dataKey="Accuracy" stroke="#00ff9d" strokeWidth={2} dot={{ r: 2 }} />
                      <Line type="monotone" dataKey="Confidence" stroke="#f7b500" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="Precision" stroke="#00f2ff" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="Drift" stroke="#ff3e3e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )
              )}
            </div>
          </div>

          {/* REAL-TIME LOGS STREAM CONSOLE HEADER */}
          <div className="bg-[#16181d] border border-[#2a2d35] rounded flex-1 flex flex-col min-h-[400px]">
            <div className="border-b border-[#2a2d35] px-4 py-3 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-white">
                  <Terminal className="w-4 h-4 text-[#00f2ff]" />
                  <h3>Real-time Logs Pipeline</h3>
                </div>
                <div className="md:hidden flex items-center ml-2.5 gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#00ff9d] animate-pulse"></span>
                  <span className="text-[10px] text-[#8e9299]">Live</span>
                </div>
              </div>

              {/* LOG SEARCH FILTERS */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Level Select */}
                <div className="flex items-center gap-1 bg-[#0d0e12] px-2 py-1 rounded border border-[#2a2d35] text-xs">
                  <span className="text-[10px] text-[#8e9299] uppercase font-semibold">Lvl</span>
                  <select
                    value={filterLevel}
                    onChange={(e) => setFilterLevel(e.target.value)}
                    className="bg-transparent text-white focus:outline-none"
                    id="log-level-filter"
                  >
                    <option value="ALL">ALL LEVELS</option>
                    <option value="INFO">INFO</option>
                    <option value="WARN">WARN</option>
                    <option value="ERROR">ERROR</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

                {/* Service Select */}
                <div className="flex items-center gap-1 bg-[#0d0e12] px-2 py-1 rounded border border-[#2a2d35] text-xs">
                  <span className="text-[10px] text-[#8e9299] uppercase font-semibold">Service</span>
                  <select
                    value={filterService}
                    onChange={(e) => setFilterService(e.target.value)}
                    className="bg-transparent text-white focus:outline-none"
                    id="log-service-filter"
                  >
                    <option value="ALL">ALL SERVICES</option>
                    <option value="nginx-web">nginx-web</option>
                    <option value="auth-service">auth-service</option>
                    <option value="payment-gateway">payment-gateway</option>
                    <option value="db-cluster">db-cluster</option>
                  </select>
                </div>

                {/* Anomalies Match Toggle */}
                <button
                  onClick={() => setFilterAnomaliesOnly(!filterAnomaliesOnly)}
                  className={`px-2 py-1 rounded border text-xs transition-all flex items-center gap-1 font-semibold uppercase ${
                    filterAnomaliesOnly
                      ? "bg-[#ff3e3e]/20 text-[#ff3e3e] border-[#ff3e3e]"
                      : "bg-[#0d0e12] text-[#8e9299] border-[#2a2d35] hover:text-white"
                  }`}
                  id="only-anomalies-btn"
                >
                  <ShieldAlert className="w-3 h-3" />
                  <span>Anomalies Only</span>
                </button>

                {/* Auto Scroll toggle */}
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`px-2 py-1 rounded border text-xs transition-all flex items-center gap-1 font-semibold uppercase ${
                    autoScroll
                      ? "bg-[#00f2ff]/10 text-[#00f2ff] border-[#00f2ff]"
                      : "bg-[#0d0e12] text-[#8e9299] border-[#2a2d35] hover:text-white"
                  }`}
                >
                  <span>AutoScroll</span>
                  <span className="text-[9px]">{autoScroll ? "ON" : "OFF"}</span>
                </button>

              </div>

            </div>

            {/* LIVE STREAM WRAPPER */}
            <div
              ref={logsContainerRef}
              className="flex-1 overflow-y-auto bg-[#0d0e12] p-4 flex flex-col gap-1.5 code-font text-xs"
              style={{ maxHeight: "480px" }}
              id="live-logs-terminal-output"
            >
              {filteredLogs.length === 0 ? (
                <div className="text-center text-[#8e9299] py-16 italic">
                  No matches found. Select "ALL LEVELS" or wait for simulator background entries to arrive.
                </div>
              ) : (
                filteredLogs.map((log) => {
                  const isAnomaly = log.isAnomaly;
                  const canDeepAnalyze = log.isAnomaly;
                  
                  return (
                    <div
                      key={log.id}
                      className={`group hover:bg-[#16181d] rounded px-3 py-2 border transition-all duration-150 flex flex-col md:flex-row gap-2 md:items-center justify-between ${
                        isAnomaly
                          ? "bg-[#ff3e3e]/5 border-[#ff3e3e]/30 text-white shadow-[0_0_8px_rgba(255,62,62,0.05)]"
                          : log.level === "CRITICAL"
                          ? "bg-amber-500/5 border-amber-500/30 text-white"
                          : log.level === "ERROR"
                          ? "bg-red-500/5 border-red-500/20 text-white"
                          : "bg-transparent border-transparent text-[#a5a5a5]"
                      }`}
                    >
                      {/* Left Block - Timestamp + metadata */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[#8e9299] text-[10px]">
                          {new Date(log.timestamp).toLocaleTimeString() || "00:00:00"}
                        </span>

                        <span
                          className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded border ${
                            log.level === "CRITICAL"
                              ? "bg-[#ff3e3e] text-white border-transparent"
                              : log.level === "ERROR"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : log.level === "WARN"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : "bg-[#222530] text-[#8e9299] border-transparent"
                          }`}
                        >
                          {log.level}
                        </span>

                        {/* Service Tag */}
                        <span className="text-[#00f2ff] font-semibold text-[11px]">
                          [{log.service}]
                        </span>

                        {/* Log message */}
                        <span className="text-white break-all max-w-lg select-all">
                          {log.message}
                        </span>
                      </div>

                      {/* Right Block - stats + diagnostics / action choices */}
                      <div className="flex items-center gap-3 shrink-0 text-[10px]">
                        
                        {log.latencyMs && (
                          <span className="text-white/60">
                            lat: <strong className="text-yellow-400">{log.latencyMs}ms</strong>
                          </span>
                        )}

                        {log.statusCode && (
                          <span className={log.statusCode >= 400 ? "text-red-400 font-bold" : "text-emerald-400"}>
                            code: {log.statusCode}
                          </span>
                        )}

                        {/* Detected Anomaly Details Flag */}
                        {isAnomaly && (
                          <div className="flex items-center gap-1.5 bg-red-500/20 text-red-300 border border-red-500/40 px-1.5 py-0.5 rounded font-bold uppercase text-[9px]">
                            <Flame className="w-3 h-3 text-red-400" />
                            <span>Score: {log.anomalyScore}%</span>
                          </div>
                        )}

                        {/* Actions for anomaly */}
                        {isAnomaly && (
                          <div className="flex items-center gap-1 border-l border-zinc-700 pl-2">
                            {/* Deep AI trigger */}
                            <button
                              onClick={() => handleDeepAnalyze(log)}
                              className="px-2 py-0.5 rounded bg-[#00f2ff] text-[#0d0e12] hover:bg-white hover:text-black transition font-bold uppercase text-[9px] flex items-center gap-1"
                              title="Instruct Gemini Log Agent to parse Root Cause Analysis & Playbook"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>Analyze</span>
                            </button>

                            {/* Verification Feedback Buttons */}
                            {log.userValidated ? (
                              <span className="text-[#8e9299] text-[9.5px] italic">
                                {log.userFeedback === "accurate" ? "✅ TP" : "❌ FP"} Saved
                              </span>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleSubmitFeedback(log.id, "accurate")}
                                  className="p-1 hover:bg-[#00ff9d]/20 text-[#8e9299] hover:text-[#00ff9d] rounded"
                                  title="Mark as True Positive (Accurate detection)"
                                >
                                  <ThumbsUp className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  onClick={() => handleSubmitFeedback(log.id, "inaccurate")}
                                  className="p-1 hover:bg-red-500/20 text-[#8e9299] hover:text-red-400 rounded"
                                  title="Mark as False Positive (Inaccurate detection)"
                                >
                                  <ThumbsDown className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* FOOTER METRICS INFO ROW */}
            <div className="border-t border-[#2a2d35] p-3 text-xs flex justify-between items-center text-[#8e9299] bg-[#1a1c23]/40 rounded-b">
              <div>
                Displaying: <strong>{filteredLogs.length}</strong> logs of <strong>{logs.length}</strong> loaded.
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#ff3e3e]"></span> Anomalies: <strong>{logs.filter(l => l.isAnomaly).length}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#00f2ff]"></span> Rules Active: <strong>{alertRules.length}</strong>
                </span>
              </div>
            </div>

          </div>

        </main>

        {/* RIGHT COLUMN: AI ROOT CAUSE & MODEL QUALITY DRIFT REPORTS */}
        <aside className="w-full xl:w-[360px] bg-[#16181d] flex flex-col p-4 gap-4 overflow-y-auto shrink-0 border-t xl:border-t-0 border-[#2a2d35]">
          
          {/* DEEP AI ROOT CAUSE ANALYSIS PANEL */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs uppercase tracking-wider text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#00f2ff]" />
                SRE Root-Cause Analysis
              </h3>
              {selectedLog && (
                <button
                  onClick={() => {
                    setSelectedLog(null);
                    setDeepAnalysis("");
                  }}
                  className="p-1 text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {selectedLog ? (
              <div className="flex flex-col gap-2">
                
                {/* Meta header details */}
                <div className="bg-[#0e1014] p-2.5 rounded border border-[#2a2d35] text-[11px] code-font select-all">
                  <div className="flex justify-between font-bold text-white mb-1">
                    <span>ID: {selectedLog.id}</span>
                    <span className="text-red-400 font-bold">Severity: CRITICAL</span>
                  </div>
                  <div>Service: <span className="text-[#00f2ff]">{selectedLog.service}</span></div>
                  <div>Status Code: <span className="text-white">{selectedLog.statusCode || "N/A"}</span></div>
                  <div>Log Message: <span className="text-zinc-300">{selectedLog.message}</span></div>
                </div>

                {/* Gemini AI response wrapper */}
                <div className="border-t border-[#2a2d35] pt-2 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-[#8e9299] mb-1.5">
                    <span>Log Diagnosis Guidance:</span>
                    <span className="text-[10px] uppercase font-mono text-[#00f2ff]">Active Agent Session</span>
                  </div>

                  {deepAnalysisLoading ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2">
                      <div className="w-5 h-5 rounded-full border-2 border-t-transparent border-[#00f2ff] animate-spin"></div>
                      <span className="text-[11px] text-[#8e9299] animate-pulse">Consulting Server-Side Gemini...</span>
                    </div>
                  ) : deepAnalysis ? (
                    <div className="space-y-2 bg-[#0d0e12] p-3 rounded border border-[#2a2d35] max-h-[300px] overflow-y-auto select-all leading-relaxed whitespace-pre-wrap code-font text-[#e1e1e6]">
                      {deepAnalysis}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#8e9299] leading-relaxed italic">
                      Click the <strong className="text-[#00f2ff]">"Analyze"</strong> button beside any anomaly inside the logs pipeline to query detailed mitigation playbooks.
                    </p>
                  )}
                </div>

                {/* Default/Pre-Calculated rule parameters from anomaly */}
                {selectedLog.rootCause && !deepAnalysisLoading && !deepAnalysis && (
                  <div className="bg-red-500/5 border border-red-500/20 p-2.5 rounded text-[11px]">
                    <div className="font-bold text-red-400 mb-1">Static Diagnosis:</div>
                    <p className="text-zinc-300 mb-2 leading-relaxed">{selectedLog.rootCause}</p>
                    <div className="font-bold text-emerald-400 mb-1">Standard Remediation Playbook:</div>
                    <p className="text-zinc-300 leading-relaxed font-mono whitespace-pre-wrap">{selectedLog.remediation}</p>
                  </div>
                )}

              </div>
            ) : (
              <div className="text-center py-6 text-xs text-[#8e9299] italic">
                No log is selected for interrogation. Use the logs terminal on left to drill deep.
              </div>
            )}
          </div>

          {/* MODEL QUALITY & DRIFT MONITOR */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs uppercase tracking-wider text-white flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#00ff9d]" />
                ML Performance Agent
              </h3>
              <span className={`w-2.5 h-2.5 rounded-full ${mqStats?.degradationFlag ? "bg-red-500 shadow-[0_0_8px_#ff3e3e]" : "bg-[#00ff9d] shadow-[0_0_8px_#00ff9d]"}`}></span>
            </div>

            <p className="text-[11px] text-[#8e9299] leading-relaxed">
              Monitors and tracks drift levels. If accuracy declines below 85% relative to user feedback updates, alerts are flashed.
            </p>

            {mqStats ? (
              <div className="space-y-1.5 text-xs text-[#8e9299]">
                <div className="flex justify-between p-1 bg-[#111216] rounded px-2">
                  <span>Evaluations Pool:</span>
                  <strong className="text-white font-mono">{mqStats.totalEvaluations}</strong>
                </div>
                <div className="flex justify-between p-1 bg-[#111216] rounded px-2">
                  <span>Precision Classifier:</span>
                  <strong className="text-[#00f2ff] font-mono">{(mqStats.precision * 100).toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between p-1 bg-[#111216] rounded px-2">
                  <span>SRE Recalls:</span>
                  <strong className="text-amber-400 font-mono">{(mqStats.recall * 100).toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between p-1 bg-[#111216] rounded px-2">
                  <span>Balanced F1-Score:</span>
                  <strong className="text-[#00ff9d] font-mono">{(mqStats.f1Score * 100).toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between p-1 bg-[#111216] rounded px-2">
                  <span>Distribution Drift:</span>
                  <strong className={`font-mono font-bold ${mqStats.dataDriftLevel === "HIGH" ? "text-purple-400 animate-pulse" : "text-[#8e9299]"}`}>
                    {mqStats.dataDriftLevel} LEVEL
                  </strong>
                </div>

                {mqStats.degradationFlag && (
                  <div className="bg-red-500/10 border border-red-500/30 p-2 rounded text-[11px] text-red-300 mt-2">
                    <strong className="font-bold flex items-center gap-1 mb-1">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" /> Model Degradation Active!
                    </strong>
                    <p className="leading-tight text-[10px]">{mqStats.degradationReason}</p>
                  </div>
                )}
                
                {/* PDF SRE Report Trigger */}
                <div className="pt-2 border-t border-[#2a2d35]">
                  <button
                    onClick={handleGenerateMqReport}
                    className="w-full py-1.5 text-xs bg-transparent border border-[#00f2ff]/40 hover:border-[#00f2ff] hover:text-[#00f2ff] hover:bg-[#00f2ff]/5 rounded text-[#e1e1e6] flex items-center justify-center gap-1.5 transition font-semibold"
                    id="generate-mq-report-btn"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Run ML Drift Audit Report</span>
                  </button>

                  {mqReportLoading ? (
                    <div className="py-4 text-center text-[11px]">
                      <span className="animate-pulse text-[#8e9299]">Synthesizing report metadata...</span>
                    </div>
                  ) : mqReport ? (
                    <div className="mt-2 bg-[#0e1014] text-white p-2.5 rounded border border-[#2a2d35] max-h-[140px] overflow-y-auto text-[11px] whitespace-pre-wrap code-font leading-relaxed">
                      {mqReport}
                    </div>
                  ) : null}
                </div>

              </div>
            ) : (
              <div className="text-center py-4 text-[#8e9299] text-xs">
                No quality stats parsed yet.
              </div>
            )}
          </div>

          {/* CUSTOM LOG ANALYZER PLAYGROUND */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-3.5 flex flex-col gap-2">
            <h3 className="font-bold text-xs uppercase tracking-wider text-white flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-purple-400" />
              Log Parser Playground
            </h3>
            
            <p className="text-[11px] text-[#8e9299] mb-1">
              Test on demand: paste custom logs payload to test classification engine.
            </p>

            <textarea
              value={customLog}
              onChange={(e) => setCustomLog(e.target.value)}
              placeholder="Paste log entries here..."
              rows={3}
              className="w-full bg-[#0d0e12] border border-[#2a2d35] rounded p-2 text-[11.5px] code-font text-[#e1e1e6] focus:outline-none focus:border-[#00f2ff] transition resize-none"
              id="raw-log-input-area"
            />

            <button
              onClick={handleAnalyzeCustom}
              disabled={customAnalyzing || !customLog.trim()}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded text-xs flex items-center justify-center gap-1.5 transition uppercase"
              id="custom-log-submit-btn"
            >
              {customAnalyzing ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border border-t-transparent border-white animate-spin"></div>
                  <span>Evaluating Stream...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Parse with Sentinel AI</span>
                </>
              )}
            </button>

            {customAnalysis && !customAnalyzing && (
              <div className="mt-2 text-[11px] bg-[#0d0e12] border border-[#2a2d35] p-2.5 rounded code-font text-white max-h-[220px] overflow-y-auto">
                {customAnalysis.error ? (
                  <div className="text-red-400 font-bold">Error: {customAnalysis.error}</div>
                ) : (
                  <div className="space-y-1.5 select-all">
                    <div className="flex justify-between items-center text-xs border-b border-[#2a2d35] pb-1 font-bold">
                      <span className="text-purple-400 uppercase">Analysis Outcome</span>
                      <span className={customAnalysis.isAnomaly ? "text-red-400" : "text-emerald-400"}>
                        {customAnalysis.isAnomaly ? "🔴 ANOMALOUS" : "🟢 OK"}
                      </span>
                    </div>
                    {customAnalysis.isAnomaly && (
                      <div className="flex justify-between">
                        <span className="text-[#8e9299]">Threat Weight:</span>
                        <strong className="text-red-400">{customAnalysis.anomalyScore}%</strong>
                      </div>
                    )}
                    {customAnalysis.confidence && (
                      <div className="flex justify-between">
                        <span className="text-[#8e9299]">AI Confidence:</span>
                        <strong className="text-amber-400">{customAnalysis.confidence}%</strong>
                      </div>
                    )}
                    {customAnalysis.service && (
                      <div className="flex justify-between">
                        <span className="text-[#8e9299]">Service Target:</span>
                        <strong className="text-[#00f2ff]">{customAnalysis.service}</strong>
                      </div>
                    )}
                    {customAnalysis.rootCause && (
                      <div className="text-[#8e9299] pt-1">
                        <strong className="text-white block font-semibold">Diagnosis:</strong>
                        <p className="text-zinc-300 leading-normal">{customAnalysis.rootCause}</p>
                      </div>
                    )}
                    {customAnalysis.remediation && (
                      <div className="text-[#8e9299] pt-1">
                        <strong className="text-emerald-400 block font-semibold">Recommended Remediation:</strong>
                        <p className="text-zinc-300 leading-normal whitespace-pre-wrap">{customAnalysis.remediation}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SYSTEM PERFORMANCE INDICATORS (DOCKER / CPU SIMULATOR STATS) */}
          <div className="border border-[#2a2d35] bg-[#1a1c23] rounded p-2 px-3 text-[11px] text-[#8e9299]">
            <div className="flex justify-between mb-1.5">
              <span>Agent CPU Load</span>
              <span className="text-white code-font">{stats.activeScenario !== "NONE" ? "38%" : "12%"}</span>
            </div>
            <div className="h-1 bg-[#111216] rounded-full overflow-hidden mb-2">
              <div
                className={`h-full transition-all duration-500 rounded-full ${stats.activeScenario !== "NONE" ? "bg-[#ff3e3e]" : "bg-[#00f2ff]"}`}
                style={{ width: stats.activeScenario !== "NONE" ? "38%" : "12%" }}
              ></div>
            </div>

            <div className="flex justify-between mb-1.5">
              <span>Docker Memory Stack</span>
              <span className="text-white code-font">3.4 GB / 8 GB</span>
            </div>
            <div className="h-1 bg-[#111216] rounded-full overflow-hidden mb-2">
              <div className="h-full bg-orange-400 rounded-full" style={{ width: "42.5%" }}></div>
            </div>

            <div className="flex justify-between mb-1">
              <span>Nginx Pipe Rate</span>
              <span className="text-white code-font">{stats.activeScenario === "DDOS" ? "124.5 MB/s" : "3.1 MB/s"}</span>
            </div>
          </div>

        </aside>

      </div>
    </div>
  );
}

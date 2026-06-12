/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Standard ESM dir resolution since "type": "module" is configured
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Gemini SDK with User-Agent set per skill instructions
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
} else {
  console.warn("WARNING: GEMINI_API_KEY is not configured or uses default template string. AI-based features will run in mock mode.");
}

const app = express();
app.use(express.json());

const PORT = 3000;

// Import types inline or define matching types
import { LogEntry, LogLevel, AnomalyType, AlertRule, ActiveAlert, ModelQualityStats, PredictionPoint, DetectorType } from "./src/types.js";

// --- STATE MANAGEMENT ---
let logs: LogEntry[] = [];
let activeScenario: AnomalyType = "NONE";
let simSpeedMs = 1500; // time between logs in dev
let logsLimit = 400; // slide window limit and history constraint

// Pre-configured Alert Rules (Grafana-style)
let alertRules: AlertRule[] = [
  {
    id: "rule-1",
    name: "Web Ingress Error Rate",
    metric: "error_rate",
    condition: "gt",
    threshold: 15, // > 15% errors in sliding window
    windowSeconds: 30,
    status: "OK"
  },
  {
    id: "rule-2",
    name: "SQL Injection Suspected",
    metric: "critical_errors",
    condition: "gt",
    threshold: 0, // alert immediately on any sql critical anomaly
    windowSeconds: 15,
    status: "OK"
  },
  {
    id: "rule-3",
    name: "DB Pool Starvation",
    metric: "latency",
    condition: "gt",
    threshold: 3000, // Mean latency > 3000ms
    windowSeconds: 20,
    status: "OK"
  },
  {
    id: "rule-4",
    name: "JWT Signature Drastic Failures",
    metric: "critical_errors",
    condition: "gt",
    threshold: 3, // > 3 expired or failed tokens
    windowSeconds: 15,
    status: "OK"
  }
];

let activeAlerts: ActiveAlert[] = [];

// Model Quality Tracking State
let mqStats: ModelQualityStats = {
  totalEvaluations: 120,
  truePositives: 45,
  trueNegatives: 68,
  falsePositives: 4,
  falseNegatives: 3,
  accuracy: 0.941,
  precision: 0.918,
  recall: 0.937,
  f1Score: 0.927,
  averageConfidence: 89.2,
  dataDriftLevel: "LOW",
  degradationFlag: false,
  predictionsHistory: []
};

// Generate prediction points over past 10 minutes for chart visualization
const populateMQHistory = () => {
  const points: PredictionPoint[] = [];
  const baseTime = Date.now() - 10 * 60 * 1000;
  for (let i = 0; i < 10; i++) {
    const timeOffset = i * 60 * 1000;
    const isDrifting = i > 7 && activeScenario !== "NONE";
    const driftVal = isDrifting ? 15 + Math.random() * 20 : 2 + Math.random() * 5;
    const acc = isDrifting ? 0.82 + Math.random() * 0.05 : 0.93 + Math.random() * 0.04;
    const conf = isDrifting ? 75 + Math.random() * 8 : 88 + Math.random() * 5;

    points.push({
      timestamp: new Date(baseTime + timeOffset).toISOString(),
      accuracy: parseFloat(acc.toFixed(3)),
      precision: parseFloat((acc - 0.02).toFixed(3)),
      recall: parseFloat((acc - 0.01).toFixed(3)),
      confidence: parseFloat(conf.toFixed(1)),
      drift: parseFloat(driftVal.toFixed(1))
    });
  }
  mqStats.predictionsHistory = points;
};

// Populate background/historical logs for visual immediate richness
const populateHistoricalLogs = () => {
  const services = ["nginx-web", "auth-service", "payment-gateway", "db-cluster"];
  const ips = ["192.168.1.45", "10.0.4.12", "172.16.50.91", "203.0.113.195", "198.51.100.22", "8.8.8.8"];
  const messages = {
    "nginx-web": [
      { msg: "GET /api/v1/health HTTP/1.1", code: 200, latency: 15 },
      { msg: "GET /index.html HTTP/1.1", code: 200, latency: 25 },
      { msg: "POST /api/v1/analytics HTTP/1.1", code: 204, latency: 45 },
      { msg: "GET /assets/main.js HTTP/1.1", code: 200, latency: 35 }
    ],
    "auth-service": [
      { msg: "User log-in attempt completed for user 'm_weaver'", code: 200, latency: 110 },
      { msg: "Session token prolonged for tenant 'company_a'", code: 200, latency: 50 },
      { msg: "Admin credentials evaluated for user 'system_root'", code: 200, latency: 150 },
      { msg: "JWT token parsed successfully", code: 200, latency: 10 }
    ],
    "payment-gateway": [
      { msg: "Charge request forwarded to Stripe processing network", code: 200, latency: 450 },
      { msg: "Stripe webhook notification processed: charge.succeeded", code: 200, latency: 120 },
      { msg: "Refund receipt logged for charge ch_3M9281", code: 200, latency: 280 }
    ],
    "db-cluster": [
      { msg: "SELECT * FROM public.users WHERE email = $1 LIMIT 1", code: 200, latency: 3 },
      { msg: "UPDATE public.tenants SET last_active = NOW() WHERE id = $1", code: 200, latency: 5 },
      { msg: "INSERT INTO public.audit_logs (user_id, action) VALUES ($1, $2)", code: 201, latency: 8 }
    ]
  };

  const startTimestamp = Date.now() - 120 * 1000; // 2 minutes ago
  for (let i = 0; i < 75; i++) {
    const elapsed = i * 1500;
    const timestampStr = new Date(startTimestamp + elapsed).toISOString();
    const service = services[Math.floor(Math.random() * services.length)];
    const items = messages[service as keyof typeof messages];
    const picked = items[Math.floor(Math.random() * items.length)];

    logs.push({
      id: `history-log-${i}`,
      timestamp: timestampStr,
      service,
      level: "INFO",
      message: picked.msg,
      ip: ips[Math.floor(Math.random() * ips.length)],
      statusCode: picked.code,
      latencyMs: picked.latency,
      isAnomaly: false,
      detectedBy: "none"
    });
  }
};

populateHistoricalLogs();
populateMQHistory();


// --- LOG SIMULATION ENGINE ---
const generateLogSingle = (): LogEntry => {
  const tStr = new Date().toISOString();
  const idStr = `log-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ips = ["192.168.1.18", "10.0.2.5", "172.16.2.22", "82.165.91.44", "45.33.21.90", "103.21.244.2"];
  const maliciousIps = ["185.220.101.5", "190.115.18.21", "80.92.112.50"];

  let service = "nginx-web";
  let level: LogLevel = "INFO";
  let message = "Log event standard";
  let ip = ips[Math.floor(Math.random() * ips.length)];
  let statusCode = 200;
  let latencyMs = 20 + Math.floor(Math.random() * 150);
  
  // Detection variables
  let isAnomaly = false;
  let anomalyScore = 0;
  let detectedBy: DetectorType = "none";
  let rootCause = "";
  let remediation = "";

  // Helper selectors
  const roll = Math.random();

  switch (activeScenario) {
    case "NONE":
      // Standard logging across services
      const sPick = roll < 0.4 ? "nginx-web" : roll < 0.65 ? "auth-service" : roll < 0.85 ? "db-cluster" : "payment-gateway";
      service = sPick;
      if (service === "nginx-web") {
        if (Math.random() < 0.04) {
          level = "WARN";
          statusCode = 404;
          message = "GET /favicon.ico HTTP/1.1 - resource not found";
        } else {
          message = `GET /api/v1/inventory HTTP/1.1 - host response ok`;
        }
      } else if (service === "auth-service") {
        if (Math.random() < 0.05) {
          level = "WARN";
          statusCode = 401;
          message = "Failed credentials authentication for user 'guest_account'";
        } else {
          message = "JWT Token validated successfully for payload uid:8192";
        }
      } else if (service === "db-cluster") {
        latencyMs = 2 + Math.floor(Math.random() * 12);
        message = "SELECT count(*) FROM postgres.public.products WHERE category = $1";
      } else {
        message = "POST /api/v1/charge - stripe call completed in 312ms";
      }
      break;

    case "DDOS":
      // Rapid flood on Nginx with 429 & 503
      service = "nginx-web";
      ip = maliciousIps[Math.floor(Math.random() * maliciousIps.length)];
      latencyMs = 2000 + Math.floor(Math.random() * 1800);
      
      if (Math.random() < 0.8) {
        level = "ERROR";
        statusCode = 429;
        message = "Rate limit exceeded: 429 POST /api/v1/checkout - concurrent count high";
        isAnomaly = true;
        anomalyScore = 85 + Math.floor(Math.random() * 15);
        detectedBy = "rule-engine";
        rootCause = "DDoS attack matching concurrent client request flood on billing endpoints. Saturated ingress capacity.";
        remediation = "Apply Cloudflare Rate Limiting rules. Block traffic from IP region or enforce mandatory CAPTCHA on checkout.";
      } else {
        level = "CRITICAL";
        statusCode = 503;
        message = "Service Unavailable: Nginx Gateway failed backend handshake for client worker thread pool";
        isAnomaly = true;
        anomalyScore = 95 + Math.floor(Math.random() * 5);
        detectedBy = "rule-engine";
        rootCause = "Nginx backend socket pool exhaustion triggered by upstream load spike.";
        remediation = "Scale active application replicas in Kubernetes. Increase proxy_connect_timeout values in nginx.conf.";
      }
      break;

    case "SQL_INJECTION":
      // Injection strings in DB cluster and Auth service
      service = Math.random() < 0.6 ? "db-cluster" : "auth-service";
      ip = maliciousIps[Math.floor(Math.random() * maliciousIps.length)];
      
      if (service === "db-cluster") {
        level = "CRITICAL";
        statusCode = 500;
        message = "PostgreSQL error: syntax error at or near \"UNION\" (SELECT * FROM billing WHERE user_id = '' OR 1=1 --)";
        isAnomaly = true;
        anomalyScore = 98;
        detectedBy = "rule-engine"; // Immediately flag via rule engine
        rootCause = "Highly suspicious SQL statement attempting unauthorized table union and logic bypass.";
        remediation = "Rewrite SQL calls using parameterized query parameters (Drizzle ORM, Prisma, or bound pg statement prep tags). Sanitise parameter bounds.";
      } else {
        level = "CRITICAL";
        statusCode = 403;
        message = "Authentication vulnerability block: Request query contained illegal quote character sequencing sequence";
        isAnomaly = true;
        anomalyScore = 90;
        detectedBy = "gemini-agent"; // Simulated model agent detection
        rootCause = "Pre-auth injection attempt targeting standard web form parser.";
        remediation = "Register Web Application Firewall rules to drop query payloads with '--', 'UNION', or boolean toggles.";
      }
      break;

    case "DB_STARVATION":
      // Connection starved error, slow DB queries
      service = "db-cluster";
      latencyMs = 4500 + Math.floor(Math.random() * 2000);
      level = "CRITICAL";
      statusCode = 504;
      message = "FATAL: remaining connection slots are reserved for non-replication superuser connections (active pool count: 150/150)";
      isAnomaly = true;
      anomalyScore = 92;
      detectedBy = "rule-engine";
      rootCause = "Database Connection Pool Starvation. Connection leaks inside server-side transaction blocks or slow query blockages.";
      remediation = "Add pooling layers like PgBouncer. Monitor client connection closures and audit unclosed cursor arrays.";
      break;

    case "JWT_FLOOD":
      service = "auth-service";
      level = "ERROR";
      statusCode = 401;
      
      if (Math.random() < 0.7) {
        message = "JWT SignatureVerificationException: Signature key does not match local RSA keys context verification ID:9a12";
        isAnomaly = true;
        anomalyScore = 88;
        detectedBy = "gemini-agent";
        rootCause = "Auth token replay with mismatched keys. Potential clock drift across auth nodes or cryptographic exploit attempt.";
        remediation = "Rotate public key certificates on OAuth validation targets. Check time synchronization (NTP) on validation nodes.";
      } else {
        message = "ExpiredTokenError: Rejected token issued 864000s in the past";
        isAnomaly = false; // Just expired logs, normally ignored but higher vol
      }
      break;

    case "DISK_FULL":
      service = "db-cluster";
      level = "CRITICAL";
      statusCode = 507;
      message = "IOException: Cannot write partition logs block. Status: No space left on device. Disk storage capacity: 100.0% saturated.";
      isAnomaly = true;
      anomalyScore = 99;
      detectedBy = "rule-engine";
      rootCause = "Local disk volume exhaustion preventing write operation logs and WAL entries.";
      remediation = "Provision automatic disk resizing policies on Cloud SQL or local SSD. Purge obsolete debug dumps and clean up temporary zip archives.";
      break;
  }

  const freshLog: LogEntry = {
    id: idStr,
    timestamp: tStr,
    service,
    level,
    message,
    ip,
    statusCode,
    latencyMs,
    isAnomaly,
    anomalyScore: isAnomaly ? anomalyScore : undefined,
    detectedBy: isAnomaly ? detectedBy : "none",
    rootCause: isAnomaly ? rootCause : undefined,
    remediation: isAnomaly ? remediation : undefined
  };

  return freshLog;
};

// Continuous generator loop
setInterval(() => {
  const log = generateLogSingle();
  logs.push(log);
  
  if (logs.length > logsLimit) {
    logs.shift(); // sliding window limit
  }

  // Update Model Quality Agent on incoming logs
  updateModelQualityAgent(log);
  
  // Real-time alerting verification
  evaluateAlertRules();
}, simSpeedMs);

// Track continuous stats update for Model Quality agent evaluation
const updateModelQualityAgent = (log: LogEntry) => {
  if (log.isAnomaly) {
    mqStats.totalEvaluations++;
    // Let's count predictions: If rule-engine / gemini caught it, it represents a TP.
    if (log.detectedBy && log.detectedBy !== "none") {
      mqStats.truePositives++;
    } else {
      mqStats.falseNegatives++; // missed anomaly
    }
  } else {
    // Normal logs (90% of logs)
    // Sometimes the rule-engine or AI has false positive alerts (e.g. rate limit error of user that isn't DDoS)
    if (log.level === "ERROR" && Math.random() < 0.05 && activeScenario === "NONE") {
      mqStats.totalEvaluations++;
      mqStats.falsePositives++;
    } else {
      // Correct negative classification
      if (Math.random() < 0.1) {
        mqStats.totalEvaluations++;
        mqStats.trueNegatives++;
      }
    }
  }

  // Calculate Precision, Recall, Accuracy, F1 Score
  const tp = mqStats.truePositives;
  const fp = mqStats.falsePositives;
  const tn = mqStats.trueNegatives;
  const fn = mqStats.falseNegatives;

  mqStats.accuracy = parseFloat(((tp + tn) / (tp + tn + fp + fn || 1)).toFixed(3));
  mqStats.precision = parseFloat((tp / (tp + fp || 1)).toFixed(3));
  mqStats.recall = parseFloat((tp / (tp + fn || 1)).toFixed(3));
  mqStats.f1Score = parseFloat(((2 * mqStats.precision * mqStats.recall) / (mqStats.precision + mqStats.recall || 1)).toFixed(3));

  // Handle slide drift metrics
  const activeDriftVal = activeScenario !== "NONE" ? 18.5 + (Math.random() * 8) : 2.1 + (Math.random() * 2);
  mqStats.dataDriftLevel = activeDriftVal > 15 ? "HIGH" : activeDriftVal > 8 ? "MEDIUM" : "LOW";
  
  // Model performance degradation trigger flag
  if (mqStats.accuracy < 0.85 || mqStats.f1Score < 0.80) {
    mqStats.degradationFlag = true;
    mqStats.degradationReason = `Precision and recall accuracy degradation under anomaly scenario: '${activeScenario}'. Data distribution drift level is ${mqStats.dataDriftLevel}.`;
  } else {
    mqStats.degradationFlag = false;
    mqStats.degradationReason = undefined;
  }

  // Periodically add or shift timeline prediction data
  if (Math.random() < 0.05) {
    mqStats.predictionsHistory.push({
      timestamp: new Date().toISOString(),
      accuracy: mqStats.accuracy,
      precision: mqStats.precision,
      recall: mqStats.recall,
      confidence: parseFloat((85 + Math.random() * 10).toFixed(1)),
      drift: parseFloat(activeDriftVal.toFixed(1))
    });
    if (mqStats.predictionsHistory.length > 20) {
      mqStats.predictionsHistory.shift();
    }
  }
};

// Evaluate Grafana-inspired live metrics window and update status
const evaluateAlertRules = () => {
  const windowMillis = 30 * 1000; // evaluate over last 30s
  const now = Date.now();
  const evaluationLogs = logs.filter(l => now - new Date(l.timestamp).getTime() < windowMillis);

  alertRules.forEach(rule => {
    let matchesValue = 0;
    
    if (rule.metric === "error_rate") {
      const totalInWindow = evaluationLogs.length || 1;
      const errorCount = evaluationLogs.filter(l => ["WARN", "ERROR", "CRITICAL"].includes(l.level)).length;
      matchesValue = (errorCount / totalInWindow) * 100;
    } else if (rule.metric === "latency") {
      const avgLatency = evaluationLogs.reduce((sum, l) => sum + (l.latencyMs || 0), 0) / (evaluationLogs.length || 1);
      matchesValue = avgLatency;
    } else if (rule.metric === "critical_errors") {
      matchesValue = evaluationLogs.filter(l => l.level === "CRITICAL" && l.isAnomaly).length;
    }

    if (matchesValue > rule.threshold) {
      if (rule.status === "OK") {
        rule.status = "PENDING";
      } else if (rule.status === "PENDING") {
        rule.status = "FIRING";
        rule.lastTriggered = new Date().toISOString();

        // Dispatch a real-time active alert
        const alertId = `alert-${rule.id}-${Date.now()}`;
        const alreadyFired = activeAlerts.find(a => a.ruleId === rule.id && a.status === "ACTIVE");
        if (!alreadyFired) {
          activeAlerts.unshift({
            id: alertId,
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.metric === "critical_errors" ? "CRITICAL" : "WARNING",
            message: `Metric standard exceeded threshold for rule: ${rule.name} (Value: ${matchesValue.toFixed(1)})`,
            timestamp: new Date().toISOString(),
            status: "ACTIVE"
          });
        }
      }
    } else {
      if (rule.status === "FIRING" || rule.status === "PENDING") {
        rule.status = "OK";
        // Resolve active alerts
        activeAlerts = activeAlerts.map(alert => {
          if (alert.ruleId === rule.id && alert.status === "ACTIVE") {
            return {
              ...alert,
              status: "RESOLVED",
              resolvedAt: new Date().toISOString()
            };
          }
          return alert;
        });
      }
    }
  });
};


// --- REST API ENDPOINTS ---

// GET: All current logs
app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const filteredLevel = req.query.level as string;
  const filteredService = req.query.service as string;
  const onlyAnomalies = req.query.anomalies === "true";

  let result = [...logs];

  if (filteredLevel) {
    result = result.filter(l => l.level === filteredLevel);
  }
  if (filteredService) {
    result = result.filter(l => l.service === filteredService);
  }
  if (onlyAnomalies) {
    result = result.filter(l => l.isAnomaly);
  }

  // Return limited sorted list (latest first)
  res.json(result.slice(-limit).reverse());
});

// GET: Detailed stats metrics
app.get("/api/stats", (req, res) => {
  const total = logs.length || 1;
  const errors = logs.filter(l => ["WARN", "ERROR", "CRITICAL"].includes(l.level)).length;
  const anomalies = logs.filter(l => l.isAnomaly).length;
  const avgLat = logs.reduce((sum, l) => sum + (l.latencyMs || 0), 0) / total;

  res.json({
    throughput: logs.length * 2, // logs per minute approximation
    errorRate: parseFloat(((errors / total) * 100).toFixed(1)),
    anomalyRate: parseFloat(((anomalies / total) * 100).toFixed(1)),
    averageLatency: parseFloat(avgLat.toFixed(1)),
    activeScenario,
    activeAlerts: activeAlerts.filter(a => a.status === "ACTIVE").length
  });
});

// GET: Alert rules and current firing list
app.get("/api/alerts", (req, res) => {
  res.json({
    rules: alertRules,
    alerts: activeAlerts
  });
});

// POST: Trigger custom anomaly injection in the simulator
app.post("/api/logs/simulate", (req, res) => {
  const { scenario } = req.body;
  
  if (!scenario || !["NONE", "DDOS", "SQL_INJECTION", "DB_STARVATION", "JWT_FLOOD", "DISK_FULL"].includes(scenario)) {
    return res.status(400).json({ error: "Invalid anomaly scenario identity provided." });
  }

  activeScenario = scenario as AnomalyType;
  
  // Inject instant alert logs to reflect state immediately
  for(let i = 0; i < 5; i++) {
    const suddenLog = generateLogSingle();
    logs.push(suddenLog);
  }
  evaluateAlertRules();

  res.json({
    status: "ok",
    message: `Simulator anomaly pattern switched to: ${scenario}`,
    activeScenario
  });
});

// POST: Submit accuracy classification feedback to retrain model quality statistics
app.post("/api/logs/feedback", (req, res) => {
  const { logId, feedback } = req.body; // 'accurate' | 'inaccurate'
  
  if (!logId || !feedback) {
    return res.status(400).json({ error: "Log ID and validation feedback parameter are required." });
  }

  const logIdx = logs.findIndex(l => l.id === logId);
  if (logIdx === -1) {
    return res.status(404).json({ error: "Log entry not found in memory stack." });
  }

  logs[logIdx].userValidated = true;
  logs[logIdx].userFeedback = feedback;

  // Let's dynamic adjust model metric points based on user's corrections
  if (feedback === "accurate") {
    // True detection confirmed
    mqStats.truePositives++;
  } else {
    // Incorrect anomaly label by AI (False Positive)
    mqStats.falsePositives++;
    mqStats.truePositives = Math.max(0, mqStats.truePositives - 1);
  }

  res.json({ status: "ok", message: "Validation saved.", stats: mqStats });
});

// GET: Model Quality monitor stats
app.get("/api/mq-agent", (req, res) => {
  res.json(mqStats);
});

// POST: Run a rich server-side Gemini AI analysis on a custom copy-pasted log block
app.post("/api/logs/analyze-custom", async (req, res) => {
  const { logContent } = req.body;
  if (!logContent) {
    return res.status(400).json({ error: "No log content specified for AI analysis." });
  }

  if (!ai) {
    // Mock Agent Analysis when GEMINI_API_KEY is not configured or in sandbox
    return res.json({
      isAnomaly: logContent.toLowerCase().includes("error") || logContent.toLowerCase().includes("fail") || logContent.toLowerCase().includes("exception"),
      anomalyScore: logContent.toLowerCase().includes("critical") ? 92 : 65,
      detectedBy: "gemini-agent",
      rootCause: "Suspicious pattern detected. (Mock mode running, configure your GEMINI_API_KEY to activate actual production model).",
      remediation: "1. Audit dependencies & code parameters.\n2. Ensure configurations match production ports.",
    });
  }

  try {
    const prompt = `You are a Log-Based Anomaly Detection AI Agent. Analyze the following logs block and evaluate if an anomaly is occurring. Specify the threat confidence, root cause, and standard visual remediation steps.
    
    Log payload:
    """
    ${logContent}
    """
    
    Provide your response as a strict, valid JSON object with the following properties:
    {
      "isAnomaly": boolean,
      "anomalyScore": number (0 to 100),
      "confidence": number (0 to 100),
      "service": string (likely service source),
      "rootCause": "Thorough root cause analysis string",
      "remediation": "Numbered step-by-step markdown code block representing corrective actions"
    }
    
    Return ONLY standard JSON. No surrounding markdown backticks.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsedData = JSON.parse(response.text.trim());
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Analyze error:", error);
    res.status(500).json({ error: "Failed to query Gemini model analysis engine.", rawError: error?.message });
  }
});

// POST: In-situ Deep AI Root Cause analysis for specific memory-stored anomalous logs
app.get("/api/logs/deep-analyze/:id", async (req, res) => {
  const { id } = req.params;
  const logCandidate = logs.find(l => l.id === id);

  if (!logCandidate) {
    return res.status(404).json({ error: "Log candidate for analysis could not be found." });
  }

  if (!ai) {
    return res.json({
      id,
      aiAnalysis: `### 🔍 Simulated Anomaly Diagnosis (Offline Mock Mode)
      
Your simulated log entry indicates an active threat level.
- **Service Affected**: \`${logCandidate.service}\`
- **Error Code**: \`${logCandidate.statusCode || "N/A"}\`
- **Suspected trigger**: \`${logCandidate.message}\`

#### 🛠️ Direct Remediation Guide:
1. Audit connection pooling configs and inspect open socket pools.
2. Setup alert rule integrations on Cloud Run for rapid resource autoscaling flags.`
    });
  }

  try {
    const prompt = `You are a DevOps and site reliability intelligence engine. Build a comprehensive root cause analysis markdown report for this anomalous log event:
    
    Timestamp: ${logCandidate.timestamp}
    Service: ${logCandidate.service}
    Log Level: ${logCandidate.level}
    Message: "${logCandidate.message}"
    IP: ${logCandidate.ip || "unknown"}
    Status Code: ${logCandidate.statusCode || "N/A"}
    Latency: ${logCandidate.latencyMs || "N/A"} ms
    
    Write an interactive summary formatted in pristine GitHub Markdown. Outline:
    1. **Detailed Anomaly Diagnosis** (What exactly is going wrong based on details like host, latency, and system message)
    2. **Root Cause Identification** (The fundamental system/hardware/architectural trigger of this bug)
    3. **Remediation Guide** (Actionable steps with concrete mock configuration or code snippets to fix it).`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({
      id,
      aiAnalysis: response.text
    });
  } catch (err: any) {
    console.error("Deep log analysis error:", err);
    res.status(500).json({ error: "Server failed to invoke Gemini model guidance.", details: err?.message });
  }
});

// GET: Request model quality report analysis from Model Quality Agent
app.get("/api/mq-agent/report", async (req, res) => {
  if (!ai) {
    return res.json({
      report: `### 🛡️ AI Model Quality Status Report (offline mode)
- **Primary Accuracy**: ${(mqStats.accuracy * 100).toFixed(1)}%
- **F1-Score**: ${(mqStats.f1Score * 100).toFixed(1)}%
- **Class drift state**: Low

No degradation triggers active. Setup active API keys in Settings > Secrets to enable continuous report streaming.`
    });
  }

  try {
    const prompt = `As a Machine Learning Model-Quality Agent, analyze this classifier's precision/recall dataset and write an SRE-grade PDF report regarding anomaly detection confidence:
    
    Total Evaluations: ${mqStats.totalEvaluations}
    True Positives: ${mqStats.truePositives}
    True Negatives: ${mqStats.trueNegatives}
    False Positives: ${mqStats.falsePositives}
    False Negatives: ${mqStats.falseNegatives}
    Current Accuracy: ${mqStats.accuracy}
    Precision: ${mqStats.precision}
    Recall: ${mqStats.recall}
    F1 Score: ${mqStats.f1Score}
    Data Drift Rate: ${mqStats.dataDriftLevel}
    Active Simulator Anomaly scenario: "${activeScenario}"
    
    Synthesize a 3-paragraph summary covering accuracy trends, potential false alarms, and advice regarding model drift or degradation rules.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({
      report: response.text
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to generate report from model agent", details: error?.message });
  }
});


// --- VITE DEV WORKSPACE OR STATIC SERVING RUNTIME ASSEMBLY ---
async function startServer() {
  // Vite integration middleware setup
  if (process.env.NODE_ENV !== "production") {
    console.log("Configuring server in DEVELOPMENT mode with Vite integration...");
    
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    
    app.use(vite.middlewares);
  } else {
    console.log("Configuring server in PRODUCTION mode with static build assets serving...");
    
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Log Sentinel server booted successfully! Listening upstream at http://localhost:${PORT}`);
  });
}

startServer();

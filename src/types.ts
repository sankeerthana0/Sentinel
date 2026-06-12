/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export type DetectorType = 'rule-engine' | 'gemini-agent' | 'none';

export interface LogEntry {
  id: string;
  timestamp: string; // ISO 8601 string
  service: string;   // 'nginx-web', 'auth-service', 'payment-gateway', 'db-cluster'
  level: LogLevel;
  message: string;
  ip?: string;
  statusCode?: number;
  latencyMs?: number;
  
  // Anomaly specifics
  isAnomaly: boolean;
  anomalyScore?: number; // 0 to 100
  detectedBy?: DetectorType;
  rootCause?: string;
  remediation?: string;
  
  // Feedback/Validation
  userValidated?: boolean;
  userFeedback?: 'accurate' | 'inaccurate';
}

export type AnomalyType = 'NONE' | 'DDOS' | 'SQL_INJECTION' | 'DB_STARVATION' | 'JWT_FLOOD' | 'DISK_FULL';

export interface AlertRule {
  id: string;
  name: string;
  metric: 'error_rate' | 'latency' | 'anomaly_score' | 'critical_errors';
  condition: 'gt';
  threshold: number; // percentage or millisecond or confidence
  windowSeconds: number;
  status: 'OK' | 'PENDING' | 'FIRING';
  lastTriggered?: string;
}

export interface ActiveAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  timestamp: string;
  status: 'ACTIVE' | 'RESOLVED';
  resolvedAt?: string;
}

export interface PredictionPoint {
  timestamp: string;
  accuracy: number;
  precision: number;
  recall: number;
  confidence: number;
  drift: number;
}

export interface ModelQualityStats {
  totalEvaluations: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  averageConfidence: number;
  dataDriftLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  degradationFlag: boolean;
  degradationReason?: string;
  predictionsHistory: PredictionPoint[];
}

export interface DashboardMetrics {
  throughput: number; // logs per minute
  errorRate: number;  // % of logs that are WARN/ERROR/CRITICAL
  activeAlerts: number;
  anomalyRate: number; // % of anomalous logs
}

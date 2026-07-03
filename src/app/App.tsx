import { useState, useRef, useEffect } from "react";
import {
  getAll, insertRecord, updateRecord, TABLES, uploadImageToStorage, subscribeToTable,
} from "@/lib/supabase";
import {
  generateAccomplishmentReport, generateAccomplishmentHistory, formatDateRange,
  type AccomplishmentReportRow, type HistoryRow,
} from "@/lib/docGenerator";
import {
  Home, User, CheckSquare, Award, LogOut, ChevronLeft, ChevronRight,
  Plus, Edit2, Check, Eye, Camera, Upload, FileText, ChevronDown, ChevronUp,
  X, Users, Trash2, Clock, CheckCircle2, Circle, AlertCircle,
  Printer, Calendar as CalendarIcon, Sparkles, Bell, RotateCcw,
  ClipboardCheck, Plane,
} from "lucide-react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import LITMLogo from "@/imports/LITM_Logo.png";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

type Page = "home" | "profile" | "tasks" | "accomplishments" | "monitoring" | "notifications" | "history";
type DailyStatus = "pending" | "submitted" | "approved" | "returned" | "finished";

interface UserProfile {
  id: string; username: string; lastName: string; firstName: string;
  middleName: string; suffix: string; nickname: string; designation: string;
  position: string; mobilePhone: string; email: string; password: string;
  isAdmin: boolean; profilePicture: string;
}
interface Deliverable { id: string; title: string; status: "pending" | "done"; }
interface DailyTask {
  id: string; title: string; deliverable: string; date: string;
  status: DailyStatus; images: string[];
  submittedAt?: string; adminNote?: string;
}
interface WeeklyTask {
  id: string; title: string; deliverables: Deliverable[];
  weekNumber: number; month: number; year: number;
  dailyTasks: DailyTask[]; status: "pending" | "in-progress" | "finished";
}
interface MonthlyTask {
  id: string; title: string; deliverables: Deliverable[];
  month: number; year: number; weeklyTasks: WeeklyTask[];
  status: "pending" | "in-progress" | "finished";
}
type TasksData = Record<string, MonthlyTask[]>;

interface Submission {
  id: string; userId: string; userName: string;
  dailyTaskId: string; weeklyTaskId: string; monthlyTaskId: string;
  taskTitle: string; deliverable: string; parentTitle: string;
  evidence: string[]; submittedAt: string;
  status: "pending" | "approved" | "returned"; adminNote?: string;
}

type LeaveType = "pass_slip" | "cto" | "leave";
interface LeaveRequest {
  id: string; userId: string; userName: string;
  type: LeaveType; date: string;
  timeFrom?: string; timeTo?: string; reason?: string;
  submittedAt: string; status: "pending" | "approved" | "returned"; adminNote?: string;
}

type NotifType = "submission" | "leave_request";
interface AppNotification {
  id: string; type: NotifType; userId: string; userName: string;
  title: string; message: string; timestamp: string; read: boolean;
  referenceId: string;
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

let _ctr = 0;
function genId() { return `id-${Date.now()}-${++_ctr}`; }

/** Deterministic ID for seed data — same inputs always produce the same ID.
 *  This ensures daily task IDs survive page refreshes so Supabase submissions
 *  can always find and update the correct task. */
function seedId(...parts: (string|number)[]): string {
  return `seed-${parts.join("-")}`;
}
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y: number, m: number) { return new Date(y, m, 1).getDay(); }
function getWeekCount(y: number, m: number) { return Math.ceil((getFirstDay(y, m) + getDaysInMonth(y, m)) / 7); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function nowISO() { return new Date().toISOString(); }
function formatDisplay(iso: string) { const [y,m,d] = iso.split("-"); return `${MONTHS[parseInt(m)-1]} ${parseInt(d)}, ${y}`; }
function formatDateWithDay(iso: string) { const d = new Date(iso + "T00:00:00"); return `${DAYS_LONG[d.getDay()]}, ${formatDisplay(iso)}`; }
function formatTimestamp(iso: string) { const d = new Date(iso); return d.toLocaleString("en-PH",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
function getFullName(u: UserProfile) { const mi = u.middleName ? ` ${u.middleName.charAt(0)}.` : ""; const sfx = u.suffix ? `, ${u.suffix}` : ""; return `${u.firstName}${mi} ${u.lastName}${sfx}`; }
function cleanTitle(t: string) { return t.replace(/^\[(AM|PM)\]\s*/i, ""); }
function getWeekDates(year: number, month: number, weekNum: number): string[] {
  const firstDay = getFirstDay(year, month); const daysInMonth = getDaysInMonth(year, month);
  const dates: string[] = [];
  for (let cell = (weekNum - 1) * 7; cell < weekNum * 7; cell++) {
    const dayNum = cell - firstDay + 1;
    if (dayNum >= 1 && dayNum <= daysInMonth) dates.push(`${year}-${String(month+1).padStart(2,"0")}-${String(dayNum).padStart(2,"0")}`);
  }
  return dates;
}
function getWorkdays(year: number, month: number, weekNum: number): string[] {
  return getWeekDates(year, month, weekNum).filter(d => { const dow = new Date(d).getDay(); return dow >= 1 && dow <= 5; });
}

// ─────────────────────────────────────────────────────────────
// SMART LOCAL TASK GENERATION ENGINE
// ─────────────────────────────────────────────────────────────
interface DomainConfig { phases: Array<{title:string;deliverable:string}>; dailyPool: Array<{title:string;deliverable:string}>; }
const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  audit: { phases:[{title:"Pre-Audit Planning & Scope Definition",deliverable:"Audit scope document and stakeholder list"},{title:"Asset Inventory & Baseline Documentation",deliverable:"Complete asset inventory spreadsheet"},{title:"Vulnerability Scanning & Testing",deliverable:"Automated vulnerability scan report"},{title:"Compliance Standards Review",deliverable:"Compliance gap analysis document"},{title:"Risk Identification & Scoring",deliverable:"Risk register with severity ratings"},{title:"Control Assessment & Testing",deliverable:"Control effectiveness assessment report"},{title:"Findings Documentation & Evidence Gathering",deliverable:"Audit findings log with evidence"},{title:"Remediation Planning & Prioritization",deliverable:"Remediation action plan with timelines"},{title:"Draft Report Preparation",deliverable:"Complete draft audit report"},{title:"Final Report Review & Sign-off",deliverable:"Signed and approved audit report"}], dailyPool:[{title:"Update audit scope and objectives documentation",deliverable:"Revised scope document"},{title:"Identify and catalog all network infrastructure assets",deliverable:"Network asset inventory list"},{title:"Run automated vulnerability scanning on target systems",deliverable:"Automated scan output file"},{title:"Manually review critical system configurations",deliverable:"Configuration review checklist"},{title:"Analyze user access control and privilege levels",deliverable:"Access control review report"},{title:"Test firewall rules and network segmentation",deliverable:"Firewall rules test report"},{title:"Review and analyze system and application logs",deliverable:"Log anomaly analysis summary"},{title:"Assess physical security controls and procedures",deliverable:"Physical security assessment notes"},{title:"Review patch management and update status",deliverable:"Patch status tracker update"},{title:"Document identified vulnerabilities and security gaps",deliverable:"Vulnerability documentation log"},{title:"Conduct risk scoring for all identified issues",deliverable:"Updated risk scoring matrix"},{title:"Coordinate with system owners for technical clarifications",deliverable:"Coordination meeting minutes"},{title:"Prepare remediation recommendations for each finding",deliverable:"Recommendations document"},{title:"Validate closure of previous audit action items",deliverable:"Action item closure validation report"},{title:"Update overall audit progress tracker and timeline",deliverable:"Updated audit progress tracker"},{title:"Prepare daily findings summary for team review",deliverable:"Daily findings summary report"},{title:"Cross-reference findings with applicable audit criteria",deliverable:"Cross-reference analysis notes"},{title:"Interview key personnel on security awareness",deliverable:"Personnel interview transcript"},{title:"Test data backup and recovery procedures",deliverable:"Backup and recovery test results"},{title:"Finalize evidence collection for current audit phase",deliverable:"Evidence collection folder update"}] },
  training: { phases:[{title:"Training Needs Assessment",deliverable:"Training needs analysis report"},{title:"Curriculum Design & Learning Objectives",deliverable:"Training curriculum outline"},{title:"Module Development – Core Content",deliverable:"Core training module draft"},{title:"Activity & Assessment Preparation",deliverable:"Training activities and quiz set"},{title:"Trainer & Resource Coordination",deliverable:"Trainer confirmation and resource list"},{title:"Training Platform & Venue Setup",deliverable:"Setup completion checklist"},{title:"Pre-Training Orientation & Registration",deliverable:"Participant registration list"},{title:"Training Delivery – Sessions",deliverable:"Session delivery attendance log"},{title:"Participant Evaluation & Feedback Collection",deliverable:"Evaluation forms and feedback summary"},{title:"Post-Training Report & Recommendations",deliverable:"Final training report with recommendations"}], dailyPool:[{title:"Survey target participants on current skill levels",deliverable:"Participant skills survey results"},{title:"Analyze gaps between current and required competencies",deliverable:"Competency gap analysis document"},{title:"Draft learning objectives for each training module",deliverable:"Module learning objectives document"},{title:"Develop presentation slides and training materials",deliverable:"Presentation materials draft"},{title:"Create hands-on exercises and real-world case studies",deliverable:"Exercises and case studies document"},{title:"Prepare knowledge assessment quizzes and evaluation forms",deliverable:"Pre/post-training quiz set"},{title:"Coordinate with assigned trainers on schedule and content",deliverable:"Trainer coordination notes"},{title:"Set up training platform, tools, and participant accounts",deliverable:"Platform setup completion report"},{title:"Send invitations and confirm participant attendance",deliverable:"Participant confirmation list"},{title:"Conduct training session and facilitate group discussion",deliverable:"Session attendance and participation log"},{title:"Collect participant feedback forms after each session",deliverable:"Completed feedback forms"},{title:"Tabulate and analyze training evaluation results",deliverable:"Feedback analysis and scoring summary"},{title:"Prepare post-training performance observation checklist",deliverable:"Post-training observation checklist"},{title:"Document lessons learned for future training improvements",deliverable:"Lessons learned documentation"},{title:"Update training records and certification tracking log",deliverable:"Updated training records file"},{title:"Review and finalize training materials for next session",deliverable:"Finalized training materials package"},{title:"Communicate the training schedule to all stakeholders",deliverable:"Schedule distribution confirmation"},{title:"Prepare venue or online environment for training",deliverable:"Venue/environment setup report"},{title:"Compile attendance records and generate summary",deliverable:"Attendance summary report"},{title:"Draft the final training completion report",deliverable:"Training completion report draft"}] },
  infrastructure: { phases:[{title:"Infrastructure Inventory & Documentation",deliverable:"Complete infrastructure inventory report"},{title:"Current State Assessment & Gap Analysis",deliverable:"Infrastructure gap analysis document"},{title:"Network Architecture Review",deliverable:"Network architecture diagram"},{title:"Hardware Condition & Lifecycle Evaluation",deliverable:"Hardware lifecycle assessment report"},{title:"Performance Benchmarking & Testing",deliverable:"Performance benchmarking results"},{title:"Capacity Planning & Scalability Review",deliverable:"Capacity planning document"},{title:"Security Posture & Access Control Review",deliverable:"Infrastructure security review report"},{title:"Vendor & Contract Review",deliverable:"Vendor and contract summary"},{title:"Improvement Plan Development",deliverable:"Infrastructure improvement plan"},{title:"Final Assessment Report & Presentation",deliverable:"Final assessment report and presentation"}], dailyPool:[{title:"Survey and catalog all server room hardware",deliverable:"Server room hardware catalog"},{title:"Document workstation specifications per department",deliverable:"Departmental workstation specs list"},{title:"Map and verify all active network connections",deliverable:"Active network connection map"},{title:"Test network bandwidth and throughput performance",deliverable:"Bandwidth performance test results"},{title:"Inspect cable management and physical infrastructure",deliverable:"Cable management inspection report"},{title:"Review and document IP address allocation scheme",deliverable:"IP address allocation spreadsheet"},{title:"Test network redundancy and failover mechanisms",deliverable:"Redundancy test results"},{title:"Assess power supply and UPS system capacity",deliverable:"Power assessment report"},{title:"Document cooling systems and environmental controls",deliverable:"Environmental controls report"},{title:"Review hardware warranty and replacement schedules",deliverable:"Hardware warranty tracker update"},{title:"Inventory all networking equipment",deliverable:"Network equipment inventory"},{title:"Test wireless access points for coverage",deliverable:"Wireless coverage test report"},{title:"Verify VLAN configuration and network segmentation",deliverable:"VLAN configuration review notes"},{title:"Assess storage capacity utilization",deliverable:"Storage utilization report"},{title:"Review remote access and VPN configurations",deliverable:"Remote access review report"},{title:"Document all software licenses installed",deliverable:"Software license inventory"},{title:"Test backup systems and data recovery",deliverable:"Backup test results"},{title:"Review perimeter security components",deliverable:"Perimeter security review notes"},{title:"Identify end-of-life hardware",deliverable:"EOL hardware replacement list"},{title:"Compile infrastructure improvement recommendations",deliverable:"Improvement recommendations document"}] },
  database: { phases:[{title:"Database Inventory & Schema Documentation",deliverable:"Complete database schema document"},{title:"Performance Baseline & Metrics Collection",deliverable:"Performance baseline report"},{title:"Query Optimization & Index Analysis",deliverable:"Query optimization recommendations"},{title:"Data Integrity & Quality Assessment",deliverable:"Data quality assessment report"},{title:"Backup & Recovery Procedure Review",deliverable:"Backup and recovery review report"},{title:"Security & Access Control Audit",deliverable:"Database security audit report"},{title:"Migration Planning & Testing",deliverable:"Migration plan and test results"},{title:"Optimization Implementation",deliverable:"Optimization change log"},{title:"Post-Optimization Performance Validation",deliverable:"Post-optimization performance report"},{title:"Final Documentation & Handover",deliverable:"Final database documentation package"}], dailyPool:[{title:"Catalog all database instances and their purposes",deliverable:"Database instance inventory"},{title:"Document all database schemas and table structures",deliverable:"Schema documentation file"},{title:"Collect and analyze slow query execution logs",deliverable:"Slow query analysis report"},{title:"Identify fragmented indexes and schedule rebuilds",deliverable:"Index fragmentation analysis"},{title:"Analyze storage utilization and project space needs",deliverable:"Storage utilization report"},{title:"Test and validate backup integrity and restore",deliverable:"Backup validation results"},{title:"Review database user roles and permissions",deliverable:"User permission review report"},{title:"Update and test connection pooling settings",deliverable:"Connection pool configuration notes"},{title:"Run statistics updates for query plan optimization",deliverable:"Statistics update log"},{title:"Identify and archive obsolete data and tables",deliverable:"Data archival log"},{title:"Review and optimize stored procedures",deliverable:"Stored procedure optimization notes"},{title:"Test migration scripts in staging environment",deliverable:"Migration script test results"},{title:"Validate referential integrity constraints",deliverable:"Integrity validation report"},{title:"Monitor and document database resource usage",deliverable:"Resource utilization log"},{title:"Review and update maintenance job schedules",deliverable:"Maintenance job schedule update"},{title:"Document replication and high-availability setup",deliverable:"Replication configuration document"},{title:"Test disaster recovery failover procedures",deliverable:"Failover test results"},{title:"Perform data quality checks and anomaly detection",deliverable:"Data quality check report"},{title:"Update database change management log",deliverable:"Updated change log"},{title:"Prepare final database health assessment",deliverable:"Database health summary report"}] },
  maintenance: { phases:[{title:"Maintenance Schedule Planning",deliverable:"Maintenance schedule and priority list"},{title:"Pre-Maintenance Inspection",deliverable:"Pre-maintenance inspection report"},{title:"Software Updates & Patch Deployment",deliverable:"Patch deployment log"},{title:"Hardware Servicing & Cleaning",deliverable:"Hardware servicing completion report"},{title:"System Configuration Review",deliverable:"Configuration optimization notes"},{title:"Security Controls Update",deliverable:"Security controls update report"},{title:"Performance Testing Post-Maintenance",deliverable:"Post-maintenance performance test"},{title:"Documentation Update",deliverable:"Updated documentation package"},{title:"User Communication & Change Notification",deliverable:"User notification record"},{title:"Post-Maintenance Validation & Sign-off",deliverable:"Maintenance completion sign-off form"}], dailyPool:[{title:"Review and update the preventive maintenance schedule",deliverable:"Updated maintenance schedule"},{title:"Inspect hardware for visible wear or damage",deliverable:"Hardware inspection checklist"},{title:"Apply pending operating system security patches",deliverable:"OS patch application log"},{title:"Update application software to latest stable version",deliverable:"Application update log"},{title:"Clean server chassis, workstations, and peripherals",deliverable:"Hardware cleaning completion record"},{title:"Test and verify UPS battery and backup capacity",deliverable:"UPS test results"},{title:"Review system services and disable unnecessary ones",deliverable:"Services optimization notes"},{title:"Clear temporary files, caches, and system junk",deliverable:"System cleanup log"},{title:"Check disk health and SMART status for all drives",deliverable:"Disk health report"},{title:"Test all peripheral devices and connections",deliverable:"Peripheral device test log"},{title:"Update antivirus definitions and run full scan",deliverable:"Antivirus scan report"},{title:"Archive and rotate old system logs",deliverable:"Log archival record"},{title:"Check network equipment firmware for updates",deliverable:"Firmware update status report"},{title:"Verify scheduled backup jobs completed",deliverable:"Backup verification report"},{title:"Test network connectivity across all endpoints",deliverable:"Connectivity test results"},{title:"Conduct printer and peripheral maintenance",deliverable:"Printer maintenance log"},{title:"Restart and verify services on production servers",deliverable:"Service restart log"},{title:"Document all maintenance actions performed",deliverable:"Daily maintenance activity log"},{title:"Communicate maintenance activities to users",deliverable:"User notification confirmation"},{title:"Prepare the weekly maintenance summary report",deliverable:"Weekly maintenance report"}] },
  general: { phases:[{title:"Project Initiation & Objective Setting",deliverable:"Project charter and objectives document"},{title:"Stakeholder Identification & Coordination",deliverable:"Stakeholder matrix and communication plan"},{title:"Research & Information Gathering",deliverable:"Research notes and reference documents"},{title:"Analysis & Findings Documentation",deliverable:"Analysis report with key findings"},{title:"Planning & Strategy Development",deliverable:"Detailed action plan and timeline"},{title:"Implementation – Phase 1 Execution",deliverable:"Phase 1 progress report"},{title:"Implementation – Phase 2 Execution",deliverable:"Phase 2 progress report"},{title:"Quality Review & Validation",deliverable:"Quality review checklist"},{title:"Documentation & Reporting",deliverable:"Complete documentation package"},{title:"Final Evaluation & Closure",deliverable:"Project closure report and sign-off"}], dailyPool:[{title:"Review project objectives and confirm alignment",deliverable:"Objectives review confirmation memo"},{title:"Coordinate with stakeholders for updates",deliverable:"Stakeholder coordination notes"},{title:"Gather and review reference documents",deliverable:"Reference materials compilation"},{title:"Conduct research on assigned topics",deliverable:"Research notes and summary"},{title:"Draft initial work outputs for review",deliverable:"Initial work output draft"},{title:"Revise drafts based on feedback received",deliverable:"Revised output document"},{title:"Update the project progress tracker",deliverable:"Updated project tracker"},{title:"Prepare daily progress summary",deliverable:"Daily progress summary"},{title:"Attend coordination meetings and document action items",deliverable:"Meeting minutes and action items"},{title:"Implement assigned action items from meetings",deliverable:"Action item completion log"},{title:"Verify quality and completeness of deliverables",deliverable:"Deliverable quality checklist"},{title:"File and organize documents in shared repository",deliverable:"Document filing confirmation"},{title:"Communicate progress updates to team members",deliverable:"Progress update record"},{title:"Identify and document risks and blockers",deliverable:"Risk and blocker log"},{title:"Conduct peer review of team outputs",deliverable:"Peer review notes"},{title:"Prepare presentation materials for stakeholder update",deliverable:"Stakeholder presentation draft"},{title:"Follow up on pending requests and approvals",deliverable:"Follow-up communication log"},{title:"Update and organize the documentation repository",deliverable:"Documentation repository update"},{title:"Review and finalize work outputs for submission",deliverable:"Finalized submission package"},{title:"Prepare end-of-week accomplishment summary",deliverable:"Weekly accomplishment summary"}] }
};
function detectDomain(title: string): string {
  const t = title.toLowerCase();
  if (/audit|security|vulnerab|compliance|penetration|cyber/.test(t)) return "audit";
  if (/train|learn|educat|workshop|seminar|literac|capacity.*build/.test(t)) return "training";
  if (/infrastructure|hardware|server|network|cable|equipment|physical/.test(t)) return "infrastructure";
  if (/database|db|sql|data.*(migrat|backup|optimiz)/.test(t)) return "database";
  if (/maintenance|repair|update|upgrade|patch|preventive|upkeep/.test(t)) return "maintenance";
  return "general";
}
function smartGenerateWeeklyTasks(monthly: MonthlyTask): WeeklyTask[] {
  const domain = detectDomain(monthly.title);
  const config = DOMAIN_CONFIGS[domain] ?? DOMAIN_CONFIGS["general"];
  const numWeeks = getWeekCount(monthly.year, monthly.month);
  const tasks: WeeklyTask[] = [];
  for (let w = 1; w <= numWeeks; w++) {
    for (let t = 0; t < 2; t++) {
      const phaseIdx = ((w - 1) * 2 + t) % config.phases.length;
      const phase = config.phases[phaseIdx];
      const wtId = seedId(monthly.id, "wt", w, t);
      const wt: WeeklyTask = {
        id: wtId,
        title: `${monthly.title} – ${phase.title}`,
        deliverables: [{ id: seedId(wtId, "deliv", 0), title: phase.deliverable, status: "pending" }],
        weekNumber: w, month: monthly.month, year: monthly.year, dailyTasks: [], status: "pending"
      };
      wt.dailyTasks = smartGenerateDailyTasks(wt, config, ((w - 1) * 2 + t) * 10);
      tasks.push(wt);
    }
  }
  return tasks;
}
function smartGenerateDailyTasks(weekly: WeeklyTask, config: DomainConfig, poolOffset: number): DailyTask[] {
  const workdays = getWorkdays(weekly.year, weekly.month, weekly.weekNumber);
  const pool = config.dailyPool;
  const tasks: DailyTask[] = [];
  for (let i = 0; i < 10; i++) {
    const dayIdx = Math.floor(i / 2);
    const date = workdays[dayIdx % Math.max(workdays.length, 1)] ?? `${weekly.year}-${String(weekly.month+1).padStart(2,"0")}-01`;
    const item = pool[(poolOffset + i) % pool.length];
    tasks.push({
      id: seedId(weekly.id, "dt", poolOffset, i),
      title: item.title, deliverable: item.deliverable, date, status: "pending", images: []
    });
  }
  return tasks;
}

// ─────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────

const TODAY = todayISO();
const INITIAL_USERS: UserProfile[] = [
  { id: "u-admin", username: "admin", lastName: "Reyes", firstName: "Maria", middleName: "Santos", suffix: "", nickname: "Mari", designation: "Division Head", position: "Chief Information Officer", mobilePhone: "09171234567", email: "admin@litm.gov.ph", password: "admin123", isAdmin: true, profilePicture: "" },
  { id: "u-001", username: "jcruz", lastName: "Cruz", firstName: "Jose", middleName: "Manuel", suffix: "Jr.", nickname: "Jojo", designation: "IT Specialist II", position: "Systems Analyst", mobilePhone: "09281234567", email: "jose.cruz@litm.gov.ph", password: "staff123", isAdmin: false, profilePicture: "" },
  { id: "u-002", username: "adelacruz", lastName: "Dela Cruz", firstName: "Ana", middleName: "Bautista", suffix: "", nickname: "Annie", designation: "IT Specialist I", position: "Network Administrator", mobilePhone: "09301234567", email: "ana.delacruz@litm.gov.ph", password: "staff123", isAdmin: false, profilePicture: "" },
  { id: "u-003", username: "msantos", lastName: "Santos", firstName: "Mark", middleName: "David", suffix: "", nickname: "Marky", designation: "IT Officer I", position: "Database Administrator", mobilePhone: "09191234567", email: "mark.santos@litm.gov.ph", password: "staff123", isAdmin: false, profilePicture: "" },
  { id: "u-test", username: "testuser", lastName: "Dela Vega", firstName: "Juan", middleName: "Sta. Maria", suffix: "", nickname: "Juan", designation: "IT Assistant", position: "IT Support Specialist", mobilePhone: "09991234567", email: "test.user@litm.gov.ph", password: "test123", isAdmin: false, profilePicture: "" },
];
function buildSeedTasks(): TasksData {
  const now = new Date(); const m = now.getMonth(); const y = now.getFullYear(); const t: TasksData = {};
  const u1mt: MonthlyTask = { id: seedId("u-001","mt",0), title: "Q2 IT Infrastructure Assessment", deliverables: [{ id: seedId("u-001","mt",0,"d",0), title: "Infrastructure Inventory Report", status: "done" }, { id: seedId("u-001","mt",0,"d",1), title: "Assessment Summary Presentation", status: "pending" }], month: m, year: y, status: "in-progress", weeklyTasks: [] };
  u1mt.weeklyTasks = smartGenerateWeeklyTasks(u1mt);
  t["u-001"] = [u1mt, { id: seedId("u-001","mt",1), title: "Employee Digital Literacy Program", deliverables: [{ id: seedId("u-001","mt",1,"d",0), title: "Training Module Design", status: "done" }, { id: seedId("u-001","mt",1,"d",1), title: "Post-Training Report", status: "pending" }], month: m, year: y, status: "pending", weeklyTasks: [] }];
  const u2mt: MonthlyTask = { id: seedId("u-002","mt",0), title: "Network Security Audit", deliverables: [{ id: seedId("u-002","mt",0,"d",0), title: "Vulnerability Assessment Report", status: "pending" }, { id: seedId("u-002","mt",0,"d",1), title: "Remediation Plan", status: "pending" }], month: m, year: y, status: "in-progress", weeklyTasks: [] };
  u2mt.weeklyTasks = smartGenerateWeeklyTasks(u2mt);
  t["u-002"] = [u2mt];
  const u3mt: MonthlyTask = { id: seedId("u-003","mt",0), title: "Database Optimization & Migration", deliverables: [{ id: seedId("u-003","mt",0,"d",0), title: "Migration Plan Document", status: "done" }, { id: seedId("u-003","mt",0,"d",1), title: "Post-Migration Performance Report", status: "pending" }], month: m, year: y, status: "in-progress", weeklyTasks: [] };
  u3mt.weeklyTasks = smartGenerateWeeklyTasks(u3mt);
  t["u-003"] = [u3mt];
  t["u-admin"] = []; t["u-test"] = [];
  return t;
}

// ─────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────

function FormField({ label, value, onChange, type="text", optional=false, placeholder="", autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; optional?: boolean; placeholder?: string; autoComplete?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}{optional && <span className="text-muted-foreground text-xs ml-1">(Optional)</span>}</label>
      <input type={type} value={value} autoComplete={autoComplete} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all" />
    </div>
  );
}
function ProfileInfoField({ label, value, editing, onChange }: { label: string; value: string; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      {editing
        ? <input value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-input-background text-base font-semibold focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all" />
        : <p className="text-base font-semibold text-foreground">{value || "—"}</p>}
    </div>
  );
}
function Modal({ title, onClose, children, wide, extraWide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; extraWide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(26,43,74,0.55)", backdropFilter: "blur(3px)" }}>
      <div className={`bg-card rounded-2xl shadow-2xl flex flex-col max-h-[92vh] ${extraWide ? "w-full max-w-5xl" : wide ? "w-full max-w-3xl" : "w-full max-w-lg"}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string,string> = { pending:"bg-amber-50 text-amber-700 border border-amber-200", "in-progress":"bg-blue-50 text-blue-700 border border-blue-200", finished:"bg-green-50 text-green-700 border border-green-200", done:"bg-green-50 text-green-700 border border-green-200", submitted:"bg-blue-50 text-blue-700 border border-blue-200", approved:"bg-green-50 text-green-700 border border-green-200", returned:"bg-red-50 text-red-700 border border-red-200" };
  const labels: Record<string,string> = { pending:"Pending","in-progress":"In Progress",finished:"Finished",done:"Done",submitted:"Under Review",approved:"Approved",returned:"Returned" };
  const icons: Record<string,React.ReactNode> = { pending:<Circle size={11}/>, "in-progress":<Clock size={11}/>, finished:<CheckCircle2 size={11}/>, done:<CheckCircle2 size={11}/>, submitted:<Clock size={11}/>, approved:<CheckCircle2 size={11}/>, returned:<RotateCcw size={11}/> };
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg[status]??"bg-muted text-muted-foreground"}`}>{icons[status]??<Circle size={11}/>}{labels[status]??status}</span>;
}

// ─────────────────────────────────────────────────────────────
// SIGN-IN PAGE
// ─────────────────────────────────────────────────────────────
function SignInPage({ users, onSignIn, onGoRegister }: { users: UserProfile[]; onSignIn: (u: UserProfile) => void; onGoRegister: () => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  function handleSignIn() {
    const found = users.find(u => (u.username === username || u.email === username) && u.password === password);
    if (found) { setError(""); onSignIn(found); } else setError("Incorrect username or password.");
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full overflow-hidden bg-white shadow-lg border-4 border-accent mb-3 mx-auto">
            <ImageWithFallback src={LITMLogo} alt="LITM Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-lg font-bold text-foreground leading-snug">Learning Innovation and<br />Technology Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Task & Accomplishment Tracker</p>
        </div>
        <div className="bg-card rounded-2xl shadow-lg border border-border p-7">
          <h2 className="text-base font-semibold text-foreground mb-5">Sign In to Your Account</h2>
          {error && <div className="flex items-center gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4"><AlertCircle size={14} className="flex-shrink-0" /> {error}</div>}
          <form onSubmit={(e) => { e.preventDefault(); handleSignIn(); }}>
            <div className="space-y-4">
              <FormField label="Username" value={username} onChange={setUsername} placeholder="Enter your username" autoComplete="username" />
              <FormField label="Password" value={password} onChange={setPassword} type="password" placeholder="••••••••" autoComplete="current-password" />
            </div>
            <div className="flex flex-col gap-3 mt-6">
              <button type="submit" className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all">Sign In</button>
              <button type="button" onClick={onGoRegister} className="w-full py-2.5 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-all">Create New Account</button>
            </div>
          </form>
          <div className="mt-5 p-3.5 rounded-xl bg-muted/60 border border-border space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Demo Accounts</p>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Admin</span><span className="font-mono">admin / admin123</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Staff</span><span className="font-mono">jcruz / staff123</span></div>
            <div className="flex justify-between text-xs"><span className="font-semibold" style={{color:"#b45309"}}>★ Test</span><span className="font-mono">testuser / test123</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// REGISTER PAGE
// ─────────────────────────────────────────────────────────────
function RegisterPage({ users, onRegister, onBack }: { users: UserProfile[]; onRegister: (u: UserProfile) => void; onBack: () => void }) {
  const [lastName, setLastName] = useState(""); const [firstName, setFirstName] = useState(""); const [middleName, setMiddleName] = useState(""); const [suffix, setSuffix] = useState(""); const [nickname, setNickname] = useState(""); const [username, setUsername] = useState(""); const [designation, setDesignation] = useState(""); const [position, setPosition] = useState(""); const [mobilePhone, setMobilePhone] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [error, setError] = useState("");
  function handleRegister() {
    if (!lastName||!firstName||!middleName||!nickname||!username||!designation||!position||!mobilePhone||!email||!password) { setError("Please fill in all required fields."); return; }
    if (users.some(u => u.username === username)) { setError("Username already taken."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setError(""); onRegister({ id:genId(),username,lastName,firstName,middleName,suffix,nickname,designation,position,mobilePhone,email,password,isAdmin:false,profilePicture:"" });
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 py-8">
      <div className="w-full max-w-xl">
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full overflow-hidden bg-white shadow border-2 border-accent mb-2 mx-auto"><ImageWithFallback src={LITMLogo} alt="LITM" className="w-full h-full object-cover" /></div>
          <h1 className="text-xl font-bold text-foreground">Create Account</h1>
          <p className="text-sm text-muted-foreground">LITM Task Tracker — New Staff Registration</p>
        </div>
        <div className="bg-card rounded-2xl shadow-lg border border-border p-7">
          {error && <div className="flex items-center gap-2 text-sm text-destructive bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-5"><AlertCircle size={14} className="flex-shrink-0" /> {error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Last Name" value={lastName} onChange={setLastName} autoComplete="family-name" />
            <FormField label="First Name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
            <FormField label="Middle Name" value={middleName} onChange={setMiddleName} />
            <FormField label="Suffix" value={suffix} onChange={setSuffix} optional />
            <FormField label="Nickname" value={nickname} onChange={setNickname} />
            <FormField label="Username" value={username} onChange={setUsername} placeholder="e.g., jdelacruz" autoComplete="username" />
            <FormField label="Designation" value={designation} onChange={setDesignation} />
            <FormField label="Position" value={position} onChange={setPosition} />
            <FormField label="Mobile Phone Number" value={mobilePhone} onChange={setMobilePhone} type="tel" autoComplete="tel" />
            <FormField label="Email Address" value={email} onChange={setEmail} type="email" autoComplete="email" />
            <FormField label="Password" value={password} onChange={setPassword} type="password" autoComplete="new-password" />
            <FormField label="Confirm Password" value={confirmPassword} onChange={setConfirmPassword} type="password" autoComplete="new-password" />
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Back to Sign In</button>
            <button onClick={handleRegister} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all">Register</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TOP NAV
// ─────────────────────────────────────────────────────────────
function TopNav({ user, page, setPage, onSignOut, unreadCount }: { user: UserProfile; page: Page; setPage: (p: Page) => void; onSignOut: () => void; unreadCount: number }) {
  const navItems: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key:"home", label:"Home", icon:<Home size={14}/> },
    { key:"profile", label:"Profile", icon:<User size={14}/> },
    { key:"tasks", label:"My Tasks", icon:<CheckSquare size={14}/> },
    { key:"accomplishments", label:"My Accomplishments", icon:<Award size={14}/> },
    { key:"notifications", label:"Notifications", icon:<Bell size={14}/> },
  ];
  if (user.isAdmin) { navItems.push({ key:"monitoring", label:"LITM Monitoring", icon:<Users size={14}/> }); navItems.push({ key:"history", label:"History", icon:<ClipboardCheck size={14}/> }); }
  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-primary shadow-lg">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-accent flex-shrink-0 bg-white"><ImageWithFallback src={LITMLogo} alt="LITM" className="w-full h-full object-cover" /></div>
          <span className="text-white font-bold text-sm tracking-wide hidden sm:inline">LITM Task Tracker</span>
        </div>
        <nav className="hidden md:flex items-center gap-0.5">
          {navItems.map(item => (
            <button key={item.key} onClick={() => setPage(item.key)}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${page===item.key ? "bg-accent text-accent-foreground font-semibold" : "text-white/70 hover:text-white hover:bg-white/10"}`}>
              {item.icon} {item.label}
              {item.key==="notifications" && unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 border-l border-white/20 pl-3 ml-1">
            {user.profilePicture ? <img src={user.profilePicture} className="w-7 h-7 rounded-full object-cover ring-2 ring-accent/60" alt="avatar" /> : <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-bold">{user.firstName.charAt(0)}{user.lastName.charAt(0)}</div>}
            <span className="text-white/75 text-sm">{user.nickname||user.firstName}</span>
          </div>
          {unreadCount > 0 && <button onClick={() => setPage("notifications")} className="relative md:hidden p-2 text-white/70 hover:text-white"><Bell size={18}/><span className="absolute top-0 right-0 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span></button>}
          <button onClick={onSignOut} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm px-2 py-1.5 rounded-lg hover:bg-white/10 transition-all"><LogOut size={14}/> <span className="hidden sm:inline">Sign Out</span></button>
        </div>
      </div>
      <div className="md:hidden flex overflow-x-auto gap-0.5 px-4 pb-2">
        {navItems.map(item => (
          <button key={item.key} onClick={() => setPage(item.key)}
            className={`relative flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${page===item.key ? "bg-accent text-accent-foreground font-semibold" : "text-white/55 hover:text-white hover:bg-white/10"}`}>
            {item.icon} {item.label}
            {item.key==="notifications" && unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{unreadCount}</span>}
          </button>
        ))}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// PASS SLIP MODAL
// ─────────────────────────────────────────────────────────────
function PassSlipModal({ date, user, onSubmit, onClose }: { date: string; user: UserProfile; onSubmit: (req: LeaveRequest) => void; onClose: () => void }) {
  const [timeFrom, setTimeFrom] = useState("08:00"); const [timeTo, setTimeTo] = useState("12:00"); const [reason, setReason] = useState("");
  function handleSubmit() {
    const req: LeaveRequest = { id:genId(), userId:user.id, userName:getFullName(user), type:"pass_slip", date, timeFrom, timeTo, reason, submittedAt:nowISO(), status:"pending" };
    onSubmit(req);
  }
  return (
    <Modal title="Request Pass Slip" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-secondary border border-accent/30 text-sm"><span className="font-semibold">Date:</span> {formatDateWithDay(date)}</div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">Time From</label><input type="time" value={timeFrom} onChange={e=>setTimeFrom(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" /></div>
          <div><label className="block text-sm font-medium mb-1">Time To</label><input type="time" value={timeTo} onChange={e=>setTimeTo(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" /></div>
        </div>
        <div><label className="block text-sm font-medium mb-1">Reason <span className="text-muted-foreground text-xs">(Optional)</span></label><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder="Brief reason for pass slip..." className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all resize-none" /></div>
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2"><AlertCircle size={13} className="flex-shrink-0 mt-0.5"/><span>This pass slip request will be sent to the admin for approval. The calendar will show it as pending until approved.</span></div>
        <div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Confirm & Submit</button></div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// CTO / LEAVE MODAL
// ─────────────────────────────────────────────────────────────
function CTOLeaveModal({ date, user, onSubmit, onClose }: { date: string; user: UserProfile; onSubmit: (req: LeaveRequest) => void; onClose: () => void }) {
  const [type, setType] = useState<"cto"|"leave">("cto"); const [reason, setReason] = useState("");
  function handleSubmit() {
    const req: LeaveRequest = { id:genId(), userId:user.id, userName:getFullName(user), type, date, reason, submittedAt:nowISO(), status:"pending" };
    onSubmit(req);
  }
  return (
    <Modal title="Request CTO / Leave" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-secondary border border-accent/30 text-sm"><span className="font-semibold">Date:</span> {formatDateWithDay(date)}</div>
        <div>
          <label className="block text-sm font-medium mb-2">Request Type</label>
          <div className="grid grid-cols-2 gap-3">
            {(["cto","leave"] as const).map(t => (
              <button key={t} onClick={() => setType(t)} className={`py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${type===t ? "border-accent bg-secondary text-foreground" : "border-border hover:border-accent/40"}`}>
                {t==="cto" ? "Compensatory Time-off (CTO)" : "Leave"}
              </button>
            ))}
          </div>
        </div>
        <div><label className="block text-sm font-medium mb-1">Reason <span className="text-muted-foreground text-xs">(Optional)</span></label><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder="Brief reason for your request..." className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all resize-none" /></div>
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2"><AlertCircle size={13} className="flex-shrink-0 mt-0.5"/><span>This {type==="cto"?"CTO":"leave"} request will be forwarded to the admin for review and approval.</span></div>
        <div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all">Confirm & Submit</button></div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// EVIDENCE UPLOAD MODAL
// ─────────────────────────────────────────────────────────────
function EvidenceUploadModal({ task, onSubmit, onClose }: { task: DailyTask; onSubmit: (images: string[]) => void; onClose: () => void }) {
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => setImages(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(file);
    });
  }
  function removeImage(i: number) { setImages(prev => prev.filter((_,j) => j!==i)); }
  return (
    <Modal title="Submit Evidence for Approval" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-muted/40 border border-border space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Task</p>
          <p className="text-sm font-semibold text-foreground">{cleanTitle(task.title)}</p>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-2">Deliverable</p>
          <p className="text-sm text-foreground">{task.deliverable}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-2">Upload Evidence <span className="text-muted-foreground text-xs">(screenshots, photos)</span></p>
          <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-accent/40 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-accent hover:bg-secondary/30 transition-all">
            <Upload size={22} className="text-accent" />
            <span className="text-sm font-medium text-accent">Click to upload files</span>
            <span className="text-xs text-muted-foreground">PNG, JPG, screenshots supported</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </div>
        {images.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{images.length} file{images.length>1?"s":""} attached</p>
            <div className="grid grid-cols-3 gap-2">
              {images.map((img,i) => (
                <div key={i} className="relative rounded-lg overflow-hidden border border-border group">
                  <img src={img} alt={`evidence-${i+1}`} className="w-full h-20 object-cover" />
                  <button onClick={() => removeImage(i)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X size={10}/></button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-start gap-2"><AlertCircle size={13} className="flex-shrink-0 mt-0.5"/><span>Once submitted, the admin will review your evidence. The task will be marked as Approved only after admin confirmation, and will then appear in your accomplishments.</span></div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button>
          <button onClick={() => images.length > 0 && onSubmit(images)} disabled={images.length===0} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${images.length>0 ? "bg-accent text-accent-foreground hover:bg-accent/80" : "bg-muted text-muted-foreground cursor-not-allowed"}`}>
            <ClipboardCheck size={14} className="inline mr-1.5" />Submit for Approval
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// MONTH CALENDAR — enhanced indicators + click popup with pass slip/CTO
// ─────────────────────────────────────────────────────────────
function MonthCalendar({ allDailyTasks, leaveRequests, currentUser, onSubmitLeave }: {
  allDailyTasks: DailyTask[]; leaveRequests: LeaveRequest[];
  currentUser: UserProfile; onSubmitLeave: (req: LeaveRequest, notif: AppNotification) => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string|null>(null);
  const [showPassSlip, setShowPassSlip] = useState(false);
  const [showCTO, setShowCTO] = useState(false);

  const firstDay = getFirstDay(viewYear, viewMonth);
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const isCurrentMonth = viewYear===now.getFullYear() && viewMonth===now.getMonth();

  const tasksByDate: Record<string,DailyTask[]> = {};
  allDailyTasks.forEach(t => {
    const d = new Date(t.date);
    if (d.getFullYear()===viewYear && d.getMonth()===viewMonth) {
      if (!tasksByDate[t.date]) tasksByDate[t.date]=[];
      tasksByDate[t.date].push(t);
    }
  });

  const leaveByDate: Record<string,LeaveRequest[]> = {};
  leaveRequests.filter(r => r.userId===currentUser.id).forEach(r => {
    if (!leaveByDate[r.date]) leaveByDate[r.date]=[];
    leaveByDate[r.date].push(r);
  });

  const cells: (number|null)[] = [...Array(firstDay).fill(null), ...Array.from({length:daysInMonth},(_,i)=>i+1)];
  while (cells.length%7!==0) cells.push(null);

  function navMonth(dir:number) { let mo=viewMonth+dir,yr=viewYear; if(mo<0){mo=11;yr--;}else if(mo>11){mo=0;yr++;} setViewMonth(mo);setViewYear(yr); }

  const selectedTasks = selectedDate ? (tasksByDate[selectedDate]??[]) : [];
  const selectedLeave = selectedDate ? (leaveByDate[selectedDate]??[]) : [];

  function handleLeaveSubmit(req: LeaveRequest) {
    const notif: AppNotification = { id:genId(), type:"leave_request", userId:currentUser.id, userName:getFullName(currentUser), title:`${req.type==="pass_slip"?"Pass Slip":req.type==="cto"?"CTO":"Leave"} Request`, message:`${getFullName(currentUser)} submitted a ${req.type==="pass_slip"?"pass slip":req.type==="cto"?"CTO":"leave"} request for ${formatDisplay(req.date)}${req.type==="pass_slip"?` (${req.timeFrom} – ${req.timeTo})`:""}`, timestamp:nowISO(), read:false, referenceId:req.id };
    onSubmitLeave(req, notif);
    setShowPassSlip(false); setShowCTO(false); setSelectedDate(null);
  }

  return (
    <>
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 bg-primary">
          <button onClick={()=>navMonth(-1)} className="p-1.5 rounded-lg text-white/65 hover:text-white hover:bg-white/15 transition-colors"><ChevronLeft size={16}/></button>
          <h3 className="text-sm font-semibold text-white">{MONTHS[viewMonth]} {viewYear}</h3>
          <button onClick={()=>navMonth(1)} className="p-1.5 rounded-lg text-white/65 hover:text-white hover:bg-white/15 transition-colors"><ChevronRight size={16}/></button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-7 mb-2">{DAYS_SHORT.map(d=><div key={d} className="text-center text-xs font-bold text-muted-foreground py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day,i) => {
              if (!day) return <div key={i}/>;
              const iso = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const isToday = isCurrentMonth && day===now.getDate();
              const dayTasks = tasksByDate[iso]??[];
              const hasTasks = dayTasks.length>0;
              const allDone = hasTasks && dayTasks.every(t=>t.status==="approved"||t.status==="finished");
              const someDone = hasTasks && !allDone && dayTasks.some(t=>t.status==="approved"||t.status==="finished");
              const dayLeave = leaveByDate[iso]??[];
              const hasPassSlip = dayLeave.some(r=>r.type==="pass_slip");
              const hasCTO = dayLeave.some(r=>r.type==="cto"||r.type==="leave");
              return (
                <button key={i} onClick={()=>setSelectedDate(iso)} title={hasTasks?`${dayTasks.length} task${dayTasks.length>1?"s":""} — click to view`:undefined}
                  className={`relative flex flex-col items-center justify-start pt-1.5 pb-1 h-12 w-full rounded-xl text-sm font-semibold transition-all hover:scale-105 cursor-pointer
                    ${isToday ? "bg-accent text-accent-foreground shadow-lg ring-2 ring-accent/40" : hasTasks ? allDone ? "bg-green-100 border-2 border-green-400 text-green-800" : someDone ? "bg-blue-50 border-2 border-blue-400 text-blue-800" : "bg-amber-50 border-2 border-amber-400 text-amber-800" : "hover:bg-muted text-foreground border border-transparent hover:border-border"}`}>
                  <span className="leading-none">{day}</span>
                  {hasTasks && (
                    <span className={`mt-0.5 text-[9px] font-bold leading-none ${isToday?"text-accent-foreground/70":allDone?"text-green-600":someDone?"text-blue-600":"text-amber-600"}`}>
                      {dayTasks.length} task{dayTasks.length>1?"s":""}
                    </span>
                  )}
                  {(hasPassSlip||hasCTO) && (
                    <span className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      {hasPassSlip && <span className="w-1.5 h-1.5 rounded-full bg-orange-500"/>}
                      {hasCTO && <span className="w-1.5 h-1.5 rounded-full bg-purple-500"/>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-4 pb-3 border-t border-border pt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-amber-50 border-2 border-amber-400 flex-shrink-0"/><span className="text-xs text-muted-foreground">Has pending tasks</span></div>
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-blue-50 border-2 border-blue-400 flex-shrink-0"/><span className="text-xs text-muted-foreground">Partially done</span></div>
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-green-100 border-2 border-green-400 flex-shrink-0"/><span className="text-xs text-muted-foreground">All done</span></div>
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-md bg-accent flex-shrink-0"/><span className="text-xs text-muted-foreground">Today</span></div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 flex-shrink-0"/><span className="text-xs text-muted-foreground">Pass slip</span></div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0"/><span className="text-xs text-muted-foreground">CTO/Leave</span></div>
        </div>
      </div>

      {/* Date detail modal */}
      {selectedDate && !showPassSlip && !showCTO && (
        <Modal title={formatDateWithDay(selectedDate)} onClose={()=>setSelectedDate(null)} wide>
          <div className="space-y-4">
            {/* Task list */}
            {selectedTasks.length>0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{selectedTasks.length} Task{selectedTasks.length>1?"s":""}</p>
                {selectedTasks.map((t,i) => (
                  <div key={t.id} className={`rounded-xl border p-3.5 mb-2 space-y-1.5 ${t.status==="approved"||t.status==="finished"?"border-green-200 bg-green-50":t.status==="submitted"?"border-blue-200 bg-blue-50":t.status==="returned"?"border-red-200 bg-red-50":"border-border bg-muted/20"}`}>
                    <div className="flex items-start justify-between gap-2"><p className="text-xs text-muted-foreground font-mono">{i+1}. {t.date}</p><StatusBadge status={t.status}/></div>
                    <p className="text-sm font-semibold text-foreground">{cleanTitle(t.title)}</p>
                    <div className="flex items-center gap-1.5"><FileText size={11} className="text-muted-foreground flex-shrink-0"/><p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">Deliverable:</span> {t.deliverable}</p></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">No tasks for this date.</div>
            )}

            {/* Leave requests */}
            {selectedLeave.length>0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Leave Requests</p>
                {selectedLeave.map(r => (
                  <div key={r.id} className="p-3 rounded-xl border border-border bg-muted/20 mb-2 text-sm">
                    <div className="flex items-center justify-between"><span className="font-semibold text-foreground capitalize">{r.type==="pass_slip"?"Pass Slip":r.type==="cto"?"CTO":"Leave"}</span><StatusBadge status={r.status}/></div>
                    {r.type==="pass_slip" && <p className="text-xs text-muted-foreground mt-1">Time: {r.timeFrom} – {r.timeTo}</p>}
                    {r.reason && <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="border-t border-border pt-3 grid grid-cols-2 gap-3">
              <button onClick={()=>setShowPassSlip(true)} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-all">
                <FileText size={14}/>Pass Slip
              </button>
              <button onClick={()=>setShowCTO(true)} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all">
                <Plane size={14}/>Request CTO/Leave
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPassSlip && selectedDate && <PassSlipModal date={selectedDate} user={currentUser} onSubmit={handleLeaveSubmit} onClose={()=>setShowPassSlip(false)} />}
      {showCTO && selectedDate && <CTOLeaveModal date={selectedDate} user={currentUser} onSubmit={handleLeaveSubmit} onClose={()=>setShowCTO(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME PAGE — checklist-style task table
// ─────────────────────────────────────────────────────────────
function HomePage({ user, tasks, leaveRequests, onSubmitLeave, onEvidenceSubmit }: {
  user: UserProfile; tasks: MonthlyTask[]; leaveRequests: LeaveRequest[];
  onSubmitLeave: (req: LeaveRequest, notif: AppNotification) => void;
  onEvidenceSubmit: (dailyId: string, images: string[], submission: Submission, notif: AppNotification) => void;
}) {
  const [expandedRow, setExpandedRow] = useState<string|null>(null);
  const [evidenceTask, setEvidenceTask] = useState<{dt:DailyTask;mtTitle:string;mtId:string;wtId:string}|null>(null);

  const todayTasks = tasks.flatMap(mt => mt.weeklyTasks.flatMap(wt => wt.dailyTasks.filter(dt=>dt.date===TODAY).map(dt=>({dt,mtTitle:mt.title,mtId:mt.id,wtId:wt.id}))));
  const allDaily = tasks.flatMap(mt => mt.weeklyTasks.flatMap(wt => wt.dailyTasks));
  const hour = new Date().getHours();
  const greeting = hour<12?"Good morning":hour<18?"Good afternoon":"Good evening";

  function handleEvidenceSubmit(images: string[]) {
    if (!evidenceTask) return;
    const { dt, mtTitle, mtId, wtId } = evidenceTask;
    const submission: Submission = { id:genId(), userId:user.id, userName:getFullName(user), dailyTaskId:dt.id, weeklyTaskId:wtId, monthlyTaskId:mtId, taskTitle:cleanTitle(dt.title), deliverable:dt.deliverable, parentTitle:mtTitle, evidence:images, submittedAt:nowISO(), status:"pending" };
    const notif: AppNotification = { id:genId(), type:"submission", userId:user.id, userName:getFullName(user), title:`${getFullName(user)} submitted a deliverable`, message:`Task: "${cleanTitle(dt.title)}" — ${mtTitle}`, timestamp:nowISO(), read:false, referenceId:submission.id };
    onEvidenceSubmit(dt.id, images, submission, notif);
    setEvidenceTask(null);
  }

  const statusDot = (s: DailyStatus) => {
    const m: Record<DailyStatus,string> = { pending:"border-2 border-amber-400 bg-white", submitted:"bg-blue-500", approved:"bg-green-500", returned:"bg-red-500", finished:"bg-green-500" };
    return <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${m[s]}`}>{(s==="approved")&&<Check size={11} className="text-white"/>}{(s==="returned")&&<X size={11} className="text-white"/>}</span>;
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-bold text-foreground">{greeting}, {user.nickname||user.firstName}!</h1><p className="text-sm text-muted-foreground mt-0.5">{formatDisplay(TODAY)} · {user.position}</p></div>
      <MonthCalendar allDailyTasks={allDaily} leaveRequests={leaveRequests} currentUser={user} onSubmitLeave={onSubmitLeave} />

      {/* Today's Tasks — checklist style */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-2"><CalendarIcon size={15} className="text-accent"/><h2 className="text-sm font-bold text-foreground">{"Today's Tasks"}</h2></div>
          <span className="text-xs font-mono bg-primary text-white px-2.5 py-1 rounded-full">{todayTasks.length} task{todayTasks.length!==1?"s":""}</span>
        </div>

        {todayTasks.length===0 ? (
          <div className="py-12 text-center text-muted-foreground"><CheckCircle2 size={32} className="mx-auto mb-2 text-green-400 opacity-50"/><p className="text-sm font-medium">No tasks scheduled for today</p></div>
        ) : (
          <div>
            {/* Column headers */}
            <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-0 border-b-2 border-primary/20 bg-primary/5 px-4 py-2.5">
              <div className="w-7"/>
              <div className="text-xs font-bold uppercase tracking-widest text-primary px-3">Task</div>
              <div className="text-xs font-bold uppercase tracking-widest text-primary px-3 border-l-2 border-primary/20">Deliverable</div>
              <div className="w-24 text-xs font-bold uppercase tracking-widest text-primary text-center">Status</div>
            </div>

            {todayTasks.map(({ dt, mtTitle, mtId, wtId }, idx) => (
              <div key={dt.id} className={`border-b border-border last:border-b-0 ${idx%2===0?"bg-white":"bg-muted/20"}`}>
                <button className={`w-full grid grid-cols-[auto_1fr_1fr_auto] gap-0 px-4 py-3.5 text-left hover:bg-secondary/30 transition-colors ${expandedRow===dt.id?"bg-secondary/30":""}`}
                  onClick={()=>setExpandedRow(expandedRow===dt.id?null:dt.id)}>
                  <div className="flex items-center pr-2 pt-0.5">{statusDot(dt.status)}</div>
                  <div className="px-3 min-w-0 border-r border-border/50">
                    <p className={`text-sm font-semibold truncate ${dt.status==="approved"?"line-through text-muted-foreground":"text-foreground"}`}>{cleanTitle(dt.title)}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{mtTitle}</p>
                  </div>
                  <div className="px-3 min-w-0 flex items-center">
                    <p className="text-sm text-foreground/75 truncate">{dt.deliverable}</p>
                  </div>
                  <div className="w-24 flex items-center justify-center gap-1">
                    <StatusBadge status={dt.status}/>
                    {expandedRow===dt.id?<ChevronUp size={12} className="text-muted-foreground flex-shrink-0"/>:<ChevronDown size={12} className="text-muted-foreground flex-shrink-0"/>}
                  </div>
                </button>

                {expandedRow===dt.id && (
                  <div className="px-5 py-3 bg-secondary/20 border-t border-border flex items-center gap-3 flex-wrap">
                    {dt.status==="pending" && (
                      <button onClick={()=>setEvidenceTask({dt,mtTitle,mtId,wtId})} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent/80 active:scale-[0.97] transition-all">
                        <Upload size={14}/> Upload Evidence & Submit
                      </button>
                    )}
                    {dt.status==="submitted" && <p className="text-sm text-blue-600 font-medium flex items-center gap-1.5"><Clock size={14}/> Under admin review…</p>}
                    {dt.status==="approved" && <p className="text-sm text-green-600 font-medium flex items-center gap-1.5"><CheckCircle2 size={14}/> Approved by admin!</p>}
                    {dt.status==="returned" && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-red-600 font-medium flex items-center gap-1.5"><RotateCcw size={14}/> Returned{dt.adminNote?`: "${dt.adminNote}"`:""}</p>
                        <button onClick={()=>setEvidenceTask({dt,mtTitle,mtId,wtId})} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent/80 transition-all"><Upload size={14}/> Re-submit Evidence</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {evidenceTask && <EvidenceUploadModal task={evidenceTask.dt} onSubmit={handleEvidenceSubmit} onClose={()=>setEvidenceTask(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROFILE PAGE — small labels, large info values
// ─────────────────────────────────────────────────────────────
function ProfilePage({ user, onUpdate }: { user: UserProfile; onUpdate: (u: UserProfile) => void }) {
  const [editing, setEditing] = useState(false); const [form, setForm] = useState<UserProfile>(user);
  const fileRef = useRef<HTMLInputElement>(null); const videoRef = useRef<HTMLVideoElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream|null>(null); const [showCamera, setShowCamera] = useState(false);
  function setField(k: keyof UserProfile, v: string) { setForm(f=>({...f,[k]:v})); }
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) { const file=e.target.files?.[0]; if(!file)return; const r=new FileReader(); r.onload=ev=>{const url=ev.target?.result as string;onUpdate({...user,profilePicture:url});setForm(f=>({...f,profilePicture:url}));};r.readAsDataURL(file); }
  async function startCamera() { try{const s=await navigator.mediaDevices.getUserMedia({video:true});setStream(s);setShowCamera(true);setTimeout(()=>{if(videoRef.current)videoRef.current.srcObject=s;},100);}catch{alert("Camera not available.");} }
  function capturePhoto(){if(!videoRef.current||!canvasRef.current)return;const ctx=canvasRef.current.getContext("2d")!;canvasRef.current.width=videoRef.current.videoWidth;canvasRef.current.height=videoRef.current.videoHeight;ctx.drawImage(videoRef.current,0,0);const url=canvasRef.current.toDataURL("image/jpeg");stream?.getTracks().forEach(t=>t.stop());setStream(null);setShowCamera(false);onUpdate({...user,profilePicture:url});setForm(f=>({...f,profilePicture:url}));}
  function closeCamera(){stream?.getTracks().forEach(t=>t.stop());setStream(null);setShowCamera(false);}
  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-foreground">My Profile</h1>
      <div className="bg-card rounded-2xl border border-border shadow-sm p-6 flex flex-col items-center gap-4">
        <button className="group relative w-24 h-24 rounded-full overflow-hidden ring-4 ring-secondary hover:ring-accent/50 transition-all">
          {user.profilePicture?<img src={user.profilePicture} alt="profile" className="w-full h-full object-cover"/>:<div className="w-full h-full bg-primary flex items-center justify-center text-white text-2xl font-bold">{user.firstName.charAt(0)}{user.lastName.charAt(0)}</div>}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Camera size={20} className="text-white"/></div>
        </button>
        <div className="flex gap-3">
          <button onClick={()=>fileRef.current?.click()} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-border hover:bg-muted transition-all"><Upload size={12}/> Upload Photo</button>
          <button onClick={startCamera} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-border hover:bg-muted transition-all"><Camera size={12}/> Take Photo</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload}/>
        <h2 className="text-xl font-bold text-foreground">{getFullName(user)}</h2>
        <p className="text-sm text-muted-foreground -mt-3">{user.designation} · {user.position}</p>
      </div>
      <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
          {!editing?<button onClick={()=>setEditing(true)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-border hover:bg-muted transition-all"><Edit2 size={12}/> Edit Profile</button>:<div className="flex gap-2"><button onClick={()=>{setForm(user);setEditing(false);}} className="text-xs font-medium px-3 py-2 rounded-xl border border-border hover:bg-muted transition-all">Cancel</button><button onClick={()=>{onUpdate(form);setEditing(false);}} className="text-xs font-medium px-3 py-2 rounded-xl bg-accent text-accent-foreground font-semibold hover:bg-accent/80 transition-all">Save Changes</button></div>}
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-6">
          <ProfileInfoField label="First Name" value={form.firstName} editing={editing} onChange={v=>setField("firstName",v)}/>
          <ProfileInfoField label="Last Name" value={form.lastName} editing={editing} onChange={v=>setField("lastName",v)}/>
          <ProfileInfoField label="Middle Name" value={form.middleName} editing={editing} onChange={v=>setField("middleName",v)}/>
          <ProfileInfoField label="Suffix" value={form.suffix} editing={editing} onChange={v=>setField("suffix",v)}/>
          <ProfileInfoField label="Nickname" value={form.nickname} editing={editing} onChange={v=>setField("nickname",v)}/>
          <ProfileInfoField label="Username" value={form.username} editing={editing} onChange={v=>setField("username",v)}/>
          <ProfileInfoField label="Designation" value={form.designation} editing={editing} onChange={v=>setField("designation",v)}/>
          <ProfileInfoField label="Position" value={form.position} editing={editing} onChange={v=>setField("position",v)}/>
          <ProfileInfoField label="Mobile Number" value={form.mobilePhone} editing={editing} onChange={v=>setField("mobilePhone",v)}/>
          <div className="col-span-2"><ProfileInfoField label="Email Address" value={form.email} editing={editing} onChange={v=>setField("email",v)}/></div>
        </div>
      </div>
      {showCamera && <Modal title="Take Profile Photo" onClose={closeCamera}><div className="space-y-4"><video ref={videoRef} autoPlay playsInline className="w-full rounded-xl bg-black"/><canvas ref={canvasRef} className="hidden"/><div className="flex gap-3"><button onClick={closeCamera} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={capturePhoto} className="flex-1 py-2 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Capture Photo</button></div></div></Modal>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AUTO-GENERATE MODAL — date-grouped display, delete button, date picker
// ─────────────────────────────────────────────────────────────
function AutoGenerateModal({ monthly, onConfirm, onSkip }: { monthly: MonthlyTask; onConfirm: (mt: MonthlyTask, wt: WeeklyTask[]) => void; onSkip: (mt: MonthlyTask) => void }) {
  const [generated, setGenerated] = useState<WeeklyTask[]>(()=>smartGenerateWeeklyTasks(monthly));
  const [expandWeek, setExpandWeek] = useState<string|null>("w1");
  const [expandDaily, setExpandDaily] = useState<string|null>(null);
  const numWeeks = getWeekCount(monthly.year, monthly.month);
  const domain = detectDomain(monthly.title);

  function updateWT(id:string,title:string){setGenerated(g=>g.map(t=>t.id!==id?t:{...t,title}));}
  function updateWTDeliv(wtId:string,dId:string,val:string){setGenerated(g=>g.map(wt=>wt.id!==wtId?wt:{...wt,deliverables:wt.deliverables.map(d=>d.id===dId?{...d,title:val}:d)}));}
  function updateDT(wtId:string,dtId:string,field:"title"|"deliverable"|"date",val:string){setGenerated(g=>g.map(wt=>wt.id!==wtId?wt:{...wt,dailyTasks:wt.dailyTasks.map(dt=>dt.id!==dtId?dt:{...dt,[field]:val})}));}
  function removeDT(wtId:string,dtId:string){setGenerated(g=>g.map(wt=>wt.id!==wtId?wt:{...wt,dailyTasks:wt.dailyTasks.filter(dt=>dt.id!==dtId)}));}
  function addDT(wtId:string){const wt=generated.find(w=>w.id===wtId);if(!wt)return;const date=getWorkdays(wt.year,wt.month,wt.weekNumber)[0]??TODAY;const newDt:DailyTask={id:genId(),title:"New daily task",deliverable:"Expected output",date,status:"pending",images:[]};setGenerated(g=>g.map(w=>w.id!==wtId?w:{...w,dailyTasks:[...w.dailyTasks,newDt]}));}

  const byWeek: Record<number,WeeklyTask[]> = {};
  for(let w=1;w<=numWeeks;w++) byWeek[w]=generated.filter(t=>t.weekNumber===w);

  // Group daily tasks by date for display
  function groupByDate(dailyTasks: DailyTask[]): Record<string,DailyTask[]> {
    const grouped: Record<string,DailyTask[]> = {};
    dailyTasks.forEach(dt => { if(!grouped[dt.date])grouped[dt.date]=[]; grouped[dt.date].push(dt); });
    return grouped;
  }

  return (
    <Modal title="Generate Weekly & Daily Tasks" onClose={()=>onSkip(monthly)} extraWide>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 bg-secondary border border-accent/30 rounded-xl">
          <Sparkles size={16} className="text-accent flex-shrink-0 mt-0.5"/>
          <div><p className="text-sm font-semibold text-foreground">Smart Local Algorithm — No Internet Required</p>
          <p className="text-xs text-muted-foreground mt-0.5">Domain: <span className="font-semibold text-foreground capitalize">{domain}</span> · {numWeeks} weeks · {numWeeks*2} weekly tasks · {numWeeks*2*10} daily tasks. All editable below.</p></div>
        </div>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {Array.from({length:numWeeks},(_,i)=>i+1).map(wk => (
            <div key={wk} className="border border-border rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
                onClick={()=>setExpandWeek(expandWeek===`w${wk}`?null:`w${wk}`)}>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-accent text-accent-foreground text-xs font-bold flex items-center justify-center">{wk}</span>
                  <span className="text-sm font-semibold text-foreground">Week {wk}</span>
                  <span className="text-xs text-muted-foreground">· {(byWeek[wk]??[]).reduce((s,t)=>s+t.dailyTasks.length,0)} daily tasks</span>
                </div>
                {expandWeek===`w${wk}`?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
              </button>

              {expandWeek===`w${wk}` && (
                <div className="p-4 space-y-4 bg-card">
                  {(byWeek[wk]??[]).map((wt,wtIdx) => (
                    <div key={wt.id} className="border border-border rounded-xl overflow-hidden">
                      <div className="p-3 bg-muted/20 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground flex-shrink-0">W{wk}.{wtIdx+1}</span>
                          <input value={wt.title} onChange={e=>updateWT(wt.id,e.target.value)} className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"/>
                        </div>
                        {wt.deliverables.map(d=>(
                          <div key={d.id} className="flex items-center gap-2 ml-10">
                            <FileText size={11} className="text-muted-foreground flex-shrink-0"/>
                            <input value={d.title} onChange={e=>updateWTDeliv(wt.id,d.id,e.target.value)} placeholder="Weekly deliverable" className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-muted/50 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all text-muted-foreground"/>
                          </div>
                        ))}
                      </div>

                      {/* Daily tasks toggle */}
                      <button className="w-full flex items-center justify-between px-4 py-2 bg-muted/10 hover:bg-muted/20 border-t border-border text-xs transition-colors"
                        onClick={()=>setExpandDaily(expandDaily===wt.id?null:wt.id)}>
                        <span className="font-semibold text-muted-foreground">{wt.dailyTasks.length} Daily Tasks — grouped by date</span>
                        {expandDaily===wt.id?<ChevronUp size={12}/>:<ChevronDown size={12}/>}
                      </button>

                      {expandDaily===wt.id && (
                        <div className="bg-card p-3 space-y-3">
                          {/* Group by date */}
                          {Object.entries(groupByDate(wt.dailyTasks))
                            .sort(([a],[b])=>a.localeCompare(b))
                            .map(([date,dts]) => (
                              <div key={date} className="border border-border rounded-xl overflow-hidden">
                                {/* Date header */}
                                <div className="px-3 py-2 bg-primary/8 border-b border-border flex items-center justify-between" style={{background:"rgba(26,43,74,0.06)"}}>
                                  <div>
                                    <p className="text-xs font-bold text-primary">{formatDateWithDay(date)}</p>
                                    <p className="text-[10px] text-muted-foreground">{dts.length} task{dts.length!==1?"s":""} assigned to this date</p>
                                  </div>
                                </div>
                                {/* Tasks in this date */}
                                <div className="divide-y divide-border/50">
                                  {dts.map((dt,dtIdx)=>(
                                    <div key={dt.id} className="px-3 py-3 space-y-2 hover:bg-muted/10">
                                      {/* Task row */}
                                      <div className="flex items-start gap-2">
                                        <span className="text-[10px] font-mono text-muted-foreground/60 flex-shrink-0 mt-1.5">#{dtIdx+1}</span>
                                        <div className="flex-1 space-y-1.5">
                                          <input value={dt.title} onChange={e=>updateDT(wt.id,dt.id,"title",e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"/>
                                          <div className="flex items-center gap-2">
                                            <FileText size={10} className="text-muted-foreground flex-shrink-0"/>
                                            <input value={dt.deliverable} onChange={e=>updateDT(wt.id,dt.id,"deliverable",e.target.value)} placeholder="Expected deliverable" className="flex-1 px-2.5 py-1 rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"/>
                                          </div>
                                          {/* Date reassignment */}
                                          <div className="flex items-center gap-2">
                                            <CalendarIcon size={10} className="text-muted-foreground flex-shrink-0"/>
                                            <span className="text-[10px] text-muted-foreground">Assign to date:</span>
                                            <input type="date" value={dt.date} onChange={e=>updateDT(wt.id,dt.id,"date",e.target.value)} className="px-2 py-1 rounded-lg border border-border bg-input-background text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"/>
                                          </div>
                                        </div>
                                        <button onClick={()=>removeDT(wt.id,dt.id)} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors flex-shrink-0"><Trash2 size={13}/></button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          {/* Add daily task button */}
                          <button onClick={()=>addDT(wt.id)} className="w-full py-2 rounded-xl border border-dashed border-accent/50 text-accent text-xs font-semibold hover:bg-secondary transition-all flex items-center justify-center gap-1.5">
                            <Plus size={12}/> Add Daily Task
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={()=>onSkip(monthly)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Skip for Now</button>
          <button onClick={()=>onConfirm(monthly,generated)} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Confirm &amp; Apply All Tasks</button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// ADD WEEKLY TASK MODAL
// ─────────────────────────────────────────────────────────────
function AddWeeklyTaskModal({ monthly, onAdd, onClose }: { monthly: MonthlyTask; onAdd: (wt: WeeklyTask) => void; onClose: () => void }) {
  const now = new Date();
  const firstDay = getFirstDay(now.getFullYear(), now.getMonth());
  const currentWeek = Math.ceil((now.getDate() + firstDay) / 7);
  const numWeeks = getWeekCount(monthly.year, monthly.month);
  const [title, setTitle] = useState(""); const [deliverable, setDeliverable] = useState(""); const [weekNum, setWeekNum] = useState(currentWeek.toString());
  function handleAdd() {
    if (!title.trim()) return;
    const wk = parseInt(weekNum)||1;
    const wt: WeeklyTask = { id:genId(), title:title.trim(), deliverables:[{id:genId(),title:deliverable.trim()||"Deliverable",status:"pending"}], weekNumber:wk, month:monthly.month, year:monthly.year, dailyTasks:[], status:"pending" };
    onAdd(wt); onClose();
  }
  return (
    <Modal title="Add Weekly Task" onClose={onClose}>
      <div className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Weekly Task Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Network Scan Phase 2" className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/></div>
        <div><label className="block text-sm font-medium mb-1">Deliverable</label><input value={deliverable} onChange={e=>setDeliverable(e.target.value)} placeholder="Expected weekly output" className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/></div>
        <div><label className="block text-sm font-medium mb-1">Week Number</label>
          <select value={weekNum} onChange={e=>setWeekNum(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all">
            {Array.from({length:numWeeks},(_,i)=>i+1).map(w=><option key={w} value={w}>Week {w}</option>)}
          </select>
        </div>
        <div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={handleAdd} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Add Weekly Task</button></div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// ADD DAILY TASK MODAL
// ─────────────────────────────────────────────────────────────
function AddDailyTaskModal({ weekly, onAdd, onClose }: { weekly: WeeklyTask; onAdd: (dt: DailyTask) => void; onClose: () => void }) {
  const workdays = getWorkdays(weekly.year, weekly.month, weekly.weekNumber);
  const [title, setTitle] = useState(""); const [deliverable, setDeliverable] = useState(""); const [date, setDate] = useState(workdays[0]??TODAY);
  function handleAdd() {
    if (!title.trim()) return;
    const dt: DailyTask = { id:genId(), title:title.trim(), deliverable:deliverable.trim()||"Expected output", date, status:"pending", images:[] };
    onAdd(dt); onClose();
  }
  return (
    <Modal title="Add Daily Task" onClose={onClose}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-secondary/60 border border-accent/20 text-xs text-foreground/80"><span className="font-semibold">Weekly Task:</span> {cleanTitle(weekly.title)}</div>
        <div><label className="block text-sm font-medium mb-1">Daily Task Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., Review firewall configurations" className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/></div>
        <div><label className="block text-sm font-medium mb-1">Deliverable</label><input value={deliverable} onChange={e=>setDeliverable(e.target.value)} placeholder="Expected daily output" className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/></div>
        <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/></div>
        <div className="flex gap-3"><button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={handleAdd} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Add Daily Task</button></div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// MY TASKS PAGE
// ─────────────────────────────────────────────────────────────
function MyTasksPage({ tasks, onUpdateTasks }: { tasks: MonthlyTask[]; onUpdateTasks: (t: MonthlyTask[]) => void }) {
  const now = new Date();
  const [showAddMonthly, setShowAddMonthly] = useState(false);
  const [showAutoModal, setShowAutoModal] = useState<MonthlyTask|null>(null);
  const [addWeeklyFor, setAddWeeklyFor] = useState<MonthlyTask|null>(null);
  const [addDailyFor, setAddDailyFor] = useState<{mt:MonthlyTask;wt:WeeklyTask}|null>(null);
  const [expandedMT, setExpandedMT] = useState<string|null>(null);
  const [expandedWT, setExpandedWT] = useState<string|null>(null);
  const [newMTTitle, setNewMTTitle] = useState(""); const [newMTDelivs, setNewMTDelivs] = useState([""]);

  const currentMT = tasks.filter(t=>t.month===now.getMonth()&&t.year===now.getFullYear());
  const firstDay = getFirstDay(now.getFullYear(),now.getMonth());
  const currentWeekNum = Math.ceil((now.getDate()+firstDay)/7);
  const thisWeekTasks = currentMT.flatMap(mt=>mt.weeklyTasks.filter(wt=>wt.weekNumber===currentWeekNum));
  const todayDaily = currentMT.flatMap(mt=>mt.weeklyTasks.flatMap(wt=>wt.dailyTasks.filter(dt=>dt.date===TODAY)));

  function addMonthlyTask() {
    if(!newMTTitle.trim())return;
    const mt:MonthlyTask={id:genId(),title:newMTTitle.trim(),deliverables:newMTDelivs.filter(d=>d.trim()).map(d=>({id:genId(),title:d.trim(),status:"pending"})),month:now.getMonth(),year:now.getFullYear(),status:"pending",weeklyTasks:[]};
    setShowAddMonthly(false);setNewMTTitle("");setNewMTDelivs([""]);setShowAutoModal(mt);
  }
  function toggleDeliverable(mtId:string,dId:string){onUpdateTasks(tasks.map(mt=>mt.id!==mtId?mt:{...mt,deliverables:mt.deliverables.map(d=>d.id===dId?{...d,status:d.status==="done"?"pending" as const:"done" as const}:d)}));}
  function addWeeklyTask(wt:WeeklyTask){if(!addWeeklyFor)return;onUpdateTasks(tasks.map(mt=>mt.id!==addWeeklyFor.id?mt:{...mt,weeklyTasks:[...mt.weeklyTasks,wt]}));setAddWeeklyFor(null);}
  function addDailyTask(dt:DailyTask){if(!addDailyFor)return;onUpdateTasks(tasks.map(mt=>mt.id!==addDailyFor.mt.id?mt:{...mt,weeklyTasks:mt.weeklyTasks.map(wt=>wt.id!==addDailyFor.wt.id?wt:{...wt,dailyTasks:[...wt.dailyTasks,dt]})}));setAddDailyFor(null);}

  const SH=({color,label}:{color:string;label:string})=><h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2"><span className={`w-1.5 h-4 ${color} rounded-full`}/>{label}</h2>;

  return (
    <div className="space-y-7">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">My Tasks</h1>
        <button onClick={()=>setShowAddMonthly(true)} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent/80 transition-all"><Plus size={15}/> Add Monthly Task</button>
      </div>

      <section>
        <SH color="bg-accent" label={`Monthly Tasks — ${MONTHS[now.getMonth()]} ${now.getFullYear()}`}/>
        <div className="space-y-3">
          {currentMT.length===0&&<div className="bg-card border-2 border-dashed border-border rounded-2xl py-8 text-center text-muted-foreground text-sm">No monthly tasks. Click <strong>Add Monthly Task</strong> to begin.</div>}
          {currentMT.map(mt=>(
            <div key={mt.id} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors" onClick={()=>setExpandedMT(expandedMT===mt.id?null:mt.id)}>
                <div className="flex items-center gap-3 text-left min-w-0">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-secondary flex items-center justify-center"><FileText size={15} className="text-accent"/></div>
                  <div className="min-w-0"><p className="text-sm font-semibold text-foreground truncate">{mt.title}</p><p className="text-xs text-muted-foreground">{mt.deliverables.length} deliverables · {mt.weeklyTasks.length} weekly tasks</p></div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3"><StatusBadge status={mt.status}/>{expandedMT===mt.id?<ChevronUp size={14} className="text-muted-foreground"/>:<ChevronDown size={14} className="text-muted-foreground"/>}</div>
              </button>
              {expandedMT===mt.id&&(
                <div className="border-t border-border px-5 py-4 space-y-4 bg-muted/10">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deliverables</p>
                  {mt.deliverables.map(d=>(
                    <div key={d.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card">
                      <button onClick={()=>toggleDeliverable(mt.id,d.id)} className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${d.status==="done"?"bg-green-500 text-white":"border-2 border-border hover:border-accent"}`}>{d.status==="done"&&<Check size={11}/>}</button>
                      <span className={`text-sm flex-1 ${d.status==="done"?"line-through text-muted-foreground":""}`}>{d.title}</span>
                      <StatusBadge status={d.status}/>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 flex-wrap">
                    {mt.weeklyTasks.length===0&&<button onClick={()=>setShowAutoModal({...mt,weeklyTasks:[]})} className="text-xs text-accent font-semibold hover:underline flex items-center gap-1"><Sparkles size={11}/> Generate weekly &amp; daily tasks</button>}
                    <button onClick={()=>setAddWeeklyFor(mt)} className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline"><Plus size={11}/> Add Weekly Task</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <SH color="bg-primary" label={`This Week's Tasks — Week ${currentWeekNum}`}/>
        <div className="space-y-3">
          {thisWeekTasks.length===0&&<div className="bg-card border border-dashed border-border rounded-2xl py-6 text-center text-muted-foreground text-sm">No weekly tasks for this week.</div>}
          {thisWeekTasks.map(wt=>{
            const mt=currentMT.find(m=>m.weeklyTasks.some(w=>w.id===wt.id));
            return(
              <div key={wt.id} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                <button className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/20 transition-colors" onClick={()=>setExpandedWT(expandedWT===wt.id?null:wt.id)}>
                  <div className="flex items-center gap-3 text-left min-w-0">
                    <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-secondary flex items-center justify-center"><CheckSquare size={13} className="text-accent"/></div>
                    <div className="min-w-0"><p className="text-sm font-semibold text-foreground truncate">{cleanTitle(wt.title)}</p><p className="text-xs text-muted-foreground">{wt.dailyTasks.length} daily tasks</p></div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3"><StatusBadge status={wt.status}/>{expandedWT===wt.id?<ChevronUp size={14} className="text-muted-foreground"/>:<ChevronDown size={14} className="text-muted-foreground"/>}</div>
                </button>
                {expandedWT===wt.id&&(
                  <div className="border-t border-border px-5 py-4 bg-muted/10">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Deliverables</p>
                    {wt.deliverables.map(d=><div key={d.id} className="flex items-center gap-2 text-sm mb-2 p-2 rounded-lg border border-border bg-card"><FileText size={12} className="text-accent flex-shrink-0"/><span className="text-foreground flex-1">{d.title}</span><StatusBadge status={d.status}/></div>)}
                    {wt.dailyTasks.length>0&&(
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Daily Tasks ({wt.dailyTasks.length})</p>
                        <div className="space-y-1.5">
                          {wt.dailyTasks.map(dt=>(
                            <div key={dt.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card">
                              <div className="flex-1 min-w-0"><p className="text-xs font-medium text-foreground truncate">{cleanTitle(dt.title)}</p><p className="text-xs text-muted-foreground truncate">{dt.deliverable} · {formatDisplay(dt.date)}</p></div>
                              <StatusBadge status={dt.status}/>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {mt&&<button onClick={()=>setAddDailyFor({mt,wt})} className="mt-3 flex items-center gap-1 text-xs text-primary font-semibold hover:underline"><Plus size={11}/> Add Daily Task</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SH color="bg-green-500" label={`Today's Daily Tasks — ${formatDisplay(TODAY)}`}/>
        <div className="space-y-2">
          {todayDaily.length===0&&<div className="bg-card border border-dashed border-border rounded-2xl py-6 text-center text-muted-foreground text-sm">No daily tasks for today.</div>}
          {todayDaily.map(dt=>(
            <div key={dt.id} className="bg-card rounded-xl border border-border shadow-sm p-4 flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-semibold text-foreground truncate">{cleanTitle(dt.title)}</p><p className="text-xs text-muted-foreground truncate"><span className="font-medium">Deliverable:</span> {dt.deliverable}</p></div>
              <StatusBadge status={dt.status}/>
            </div>
          ))}
        </div>
      </section>

      {showAddMonthly&&<Modal title="Add Monthly Task" onClose={()=>setShowAddMonthly(false)}><div className="space-y-4"><FormField label="Task Title" value={newMTTitle} onChange={setNewMTTitle} placeholder="e.g., Q3 System Maintenance Program"/><div><label className="block text-sm font-medium mb-1.5">Deliverables</label>{newMTDelivs.map((d,i)=><div key={i} className="flex gap-2 mb-2"><input value={d} onChange={e=>{const n=[...newMTDelivs];n[i]=e.target.value;setNewMTDelivs(n);}} placeholder={`Deliverable ${i+1}`} className="flex-1 px-3.5 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"/>{newMTDelivs.length>1&&<button onClick={()=>setNewMTDelivs(newMTDelivs.filter((_,j)=>j!==i))} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={14}/></button>}</div>)}<button onClick={()=>setNewMTDelivs([...newMTDelivs,""])} className="text-xs text-accent font-semibold hover:underline">+ Add Deliverable</button></div><div className="flex gap-3 pt-1"><button onClick={()=>setShowAddMonthly(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={addMonthlyTask} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 transition-all">Next: Generate Tasks</button></div></div></Modal>}
      {showAutoModal&&<AutoGenerateModal monthly={showAutoModal} onConfirm={(mt,wt)=>{onUpdateTasks([...tasks,{...mt,weeklyTasks:wt}]);setShowAutoModal(null);}} onSkip={mt=>{onUpdateTasks([...tasks,mt]);setShowAutoModal(null);}}/>}
      {addWeeklyFor&&<AddWeeklyTaskModal monthly={addWeeklyFor} onAdd={addWeeklyTask} onClose={()=>setAddWeeklyFor(null)}/>}
      {addDailyFor&&<AddDailyTaskModal weekly={addDailyFor.wt} onAdd={addDailyTask} onClose={()=>setAddDailyFor(null)}/>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MY ACCOMPLISHMENTS — selectable report generation
// ─────────────────────────────────────────────────────────────
function MyAccomplishmentsPage({ tasks, currentUser }: { tasks: MonthlyTask[]; currentUser: UserProfile }) {
  const now = new Date();
  const [showReport, setShowReport] = useState(false);
  const [activeTab, setActiveTab] = useState<"monthly"|"weekly"|"daily">("monthly");
  const daysInMonth = getDaysInMonth(now.getFullYear(),now.getMonth());
  const currentMT = tasks.filter(t=>t.month===now.getMonth()&&t.year===now.getFullYear());
  const finishedMonthly = currentMT.filter(t=>t.status==="finished");
  const finishedWeekly = currentMT.flatMap(mt=>mt.weeklyTasks.filter(wt=>wt.status==="finished"));
  const approvedDaily = currentMT.flatMap(mt=>mt.weeklyTasks.flatMap(wt=>wt.dailyTasks.filter(dt=>dt.status==="approved"||dt.status==="finished")));
  const tabs=[{key:"monthly" as const,label:"Monthly",count:finishedMonthly.length},{key:"weekly" as const,label:"Weekly",count:finishedWeekly.length},{key:"daily" as const,label:"Daily (Approved)",count:approvedDaily.length}];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-foreground">My Accomplishments</h1><p className="text-sm text-muted-foreground mt-0.5">{MONTHS[now.getMonth()]} {now.getFullYear()}</p></div>
        <button onClick={()=>setShowReport(true)} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all"><FileText size={14}/> Generate Report</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[{label:"Monthly Done",count:finishedMonthly.length,total:currentMT.length,tColor:"text-blue-600",bColor:"border-blue-200"},{label:"Weekly Done",count:finishedWeekly.length,total:currentMT.reduce((s,mt)=>s+mt.weeklyTasks.length,0),tColor:"text-violet-600",bColor:"border-violet-200"},{label:"Daily Approved",count:approvedDaily.length,total:currentMT.reduce((s,mt)=>s+mt.weeklyTasks.reduce((s2,wt)=>s2+wt.dailyTasks.length,0),0),tColor:"text-green-600",bColor:"border-green-200"}].map(c=>(
          <div key={c.label} className={`bg-card rounded-2xl border shadow-sm p-5 ${c.bColor}`}><p className="text-xs font-semibold text-muted-foreground mb-2">{c.label}</p><p className={`text-3xl font-bold ${c.tColor}`}>{c.count}</p><p className="text-xs text-muted-foreground mt-1">of {c.total} total</p></div>
        ))}
      </div>
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="flex border-b border-border">
          {tabs.map(tab=><button key={tab.key} onClick={()=>setActiveTab(tab.key)} className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${activeTab===tab.key?"text-primary border-b-2 border-accent bg-secondary/40":"text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}>{tab.label}<span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab===tab.key?"bg-accent text-accent-foreground":"bg-muted text-muted-foreground"}`}>{tab.count}</span></button>)}
        </div>
        <div className="p-5">
          {activeTab==="monthly"&&<div className="space-y-3">{finishedMonthly.length===0?<div className="py-8 text-center text-muted-foreground text-sm">No finished monthly tasks yet.</div>:finishedMonthly.map(mt=><div key={mt.id} className="p-4 rounded-xl border border-green-200 bg-green-50 flex items-center gap-3"><CheckCircle2 size={18} className="text-green-600 flex-shrink-0"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-foreground">{mt.title}</p><p className="text-xs text-muted-foreground">{mt.deliverables.length} deliverables</p></div><StatusBadge status="finished"/></div>)}</div>}
          {activeTab==="weekly"&&<div className="space-y-3">{finishedWeekly.length===0?<div className="py-8 text-center text-muted-foreground text-sm">No finished weekly tasks yet.</div>:finishedWeekly.map(wt=><div key={wt.id} className="p-4 rounded-xl border border-violet-200 bg-violet-50 flex items-center gap-3"><CheckCircle2 size={18} className="text-violet-600 flex-shrink-0"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-foreground">{cleanTitle(wt.title)}</p><p className="text-xs text-muted-foreground">Week {wt.weekNumber}</p></div><StatusBadge status="finished"/></div>)}</div>}
          {activeTab==="daily"&&<div className="space-y-2">{approvedDaily.length===0?<div className="py-8 text-center text-muted-foreground text-sm">No approved daily tasks yet. Submit evidence and wait for admin approval.</div>:approvedDaily.map(dt=><div key={dt.id} className="p-3.5 rounded-xl border border-green-200 bg-green-50 flex items-start gap-3"><CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5"/><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-foreground truncate">{cleanTitle(dt.title)}</p><p className="text-xs text-muted-foreground"><span className="font-medium">Deliverable:</span> {dt.deliverable}</p><p className="text-xs text-muted-foreground">{formatDisplay(dt.date)}</p></div><StatusBadge status={dt.status}/></div>)}</div>}
        </div>
      </div>
      {showReport&&<Modal title="Generate Accomplishment Report" onClose={()=>setShowReport(false)} wide><ReportModal currentUser={currentUser} approvedDaily={approvedDaily} month={now.getMonth()} year={now.getFullYear()} daysInMonth={daysInMonth} onClose={()=>setShowReport(false)}/></Modal>}
    </div>
  );
}

function ReportModal({ currentUser, approvedDaily, month, year, daysInMonth, onClose }: {
  currentUser: UserProfile; approvedDaily: DailyTask[];
  month: number; year: number; daysInMonth: number; onClose: () => void
}) {
  const [selected, setSelected] = useState<"first-half"|"second-half"|"full">("full");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  const m = String(month+1).padStart(2,"0");
  const ranges = {
    "first-half":  { start:`${year}-${m}-01`, end:`${year}-${m}-15` },
    "second-half": { start:`${year}-${m}-16`, end:`${year}-${m}-${String(daysInMonth).padStart(2,"0")}` },
    "full":        { start:`${year}-${m}-01`, end:`${year}-${m}-${String(daysInMonth).padStart(2,"0")}` },
  };
  const labels = {
    "first-half":  `1–15 ${MONTHS[month]} ${year}`,
    "second-half": `16–${daysInMonth} ${MONTHS[month]} ${year}`,
    "full":        `1–${daysInMonth} ${MONTHS[month]} ${year}`,
  };
  const filteredDaily = approvedDaily.filter(dt=>dt.date>=ranges[selected].start&&dt.date<=ranges[selected].end);

  function toggleId(id:string){setSelectedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});}
  function selectAll(){setSelectedIds(new Set(filteredDaily.map(d=>d.id)));}
  function clearAll(){setSelectedIds(new Set());}

  async function handleGenerate() {
    setGenerating(true);
    try {
      const half = selected === "first-half" ? "first" : selected === "second-half" ? "second" : "full";
      const rows: AccomplishmentReportRow[] = filteredDaily
        .filter(dt => selectedIds.has(dt.id))
        .map(dt => ({
          name: getFullName(currentUser),
          natureOfWork: cleanTitle(dt.title),
          accomplishment: `${dt.deliverable} (${formatDisplay(dt.date)})`,
        }));
      await generateAccomplishmentReport({
        staffName: getFullName(currentUser),
        staffItem: currentUser.designation,
        staffPosition: currentUser.position,
        dateRange: formatDateRange(month, year, half),
        rows,
      });
      onClose();
    } catch(err) {
      console.error("Failed to generate report:", err);
      alert("Failed to generate report. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return(
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Select the reporting period then choose which accomplishments to include. A Word (.docx) file will be downloaded.</p>
      <div className="space-y-2">
        {(["first-half","second-half","full"] as const).map(opt=>(
          <button key={opt} onClick={()=>{setSelected(opt);setSelectedIds(new Set());}} className={`w-full flex items-center gap-4 p-3.5 rounded-xl border-2 text-left transition-all ${selected===opt?"border-accent bg-secondary":"border-border hover:border-accent/40"}`}>
            <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selected===opt?"border-accent":"border-muted-foreground"}`}>{selected===opt&&<div className="w-2 h-2 rounded-full bg-accent"/>}</div>
            <div><p className="text-sm font-semibold text-foreground">{labels[opt]}</p><p className="text-xs text-muted-foreground">{approvedDaily.filter(dt=>dt.date>=ranges[opt].start&&dt.date<=ranges[opt].end).length} approved tasks in this period</p></div>
          </button>
        ))}
      </div>

      {filteredDaily.length>0&&(
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">Select accomplishments to include:</p>
            <div className="flex gap-2"><button onClick={selectAll} className="text-xs text-accent font-semibold hover:underline">Select All</button><span className="text-muted-foreground text-xs">·</span><button onClick={clearAll} className="text-xs text-muted-foreground hover:underline">Clear</button></div>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {filteredDaily.map(dt=>(
              <button key={dt.id} onClick={()=>toggleId(dt.id)} className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${selectedIds.has(dt.id)?"border-accent bg-secondary":"border-border hover:border-accent/30"}`}>
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${selectedIds.has(dt.id)?"bg-accent":"border-2 border-border"}`}>{selectedIds.has(dt.id)&&<Check size={11} className="text-accent-foreground"/>}</div>
                <div className="min-w-0"><p className="text-sm font-medium text-foreground truncate">{cleanTitle(dt.title)}</p><p className="text-xs text-muted-foreground">{dt.deliverable} · {formatDisplay(dt.date)}</p></div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">{selectedIds.size} of {filteredDaily.length} tasks selected</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button>
        <button onClick={handleGenerate} disabled={selectedIds.size===0||generating}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${selectedIds.size>0&&!generating?"bg-accent text-accent-foreground hover:bg-accent/80":"bg-muted text-muted-foreground cursor-not-allowed"}`}>
          <FileText size={14}/>
          {generating ? "Generating…" : `Download Word (${selectedIds.size})`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ADMIN NOTIFICATIONS PAGE
// ─────────────────────────────────────────────────────────────
function AdminNotificationsPage({ notifications, submissions, leaveRequests, allTasks, allUsers, onApproveSubmission, onReturnSubmission, onApproveLeave, onReturnLeave, onMarkRead, onDelete }: {
  notifications: AppNotification[]; submissions: Submission[]; leaveRequests: LeaveRequest[];
  allTasks: TasksData; allUsers: UserProfile[];
  onApproveSubmission: (subId: string, dailyId: string, userId: string) => void;
  onReturnSubmission: (subId: string, dailyId: string, userId: string, note: string) => void;
  onApproveLeave: (reqId: string) => void;
  onReturnLeave: (reqId: string, note: string) => void;
  onMarkRead: (notifId: string) => void;
  onDelete: (notifId: string) => void;
}) {
  const [selected, setSelected] = useState<AppNotification|null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [showReturnInput, setShowReturnInput] = useState(false);

  const sorted = [...notifications].sort((a,b)=>new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime());

  function openNotif(n: AppNotification) { setSelected(n); onMarkRead(n.id); setReturnNote(""); setShowReturnInput(false); }

  function handleApprove() {
    if (!selected) return;
    if (selected.type==="submission") {
      const sub = submissions.find(s=>s.id===selected.referenceId);
      if (sub) onApproveSubmission(sub.id, sub.dailyTaskId, sub.userId);
    } else {
      onApproveLeave(selected.referenceId);
    }
    setSelected(null);
  }

  function handleReturn() {
    if (!selected||!returnNote.trim()) return;
    if (selected.type==="submission") {
      const sub = submissions.find(s=>s.id===selected.referenceId);
      if (sub) onReturnSubmission(sub.id, sub.dailyTaskId, sub.userId, returnNote.trim());
    } else {
      onReturnLeave(selected.referenceId, returnNote.trim());
    }
    setSelected(null);
  }

  const getSubmission = (n: AppNotification) => submissions.find(s=>s.id===n.referenceId);
  const getLeaveRequest = (n: AppNotification) => leaveRequests.find(r=>r.id===n.referenceId);

  function getStatusForNotif(n: AppNotification): string {
    if(n.type==="submission"){const s=getSubmission(n);return s?.status??"pending";}
    const r=getLeaveRequest(n);return r?.status??"pending";
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-bold text-foreground">Notifications</h1><p className="text-sm text-muted-foreground mt-0.5">{notifications.filter(n=>!n.read).length} unread notification{notifications.filter(n=>!n.read).length!==1?"s":""}</p></div>

      {notifications.length===0&&<div className="bg-card border border-dashed border-border rounded-2xl py-16 text-center text-muted-foreground"><Bell size={32} className="mx-auto mb-2 opacity-30"/><p className="text-sm">No notifications yet</p></div>}

      <div className="space-y-2">
        {sorted.map(n => {
          const status = getStatusForNotif(n);
          const typeIcon = n.type==="submission" ? <ClipboardCheck size={16} className="text-accent"/> : <Plane size={16} className="text-purple-500"/>;
          return (
            <button key={n.id} onClick={()=>openNotif(n)}
              className={`w-full flex items-start gap-4 p-4 rounded-2xl border text-left transition-all hover:shadow-md ${!n.read?"bg-secondary border-accent/30 shadow-sm":"bg-card border-border hover:bg-muted/20"}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${n.type==="submission"?"bg-accent/15":"bg-purple-100"}`}>{typeIcon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground truncate">{n.title}</p>
                  {!n.read&&<span className="w-2 h-2 rounded-full bg-accent flex-shrink-0"/>}
                </div>
                <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatTimestamp(n.timestamp)}</p>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <StatusBadge status={status}/>
                <button onClick={e=>{e.stopPropagation();onDelete(n.id);}}
                  className="p-1 rounded-lg hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors">
                  <Trash2 size={13}/>
                </button>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selected&&(
        <Modal title={selected.title} onClose={()=>setSelected(null)} wide>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${selected.type==="submission"?"bg-accent/15":"bg-purple-100"}`}>
                {selected.type==="submission"?<ClipboardCheck size={18} className="text-accent"/>:<Plane size={18} className="text-purple-500"/>}
              </div>
              <div><p className="text-sm font-bold text-foreground">{selected.userName}</p><p className="text-xs text-muted-foreground">{formatTimestamp(selected.timestamp)}</p></div>
              <div className="ml-auto"><StatusBadge status={getStatusForNotif(selected)}/></div>
            </div>

            {selected.type==="submission"&&(()=>{
              const sub = getSubmission(selected);
              if(!sub) return null;
              return(
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2">
                    <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Task</p><p className="text-base font-semibold text-foreground">{sub.taskTitle}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Monthly Task</p><p className="text-sm text-foreground">{sub.parentTitle}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Deliverable</p><p className="text-sm text-foreground">{sub.deliverable}</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Submitted At</p><p className="text-sm font-mono text-foreground">{formatTimestamp(sub.submittedAt)}</p></div>
                  </div>
                  {sub.evidence.length>0&&(
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Evidence Submitted ({sub.evidence.length} file{sub.evidence.length>1?"s":""})</p>
                      <div className="grid grid-cols-3 gap-2">
                        {sub.evidence.map((img,i)=><img key={i} src={img} alt={`evidence-${i+1}`} className="w-full h-24 object-cover rounded-xl border border-border"/>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {selected.type==="leave_request"&&(()=>{
              const req = getLeaveRequest(selected);
              if(!req) return null;
              return(
                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2">
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Request Type</p><p className="text-base font-semibold text-foreground capitalize">{req.type==="pass_slip"?"Pass Slip":req.type==="cto"?"Compensatory Time-off (CTO)":"Leave"}</p></div>
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</p><p className="text-sm text-foreground">{formatDateWithDay(req.date)}</p></div>
                  {req.type==="pass_slip"&&<div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Time Range</p><p className="text-sm font-mono text-foreground">{req.timeFrom} – {req.timeTo}</p></div>}
                  {req.reason&&<div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reason</p><p className="text-sm text-foreground">{req.reason}</p></div>}
                  <div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Submitted</p><p className="text-sm font-mono text-foreground">{formatTimestamp(req.submittedAt)}</p></div>
                </div>
              );
            })()}

            {getStatusForNotif(selected)==="pending"&&(
              <div className="space-y-3 border-t border-border pt-3">
                {showReturnInput?(
                  <div className="space-y-2">
                    <textarea value={returnNote} onChange={e=>setReturnNote(e.target.value)} rows={3} placeholder="Reason for returning (required)..." className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all resize-none"/>
                    <div className="flex gap-2"><button onClick={()=>setShowReturnInput(false)} className="flex-1 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-all">Cancel</button><button onClick={handleReturn} disabled={!returnNote.trim()} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${returnNote.trim()?"bg-red-500 text-white hover:bg-red-600":"bg-muted text-muted-foreground cursor-not-allowed"}`}>Confirm Return</button></div>
                  </div>
                ):(
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={()=>setShowReturnInput(true)} className="py-2.5 rounded-xl border-2 border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-all flex items-center justify-center gap-2"><RotateCcw size={14}/> Return</button>
                    <button onClick={handleApprove} className="py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 transition-all flex items-center justify-center gap-2"><Check size={14}/> Approve</button>
                  </div>
                )}
              </div>
            )}
            {getStatusForNotif(selected)!=="pending"&&<div className={`p-3 rounded-xl border text-sm font-medium text-center ${getStatusForNotif(selected)==="approved"?"border-green-200 bg-green-50 text-green-700":"border-red-200 bg-red-50 text-red-700"}`}>{getStatusForNotif(selected)==="approved"?"✓ Approved":"✗ Returned"}</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// STAFF NOTIFICATIONS PAGE
// Shows only approved/returned deliverable notifications for the
// currently signed-in staff member, with delete option.
// ─────────────────────────────────────────────────────────────
function StaffNotificationsPage({ userId, notifications, submissions, onMarkRead, onDelete }: {
  userId: string;
  notifications: AppNotification[];
  submissions: Submission[];
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // Staff only see notifications about their own submissions being approved/returned
  const myNotifs = notifications
    .filter(n => n.type === "submission" && n.userId === userId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  function getStatus(n: AppNotification): string {
    const sub = submissions.find(s => s.id === n.referenceId);
    return sub?.status ?? "pending";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">My Notifications</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{myNotifs.filter(n=>!n.read).length} unread</p>
      </div>

      {myNotifs.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-2xl py-16 text-center text-muted-foreground">
          <Bell size={32} className="mx-auto mb-2 opacity-30"/>
          <p className="text-sm">No notifications yet. Submit a deliverable to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {myNotifs.map(n => {
          const status = getStatus(n);
          const isApproved = status === "approved";
          const isReturned = status === "returned";
          const sub = submissions.find(s => s.id === n.referenceId);
          return (
            <div key={n.id} onClick={() => onMarkRead(n.id)}
              className={`relative bg-card rounded-2xl border p-4 transition-all ${!n.read ? "border-accent/40 bg-secondary/30 shadow-sm" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isApproved ? "bg-green-100" : isReturned ? "bg-red-100" : "bg-blue-100"}`}>
                  {isApproved ? <CheckCircle2 size={18} className="text-green-600"/> : isReturned ? <RotateCcw size={18} className="text-red-500"/> : <Clock size={18} className="text-blue-500"/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground truncate">{sub?.taskTitle ?? n.title}</p>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0"/>}
                  </div>
                  <p className="text-xs text-muted-foreground">{sub?.parentTitle}</p>
                  {isReturned && sub?.adminNote && <p className="text-xs text-red-600 mt-1 font-medium">Note: {sub.adminNote}</p>}
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">{formatTimestamp(n.timestamp)}</p>
                    <StatusBadge status={status}/>
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); onDelete(n.id); }}
                  className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-muted-foreground transition-colors flex-shrink-0 ml-1">
                  <Trash2 size={14}/>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HISTORY PAGE (Admin only)
// Full record of all approved and returned deliverables,
// organised by staff member, with PDF download.
// ─────────────────────────────────────────────────────────────
function HistoryPage({ submissions, allUsers }: { submissions: Submission[]; allUsers: UserProfile[] }) {
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all"|"approved"|"returned">("all");

  const staff = allUsers.filter(u => !u.isAdmin);
  const resolved = submissions.filter(s => s.status === "approved" || s.status === "returned");

  const filtered = resolved.filter(s => {
    const matchUser = selectedUser === "all" || s.userId === selectedUser;
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchUser && matchStatus;
  }).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  // Group by userId
  const byUser: Record<string, Submission[]> = {};
  filtered.forEach(s => {
    if (!byUser[s.userId]) byUser[s.userId] = [];
    byUser[s.userId].push(s);
  });

  async function downloadPDF() {
    const usersToShow = selectedUser === "all"
      ? Object.keys(byUser)
      : [selectedUser];

    for (const uid of usersToShow) {
      const u = allUsers.find(x => x.id === uid);
      const subs = byUser[uid] ?? [];
      if (!subs.length) continue;

      const rows: HistoryRow[] = subs.map(s => ({
        accomplishment: `[${s.status.toUpperCase()}] ${s.taskTitle} — ${s.deliverable}${s.adminNote ? ` (Note: ${s.adminNote})` : ""}`,
        date: formatTimestamp(s.submittedAt),
      }));

      await generateAccomplishmentHistory({
        staffName: u ? getFullName(u) : uid,
        rows,
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Deliverable History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All approved and returned submissions by staff</p>
        </div>
        <button onClick={downloadPDF}
          className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all">
          <FileText size={14}/> Download Word (.docx)
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}
          className="px-3.5 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all">
          <option value="all">All Staff</option>
          {staff.map(u => <option key={u.id} value={u.id}>{getFullName(u)}</option>)}
        </select>
        <div className="flex rounded-xl border border-border overflow-hidden bg-card">
          {(["all","approved","returned"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3.5 py-2 text-sm font-medium capitalize transition-colors ${statusFilter===f ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground">{filtered.length} record{filtered.length!==1?"s":""} found</p>

      {filtered.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-2xl py-16 text-center text-muted-foreground">
          <ClipboardCheck size={32} className="mx-auto mb-2 opacity-30"/>
          <p className="text-sm">No records found for the selected filters.</p>
        </div>
      )}

      {/* Grouped by staff */}
      <div className="space-y-5">
        {Object.entries(byUser).map(([uid, subs]) => {
          const u = allUsers.find(x => x.id === uid);
          return (
            <div key={uid} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              {/* Staff header */}
              <div className="flex items-center gap-3 px-5 py-4 bg-primary/5 border-b border-border">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-primary flex items-center justify-center flex-shrink-0">
                  {u?.profilePicture
                    ? <img src={u.profilePicture} alt="" className="w-full h-full object-cover"/>
                    : <span className="text-white text-sm font-bold">{u?.firstName.charAt(0)}{u?.lastName.charAt(0)}</span>}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{u ? getFullName(u) : uid}</p>
                  <p className="text-xs text-muted-foreground">{u?.position} · {subs.length} record{subs.length!==1?"s":""}</p>
                </div>
                <div className="ml-auto flex gap-2">
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">{subs.filter(s=>s.status==="approved").length} approved</span>
                  {subs.some(s=>s.status==="returned") && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">{subs.filter(s=>s.status==="returned").length} returned</span>}
                </div>
              </div>

              {/* Submission rows */}
              <div className="divide-y divide-border/60">
                {subs.map((s, i) => (
                  <div key={s.id} className={`px-5 py-3.5 flex items-start gap-3 ${i%2===0?"bg-white":"bg-muted/10"}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${s.status==="approved"?"bg-green-100":"bg-red-100"}`}>
                      {s.status==="approved"
                        ? <CheckCircle2 size={14} className="text-green-600"/>
                        : <RotateCcw size={14} className="text-red-500"/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{s.taskTitle}</p>
                      <p className="text-xs text-muted-foreground">{s.parentTitle} · {s.deliverable}</p>
                      {s.adminNote && <p className="text-xs text-red-600 mt-0.5">Note: {s.adminNote}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">{formatTimestamp(s.submittedAt)}</p>
                    </div>
                    <StatusBadge status={s.status}/>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MONITORING PAGE — with leave history
// ─────────────────────────────────────────────────────────────
function MonitoringPage({ users, allTasks, leaveRequests }: { users: UserProfile[]; allTasks: TasksData; leaveRequests: LeaveRequest[] }) {
  const [expandedUser, setExpandedUser] = useState<string|null>(null);
  const [activeTab, setActiveTab] = useState<Record<string,"tasks"|"leaves">>({});
  const staff = users.filter(u=>!u.isAdmin);
  function getTodayTasks(uid:string){return (allTasks[uid]??[]).flatMap(mt=>mt.weeklyTasks.flatMap(wt=>wt.dailyTasks.filter(dt=>dt.date===TODAY).map(dt=>({dt,mtTitle:mt.title}))));}
  function getProgress(uid:string){const all=(allTasks[uid]??[]).flatMap(mt=>mt.weeklyTasks.flatMap(wt=>wt.dailyTasks));const done=all.filter(dt=>dt.status==="approved"||dt.status==="finished").length;return{total:all.length,done,pct:all.length>0?Math.round((done/all.length)*100):0};}
  function getTabFor(uid:string): "tasks"|"leaves" { return activeTab[uid]??"tasks"; }
  function setTabFor(uid:string, tab:"tasks"|"leaves") { setActiveTab(p=>({...p,[uid]:tab})); }
  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-bold text-foreground">LITM Tasks Monitoring</h1><p className="text-sm text-muted-foreground mt-0.5">Monitor task progress of all division staff</p></div>
      <div className="grid grid-cols-3 gap-4">
        {[{label:"Total Staff",value:staff.length,cls:"text-blue-600 border-blue-100 bg-blue-50"},{label:"Active Today",value:staff.filter(u=>getTodayTasks(u.id).length>0).length,cls:"text-amber-600 border-amber-100 bg-amber-50"},{label:"Approved Today",value:staff.reduce((s,u)=>s+getTodayTasks(u.id).filter(t=>t.dt.status==="approved").length,0),cls:"text-green-600 border-green-100 bg-green-50"}].map(c=>(
          <div key={c.label} className={`bg-card rounded-2xl border shadow-sm p-5 ${c.cls.split(" ").slice(1).join(" ")}`}><p className="text-2xl font-bold text-foreground">{c.value}</p><p className="text-xs text-muted-foreground font-medium mt-0.5">{c.label}</p></div>
        ))}
      </div>
      <div className="space-y-3">
        {staff.map(u=>{
          const todayTasks=getTodayTasks(u.id); const prog=getProgress(u.id); const isExpanded=expandedUser===u.id;
          const userLeave=leaveRequests.filter(r=>r.userId===u.id);
          const tab=getTabFor(u.id);
          return(
            <div key={u.id} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <button className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors text-left" onClick={()=>setExpandedUser(isExpanded?null:u.id)}>
                <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-primary flex items-center justify-center">{u.profilePicture?<img src={u.profilePicture} alt="" className="w-full h-full object-cover"/>:<span className="text-white text-sm font-bold">{u.firstName.charAt(0)}{u.lastName.charAt(0)}</span>}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{getFullName(u)}</p>
                  <p className="text-xs text-muted-foreground">{u.designation} · {u.position}</p>
                  <div className="flex items-center gap-2 mt-1.5"><div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${prog.pct>=80?"bg-green-500":prog.pct>=50?"bg-amber-400":"bg-accent/70"}`} style={{width:`${prog.pct}%`}}/></div><span className="text-xs font-mono text-muted-foreground">{prog.pct}%</span></div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0"><div className="text-right"><p className="text-xs text-muted-foreground">Today</p><p className="text-sm font-semibold">{todayTasks.length} task{todayTasks.length!==1?"s":""}</p></div>{isExpanded?<ChevronUp size={15} className="text-muted-foreground"/>:<ChevronDown size={15} className="text-muted-foreground"/>}</div>
              </button>

              {isExpanded&&(
                <div className="border-t border-border bg-muted/10">
                  {/* Tabs */}
                  <div className="flex border-b border-border">
                    <button onClick={()=>setTabFor(u.id,"tasks")} className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab==="tasks"?"text-primary border-b-2 border-accent bg-secondary/30":"text-muted-foreground hover:text-foreground"}`}>Today's Tasks</button>
                    <button onClick={()=>setTabFor(u.id,"leaves")} className={`flex-1 py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${tab==="leaves"?"text-primary border-b-2 border-accent bg-secondary/30":"text-muted-foreground hover:text-foreground"}`}>
                      Leave Requests {userLeave.length>0&&<span className="bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{userLeave.length}</span>}
                    </button>
                  </div>

                  <div className="px-5 py-4">
                    {tab==="tasks"&&(
                      <div>
                        {todayTasks.length===0?<p className="text-sm text-muted-foreground py-2">No tasks today.</p>:(
                          <div className="space-y-2">
                            {todayTasks.map(({dt,mtTitle})=>(
                              <div key={dt.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{cleanTitle(dt.title)}</p><p className="text-xs text-muted-foreground truncate">{mtTitle} · {dt.deliverable}</p></div>
                                <StatusBadge status={dt.status}/>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-3 text-center">
                          {(()=>{const mTasks=allTasks[u.id]??[];const now=new Date();const monthly=mTasks.filter(mt=>mt.month===now.getMonth());const weekly=monthly.flatMap(mt=>mt.weeklyTasks);const daily=weekly.flatMap(wt=>wt.dailyTasks);return[{label:"Monthly",total:monthly.length,done:monthly.filter(t=>t.status==="finished").length},{label:"Weekly",total:weekly.length,done:weekly.filter(t=>t.status==="finished").length},{label:"Daily",total:daily.length,done:daily.filter(t=>t.status==="approved"||t.status==="finished").length}].map(s=><div key={s.label} className="bg-card border border-border rounded-xl p-3"><p className="text-lg font-bold">{s.done}/{s.total}</p><p className="text-xs text-muted-foreground">{s.label}</p></div>);})()}
                        </div>
                      </div>
                    )}

                    {tab==="leaves"&&(
                      <div>
                        {userLeave.length===0?<p className="text-sm text-muted-foreground py-2">No leave requests.</p>:(
                          <div className="space-y-2">
                            {[...userLeave].sort((a,b)=>new Date(b.submittedAt).getTime()-new Date(a.submittedAt).getTime()).map(r=>(
                              <div key={r.id} className="p-3 rounded-xl bg-card border border-border">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-semibold text-foreground capitalize">{r.type==="pass_slip"?"Pass Slip":r.type==="cto"?"CTO":"Leave"}</span>
                                  <StatusBadge status={r.status}/>
                                </div>
                                <p className="text-xs text-muted-foreground">{formatDateWithDay(r.date)}</p>
                                {r.type==="pass_slip"&&<p className="text-xs text-muted-foreground">Time: {r.timeFrom} – {r.timeTo}</p>}
                                {r.reason&&<p className="text-xs text-muted-foreground">Reason: {r.reason}</p>}
                                <p className="text-xs text-muted-foreground">Submitted: {formatTimestamp(r.submittedAt)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SUPABASE SYNC HELPERS
// ─────────────────────────────────────────────────────────────

/** Converts a UserProfile to a Supabase row object (snake_case columns). */
function userToRow(u: UserProfile): Record<string, unknown> {
  return {
    id: u.id, username: u.username, last_name: u.lastName, first_name: u.firstName,
    middle_name: u.middleName, suffix: u.suffix, nickname: u.nickname,
    designation: u.designation, position: u.position, mobile_phone: u.mobilePhone,
    email: u.email, password: u.password, is_admin: u.isAdmin,
    profile_picture: u.profilePicture,
  };
}

/** Converts a Supabase row back to a UserProfile. */
function rowToUser(r: Record<string, unknown>): UserProfile {
  return {
    id: String(r.id), username: String(r.username), lastName: String(r.last_name),
    firstName: String(r.first_name), middleName: String(r.middle_name),
    suffix: String(r.suffix ?? ""), nickname: String(r.nickname),
    designation: String(r.designation), position: String(r.position),
    mobilePhone: String(r.mobile_phone), email: String(r.email), password: String(r.password),
    isAdmin: Boolean(r.is_admin), profilePicture: String(r.profile_picture ?? ""),
  };
}

/** Converts a Supabase notification row back to AppNotification. */
function rowToNotif(r: Record<string, unknown>): AppNotification {
  return {
    id: String(r.id), type: r.type as NotifType, userId: String(r.user_id),
    userName: String(r.user_name), title: String(r.title), message: String(r.message),
    timestamp: String(r.timestamp), read: Boolean(r.read), referenceId: String(r.reference_id),
  };
}

/** Converts a Supabase submission row back to Submission. */
function rowToSubmission(r: Record<string, unknown>): Submission {
  return {
    id: String(r.id), userId: String(r.user_id), userName: String(r.user_name),
    dailyTaskId: String(r.daily_task_id), weeklyTaskId: String(r.weekly_task_id),
    monthlyTaskId: String(r.monthly_task_id), taskTitle: String(r.task_title),
    deliverable: String(r.deliverable), parentTitle: String(r.parent_title),
    evidence: (r.evidence as string[]) ?? [], submittedAt: String(r.submitted_at),
    status: r.status as Submission["status"], adminNote: r.admin_note as string | undefined,
  };
}

/** Converts a Supabase leave request row back to LeaveRequest. */
function rowToLeaveRequest(r: Record<string, unknown>): LeaveRequest {
  return {
    id: String(r.id), userId: String(r.user_id), userName: String(r.user_name),
    type: r.type as LeaveType, date: String(r.date),
    timeFrom: r.time_from as string | undefined, timeTo: r.time_to as string | undefined,
    reason: r.reason as string | undefined, submittedAt: String(r.submitted_at),
    status: r.status as LeaveRequest["status"], adminNote: r.admin_note as string | undefined,
  };
}

function notifToRow(n: AppNotification): Record<string, unknown> {
  return {
    id: n.id, type: n.type, user_id: n.userId, user_name: n.userName,
    title: n.title, message: n.message, timestamp: n.timestamp,
    read: n.read, reference_id: n.referenceId,
  };
}

function submissionToRow(s: Submission): Record<string, unknown> {
  return {
    id: s.id, user_id: s.userId, user_name: s.userName, daily_task_id: s.dailyTaskId,
    weekly_task_id: s.weeklyTaskId, monthly_task_id: s.monthlyTaskId,
    task_title: s.taskTitle, deliverable: s.deliverable, parent_title: s.parentTitle,
    evidence: s.evidence, submitted_at: s.submittedAt, status: s.status,
    admin_note: s.adminNote ?? null,
  };
}

function leaveToRow(r: LeaveRequest): Record<string, unknown> {
  return {
    id: r.id, user_id: r.userId, user_name: r.userName, type: r.type, date: r.date,
    time_from: r.timeFrom ?? null, time_to: r.timeTo ?? null, reason: r.reason ?? null,
    submitted_at: r.submittedAt, status: r.status, admin_note: r.adminNote ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [authPage, setAuthPage] = useState<"signin"|"register">("signin");
  const [currentUser, setCurrentUser] = useState<UserProfile|null>(() => {
    try {
      const saved = localStorage.getItem("litm_current_user");
      return saved ? JSON.parse(saved) as UserProfile : null;
    } catch { return null; }
  });
  const [page, setPage] = useState<Page>("home");
  const [users, setUsers] = useState<UserProfile[]>(INITIAL_USERS);
  const [allTasks, setAllTasks] = useState<TasksData>(buildSeedTasks);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const unreadCount = notifications.filter(n =>
    !n.read && (
      currentUser?.isAdmin
        ? true
        : n.type === "submission" && n.userId === currentUser?.id
    )
  ).length;

  // ── Load users + restore task statuses from Supabase on mount ─
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      try {
        const [dbUsers, dbSubs, dbNotifs, dbLeave] = await Promise.all([
          getAll<Record<string,unknown>>(TABLES.USERS),
          getAll<Record<string,unknown>>(TABLES.SUBMISSIONS).catch(() => []),
          getAll<Record<string,unknown>>(TABLES.NOTIFICATIONS).catch(() => []),
          getAll<Record<string,unknown>>(TABLES.LEAVE_REQUESTS).catch(() => []),
        ]);
        if (cancelled) return;

        // Users
        if (dbUsers.length > 0) {
          setUsers(dbUsers.map(rowToUser));
        } else {
          for (const u of INITIAL_USERS) {
            await insertRecord(TABLES.USERS, userToRow(u));
          }
        }

        // Restore submission + notification + leave state
        if (dbSubs.length) {
          const synced = dbSubs.map(rowToSubmission);
          setSubmissions(synced);

          // Build dailyTaskId → latest status map and apply into allTasks
          const statusByDailyId = new Map<string, { status: Submission["status"]; adminNote?: string; submittedAt: string; images: string[] }>();
          synced.forEach(s => {
            const existing = statusByDailyId.get(s.dailyTaskId);
            if (!existing || new Date(s.submittedAt) > new Date(existing.submittedAt)) {
              statusByDailyId.set(s.dailyTaskId, {
                status: s.status,
                adminNote: s.adminNote,
                submittedAt: s.submittedAt,
                images: s.evidence,
              });
            }
          });

          setAllTasks(prev => {
            const updated = { ...prev };
            for (const userId of Object.keys(updated)) {
              updated[userId] = updated[userId].map(mt => ({
                ...mt,
                weeklyTasks: mt.weeklyTasks.map(wt => ({
                  ...wt,
                  dailyTasks: wt.dailyTasks.map(dt => {
                    const s = statusByDailyId.get(dt.id);
                    if (!s) return dt;
                    return {
                      ...dt,
                      status: s.status as DailyStatus,
                      adminNote: s.adminNote,
                      submittedAt: s.submittedAt,
                      images: s.images,
                    };
                  }),
                })),
              }));
            }
            return updated;
          });
        }

        if (dbNotifs.length) setNotifications(dbNotifs.map(rowToNotif));
        if (dbLeave.length) setLeaveRequests(dbLeave.map(rowToLeaveRequest));

      } catch (err) {
        console.error("Failed to load data from Supabase:", err);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Periodic background sync ──────────────────────────────
  // No real-time push from Supabase here (could add via Realtime later),
  // so we poll every 30s for new notifications/submissions/leave requests.
  // Always overwrites from Supabase — it is the source of truth for status.
  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;

    async function syncNow() {
      try {
        const [dbNotifs, dbSubs, dbLeave] = await Promise.all([
          getAll<Record<string,unknown>>(TABLES.NOTIFICATIONS).catch(() => []),
          getAll<Record<string,unknown>>(TABLES.SUBMISSIONS).catch(() => []),
          getAll<Record<string,unknown>>(TABLES.LEAVE_REQUESTS).catch(() => []),
        ]);
        if (cancelled) return;

        // Always overwrite notifications from Supabase (source of truth)
        if (dbNotifs.length) {
          setNotifications(dbNotifs.map(rowToNotif));
        }

        // Always overwrite submissions from Supabase, then propagate
        // status changes into allTasks so daily task cards stay in sync
        if (dbSubs.length) {
          const synced = dbSubs.map(rowToSubmission);
          setSubmissions(synced);

          // Build a map of dailyTaskId → latest submission status
          const statusByDailyId = new Map<string, { status: Submission["status"]; adminNote?: string }>();
          synced.forEach(s => {
            const existing = statusByDailyId.get(s.dailyTaskId);
            if (!existing || new Date(s.submittedAt) > new Date(existing as unknown as string)) {
              statusByDailyId.set(s.dailyTaskId, { status: s.status, adminNote: s.adminNote });
            }
          });

          // Apply those statuses into allTasks so Today's Tasks reflects approval
          setAllTasks(prev => {
            const updated = { ...prev };
            for (const userId of Object.keys(updated)) {
              updated[userId] = updated[userId].map(mt => ({
                ...mt,
                weeklyTasks: mt.weeklyTasks.map(wt => ({
                  ...wt,
                  dailyTasks: wt.dailyTasks.map(dt => {
                    const s = statusByDailyId.get(dt.id);
                    if (!s) return dt;
                    // Only update if the DB status differs from local
                    if (dt.status === s.status) return dt;
                    return { ...dt, status: s.status as DailyStatus, adminNote: s.adminNote };
                  }),
                })),
              }));
            }
            return updated;
          });
        }

        if (dbLeave.length) {
          setLeaveRequests(dbLeave.map(rowToLeaveRequest));
        }
      } catch (err) {
        console.error("Background sync failed:", err);
      }
    }

    syncNow();
    const interval = setInterval(syncNow, 5_000);

    // Realtime push — triggers syncNow instantly on any DB change
    // instead of waiting for the next poll tick.
    const unsubNotifs = subscribeToTable(TABLES.NOTIFICATIONS, syncNow);
    const unsubSubs = subscribeToTable(TABLES.SUBMISSIONS, syncNow);
    const unsubLeave = subscribeToTable(TABLES.LEAVE_REQUESTS, syncNow);

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubNotifs();
      unsubSubs();
      unsubLeave();
    };
  }, [currentUser]);
  function handleSignIn(u: UserProfile){setCurrentUser(u);setPage("home");try{localStorage.setItem("litm_current_user",JSON.stringify(u));}catch{/* ignore */}}
  function handleSignOut(){setCurrentUser(null);setAuthPage("signin");try{localStorage.removeItem("litm_current_user");}catch{/* ignore */}}

  async function handleRegister(u: UserProfile){
    // 1. Update local state immediately so UI responds fast
    setUsers(p=>[...p,u]);
    setAllTasks(p=>({...p,[u.id]:[]}));
    setCurrentUser(u);
    setPage("home");
    try{localStorage.setItem("litm_current_user",JSON.stringify(u));}catch{/* ignore */}
    // 2. Persist to Supabase in the background
    try {
      await insertRecord(TABLES.USERS, userToRow(u));
    } catch (err) {
      console.error("Failed to save new user to Supabase:", err);
    }
  }

  async function handleUpdateProfile(u: UserProfile){
    // 1. Update local state
    setUsers(p=>p.map(x=>x.id===u.id?u:x));
    setCurrentUser(u);
    try{localStorage.setItem("litm_current_user",JSON.stringify(u));}catch{/* ignore */}
    // 2. Sync to Supabase
    try {
      await updateRecord(TABLES.USERS, { ...userToRow(u), id: u.id } as Record<string,unknown> & { id: string });
    } catch (err) {
      console.error("Failed to update profile in Supabase:", err);
    }
  }

  // ── Task / submission handlers (unchanged logic, Sheets sync added) ──

  function handleUpdateMyTasks(tasks: MonthlyTask[]){
    if(!currentUser)return;
    setAllTasks(p=>({...p,[currentUser.id]:tasks}));
    // Note: full task tree sync is complex — tasks are persisted via
    // the MonthlyTasks / WeeklyTasks / Deliverables / DailyTasks sheets
    // when individual actions fire (submit evidence, approve, etc.)
  }

  async function handleSubmitLeave(req: LeaveRequest, notif: AppNotification){
    setLeaveRequests(p=>[...p,req]);
    setNotifications(p=>[notif,...p]);
    try {
      await insertRecord(TABLES.LEAVE_REQUESTS, leaveToRow(req));
      await insertRecord(TABLES.NOTIFICATIONS, notifToRow(notif));
    } catch(err){ console.error("Leave request sync failed:", err); }
  }

  async function handleEvidenceSubmit(dailyId:string, images:string[], submission:Submission, notif:AppNotification){
    if(!currentUser)return;

    // Upload base64 images to Supabase Storage and swap in public URLs
    let finalImages = images;
    try {
      const uploaded = await Promise.all(
        images.map((img, i) =>
          img.startsWith("data:")
            ? uploadImageToStorage(img, `evidence-${dailyId}-${i}.jpg`).then(f => f.publicUrl)
            : Promise.resolve(img)
        )
      );
      finalImages = uploaded;
    } catch(err){ console.error("Storage upload failed, keeping base64:", err); }

    const updatedSubmission = { ...submission, evidence: finalImages };

    setAllTasks(p=>({...p,[currentUser.id]:(p[currentUser.id]??[]).map(mt=>({...mt,weeklyTasks:mt.weeklyTasks.map(wt=>({...wt,dailyTasks:wt.dailyTasks.map(dt=>dt.id===dailyId?{...dt,status:"submitted" as const,submittedAt:submission.submittedAt,images:finalImages}:dt)}))}))}));
    setSubmissions(p=>[...p,updatedSubmission]);
    setNotifications(p=>[notif,...p]);

    try {
      await insertRecord(TABLES.SUBMISSIONS, submissionToRow(updatedSubmission));
      await insertRecord(TABLES.NOTIFICATIONS, notifToRow(notif));
    } catch(err){ console.error("Submission sync failed:", err); }
  }

  async function handleApproveSubmission(subId:string, dailyId:string, userId:string){
    setSubmissions(p=>p.map(s=>s.id===subId?{...s,status:"approved" as const}:s));
    setAllTasks(p=>({...p,[userId]:(p[userId]??[]).map(mt=>({...mt,weeklyTasks:mt.weeklyTasks.map(wt=>({...wt,dailyTasks:wt.dailyTasks.map(dt=>dt.id===dailyId?{...dt,status:"approved" as const}:dt)}))}))}));
    try {
      const sub = submissions.find(s=>s.id===subId);
      if(sub) await updateRecord(TABLES.SUBMISSIONS, { ...submissionToRow({...sub,status:"approved"}), id:subId } as Record<string,unknown> & { id: string });
    } catch(err){ console.error("Approve submission sync failed:", err); }
  }


  async function handleReturnSubmission(subId:string, dailyId:string, userId:string, note:string){
    setSubmissions(p=>p.map(s=>s.id===subId?{...s,status:"returned" as const,adminNote:note}:s));
    setAllTasks(p=>({...p,[userId]:(p[userId]??[]).map(mt=>({...mt,weeklyTasks:mt.weeklyTasks.map(wt=>({...wt,dailyTasks:wt.dailyTasks.map(dt=>dt.id===dailyId?{...dt,status:"returned" as const,adminNote:note}:dt)}))}))}));
    try {
      const sub = submissions.find(s=>s.id===subId);
      if(sub) await updateRecord(TABLES.SUBMISSIONS, { ...submissionToRow({...sub,status:"returned",adminNote:note}), id:subId } as Record<string,unknown> & { id: string });
    } catch(err){ console.error("Return submission sync failed:", err); }
  }

  async function handleApproveLeave(reqId:string){
    setLeaveRequests(p=>p.map(r=>r.id===reqId?{...r,status:"approved" as const}:r));
    try {
      const req = leaveRequests.find(r=>r.id===reqId);
      if(req) await updateRecord(TABLES.LEAVE_REQUESTS, { ...leaveToRow({...req,status:"approved"}), id:reqId } as Record<string,unknown> & { id: string });
    } catch(err){ console.error("Approve leave sync failed:", err); }
  }

  async function handleReturnLeave(reqId:string, note:string){
    setLeaveRequests(p=>p.map(r=>r.id===reqId?{...r,status:"returned" as const,adminNote:note}:r));
    try {
      const req = leaveRequests.find(r=>r.id===reqId);
      if(req) await updateRecord(TABLES.LEAVE_REQUESTS, { ...leaveToRow({...req,status:"returned",adminNote:note}), id:reqId } as Record<string,unknown> & { id: string });
    } catch(err){ console.error("Return leave sync failed:", err); }
  }

  async function handleMarkRead(notifId:string){
    setNotifications(p=>p.map(n=>n.id===notifId?{...n,read:true}:n));
    try {
      const notif = notifications.find(n=>n.id===notifId);
      if(notif) await updateRecord(TABLES.NOTIFICATIONS, { ...notifToRow({...notif,read:true}), id:notifId } as Record<string,unknown> & { id: string });
    } catch(err){ console.error("Mark read sync failed:", err); }
  }

  async function handleDeleteNotification(notifId:string){
    setNotifications(p=>p.filter(n=>n.id!==notifId));
    try {
      const { error } = await (await import("@/lib/supabase")).supabase
        .from(TABLES.NOTIFICATIONS).delete().eq("id", notifId);
      if (error) console.error("Delete notification failed:", error.message);
    } catch(err){ console.error("Delete notification sync failed:", err); }
  }

  // ── Render ────────────────────────────────────────────────

  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if(!currentUser){
    if(authPage==="register") return <RegisterPage users={users} onRegister={handleRegister} onBack={()=>setAuthPage("signin")}/>;
    return <SignInPage users={users} onSignIn={handleSignIn} onGoRegister={()=>setAuthPage("register")}/>;
  }


  const myTasks = allTasks[currentUser.id]??[];

  return (
    <div className="min-h-screen bg-background">
      <TopNav user={currentUser} page={page} setPage={setPage} onSignOut={handleSignOut} unreadCount={unreadCount}/>
      <main className="max-w-4xl mx-auto px-4 pb-12" style={{paddingTop:"4.5rem"}}>
        {page==="home" && <HomePage user={currentUser} tasks={myTasks} leaveRequests={leaveRequests} onSubmitLeave={handleSubmitLeave} onEvidenceSubmit={handleEvidenceSubmit}/>}
        {page==="profile" && <ProfilePage user={currentUser} onUpdate={handleUpdateProfile}/>}
        {page==="tasks" && <MyTasksPage tasks={myTasks} onUpdateTasks={handleUpdateMyTasks}/>}
        {page==="accomplishments" && <MyAccomplishmentsPage tasks={myTasks} currentUser={currentUser}/>}
        {page==="monitoring" && currentUser.isAdmin && <MonitoringPage users={users} allTasks={allTasks} leaveRequests={leaveRequests}/>}
        {page==="history" && currentUser.isAdmin && <HistoryPage submissions={submissions} allUsers={users}/>}
        {page==="notifications" && currentUser.isAdmin && (
          <AdminNotificationsPage
            notifications={notifications} submissions={submissions} leaveRequests={leaveRequests}
            allTasks={allTasks} allUsers={users}
            onApproveSubmission={handleApproveSubmission} onReturnSubmission={handleReturnSubmission}
            onApproveLeave={handleApproveLeave} onReturnLeave={handleReturnLeave}
            onMarkRead={handleMarkRead} onDelete={handleDeleteNotification}
          />
        )}
        {page==="notifications" && !currentUser.isAdmin && (
          <StaffNotificationsPage
            userId={currentUser.id}
            notifications={notifications}
            submissions={submissions}
            onMarkRead={handleMarkRead}
            onDelete={handleDeleteNotification}
          />
        )}
      </main>
    </div>
  );
}

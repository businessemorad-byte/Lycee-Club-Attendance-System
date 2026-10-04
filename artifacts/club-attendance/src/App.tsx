import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { BrowserQRCodeReader } from '@zxing/browser';
import {
  useCreateSession, useCreateStudent, useExportSessionCsv, useGetDashboardOverview,
  useGetSessionReport, useGetStudent, useGetStudentBadge, useHealthCheck,
  useListSessions, useListStudents, useScanAttendance, useUpdateStudent,
  getGetDashboardOverviewQueryKey, getGetSessionReportQueryKey, getGetStudentBadgeQueryKey,
  getGetStudentQueryKey, getListSessionsQueryKey, getListStudentsQueryKey, getExportSessionCsvQueryKey,
} from '@workspace/api-client-react';
import type { ClubSession, ScanResult, Student, StudentInput, StudentUpdate } from '@workspace/api-client-react';
import {
  Activity, ArrowDownToLine, ArrowRight, BadgeCheck, CalendarDays, Check, CheckCircle2,
  ChevronDown, CircleAlert, ClipboardList, Clock3, Download, FileBarChart2, FileText,
  Fingerprint, GraduationCap, HeartPulse, LayoutDashboard, LoaderCircle, LockKeyhole,
  LogOut, Menu, MessageCircle, Plus, Printer, QrCode, RefreshCw, Search, ShieldCheck,
  ShieldQuestion, Users, X,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import QRCode from 'qrcode';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 12_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/students', label: 'Students', icon: Users },
  { href: '/scan', label: 'Entrance scan', icon: QrCode },
  { href: '/sessions', label: 'Friday sessions', icon: CalendarDays },
  { href: '/reports', label: 'Reports', icon: FileBarChart2 },
];
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not scheduled';
const timeLabel = (value?: string | null) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
const errorStatus = (error: unknown) => {
  const e = error as { status?: number; response?: { status?: number }; message?: string } | undefined;
  return e?.status ?? e?.response?.status ?? (/403|forbidden/i.test(e?.message ?? '') ? 403 : undefined);
};
const errorText = (error: unknown) => errorStatus(error) === 403
  ? 'Your account is signed in, but it is not approved for staff access. Please contact the school administrator.'
  : (error as { message?: string } | undefined)?.message || 'We could not load this information. Please try again.';

function IconButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`icon-button ${props.className ?? ''}`}>{children}</button>;
}
function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'quiet' | 'danger' }) {
  return <button {...props} className={`button button-${variant} ${className}`}>{children}</button>;
}
function StatePanel({ error, retry, title = 'Could not load this view' }: { error?: unknown; retry?: () => void; title?: string }) {
  const denied = errorStatus(error) === 403;
  return <div className={`state-panel ${denied ? 'state-denied' : ''}`} data-testid={denied ? 'state-admin-denied' : 'state-error'}>
    <div className="state-icon">{denied ? <LockKeyhole size={22} /> : <CircleAlert size={22} />}</div>
    <div><strong>{denied ? 'Staff access required' : title}</strong><p>{errorText(error)}</p></div>
    {!denied && retry && <Button variant="outline" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Retry</Button>}
  </div>;
}
function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-stack" aria-label="Loading"><div className="skeleton sk-title" />{Array.from({ length: rows }, (_, i) => <div className="skeleton sk-row" key={i} />)}</div>;
}
function EmptyState({ icon: Icon = ClipboardList, title, text, action }: { icon?: typeof ClipboardList; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-glyph"><Icon size={24} /></div><strong>{title}</strong><p>{text}</p>{action}</div>;
}
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  return <div className="modal-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><span className="eyebrow">LYCÉE CLUB</span><h2>{title}</h2></div><IconButton onClick={onClose} aria-label="Close" data-testid="button-close-modal"><X size={19} /></IconButton></div>
      {children}
    </div>
  </div>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Link href="/dashboard" className="brand-lockup" onClick={() => setMobileOpen(false)} data-testid="link-brand-dashboard">
        <img src={`${basePath}/logo.svg`} alt="" />
        <div><strong>MAÂNI CLUB</strong><span>ATTENDANCE OFFICE</span></div>
      </Link>
      <div className="school-label"><span className="school-dot" /> LYCEE MUSTAPHA EL MAÂNI <small>CASABLANCA · MOROCCO</small></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <span className="nav-caption">WORKSPACE</span>
        {navItems.map((item) => {
          const active = location === item.href || (item.href === '/students' && location.startsWith('/students'));
          return <Link key={item.href} href={item.href} className={`nav-link ${active ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${item.href.slice(1)}`}><item.icon size={18} /><span>{item.label}</span>{item.href === '/scan' && <span className="nav-live" />}</Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-note"><ShieldCheck size={17} /><div><strong>Protected records</strong><span>Student data is private</span></div></div>
        <div className="staff-row"><div className="staff-avatar">{(user?.firstName?.[0] || 'S').toUpperCase()}</div><div className="staff-meta"><strong>{user?.fullName || 'School staff'}</strong><span>Attendance admin</span></div><IconButton aria-label="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={17} /></IconButton></div>
      </div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="workspace">
      <header className="topbar no-print">
        <IconButton className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-open-menu"><Menu size={20} /></IconButton>
        <div className="topbar-context"><span className="context-indicator" /> Staff workspace <span className="context-slash">/</span> <span>{navItems.find((i) => i.href === location)?.label ?? 'Attendance'}</span></div>
        <div className="topbar-right"><span className="privacy-pill"><LockKeyhole size={13} /> PRIVATE</span><div className="topbar-date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div></div>
      </header>
      <div className="page-content page-enter">{children}</div>
      <footer className="workspace-footer"><span>مدرسة مصطفى المعاني</span><span>LYCÉE MUSTAPHA EL MAÂNI <i>·</i> CASABLANCA</span></footer>
    </main>
  </div>;
}
function Landing() {
  const { isSignedIn } = useUser();
  if (isSignedIn) return <Redirect to="/dashboard" />;
  return <div className="landing">
    <header className="landing-nav"><Link href="/" className="brand-lockup landing-brand"><img src={`${basePath}/logo.svg`} alt="" /><div><strong>MAÂNI CLUB</strong><span>LYCÉE MUSTAPHA EL MAÂNI</span></div></Link><Link href="/sign-in" className="button button-outline" data-testid="link-landing-sign-in">Staff sign in <ArrowRight size={16} /></Link></header>
    <section className="landing-hero">
      <div className="hero-copy"><span className="eyebrow hero-eyebrow"><span className="gold-dot" /> CASABLANCA · STUDENT LIFE</span><h1>A better way to<br /><em>show up.</em></h1><p>A considered attendance system for the clubs that make school feel like more than school.</p><div className="hero-actions"><Link href="/sign-in" className="button button-primary" data-testid="link-landing-access">Access staff workspace <ArrowRight size={17} /></Link><span><LockKeyhole size={13} /> Staff access only</span></div><div className="hero-proof"><div className="proof-mark"><ShieldCheck size={18} /></div><div><strong>Privacy comes first</strong><span>Encrypted badges. Careful records. Clear consent.</span></div></div></div>
      <div className="hero-art" aria-label="Illustration of school club badge"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="hero-card"><div className="badge-topline"><img src={`${basePath}/logo.svg`} alt="" /><span>STUDENT CLUBS<br />CASABLANCA</span></div><div className="badge-ar" dir="rtl">نادي المؤسسة</div><div className="badge-student">LYCÉE<br />MUSTAPHA<br />EL MAÂNI</div><div className="badge-footer"><span>FRIDAY · 14:30</span><div className="badge-mini-qr"><span /><span /><span /><span /></div></div></div><span className="orbit-label label-one">01 / ENROLL</span><span className="orbit-label label-two">02 / SCAN</span><span className="orbit-label label-three">03 / REPORT</span><div className="hero-index">LYCÉE CLUB ATTENDANCE <span>01 — 03</span></div></div>
    </section>
    <section className="landing-strip"><span>من أجل مجتمع مدرسي أكثر تواصلاً</span><span>DESIGNED FOR FRIDAY AFTERNOONS</span><span>LYCÉE MUSTAPHA EL MAÂNI — الدار البيضاء</span></section>
    <section className="landing-features"><div className="section-intro"><span className="eyebrow">ONE CLEAR RECORD</span><h2>From the first<br />registration to<br /><em>Friday roll call.</em></h2><p>Every detail in one calm, dependable place — built for the people keeping the door moving.</p></div><div className="feature-list">
      <div className="feature-row"><span>01</span><div><BadgeCheck /><h3>One badge per student</h3><p>Private encrypted QR badges make a fast scan possible without putting student details in the code.</p></div></div>
      <div className="feature-row"><span>02</span><div><Fingerprint /><h3>Quick entrance, accurate record</h3><p>Friday session scanning catches duplicate entries and flags a badge that needs a second look.</p></div></div>
      <div className="feature-row"><span>03</span><div><FileBarChart2 /><h3>Reports ready when you are</h3><p>Review who came, who missed the session, and when each student arrived.</p></div></div>
    </div></section>
    <section className="landing-close"><img src={`${basePath}/logo.svg`} alt="" /><div><span className="eyebrow">مدرسة مصطفى المعاني</span><h2>Clubs are where<br />school comes alive.</h2></div><Link href="/sign-in" className="button button-primary" data-testid="link-landing-footer-sign-in">Open the staff workspace <ArrowRight size={16} /></Link></section>
    <footer className="landing-footer"><span>© LYCÉE MUSTAPHA EL MAÂNI · CASABLANCA</span><span>STAFF PORTAL <i>·</i> SECURE ACCESS</span></footer>
  </div>;
}
function Dashboard() {
  useHealthCheck();
  const { data, isLoading, isError, error, refetch } = useGetDashboardOverview();
  const { data: sessions } = useListSessions();
  if (isLoading) return <><PageHeading eyebrow="STAFF WORKSPACE" title="Good afternoon." description="Your club attendance, at a glance." /><Skeleton rows={4} /></>;
  if (isError) return <><PageHeading eyebrow="STAFF WORKSPACE" title="Dashboard" description="Your club attendance, at a glance." /><StatePanel error={error} retry={() => refetch()} /></>;
  if (!data) return null;
  const latest = data.lastSession;
  return <>
    <PageHeading eyebrow="STAFF WORKSPACE · OVERVIEW" title="Good afternoon." description="A clear picture of who is in the club, and what happened last Friday." action={<Link href="/scan" className="button button-primary" data-testid="link-start-scan"><QrCode size={17} /> Open entrance scan</Link>} />
    <section className="metric-grid" data-testid="dashboard-metrics">
      <Metric label="Enrolled students" value={data.totalStudents} note={`${data.activeStudents} currently active`} icon={Users} accent="navy" />
      <Metric label="Present last session" value={data.presentToday} note={latest ? dateLabel(latest.date) : 'No sessions recorded'} icon={CheckCircle2} accent="green" />
      <Metric label="Attendance rate" value={`${data.attendanceRate}%`} note="Across the latest session" icon={Activity} accent="gold" />
      <Metric label="Consent on file" value={`${data.parentAuthorizations} / ${data.totalStudents}`} note={`${data.photoAuthorizations} photo permissions`} icon={ShieldCheck} accent="blue" />
    </section>
    <section className="dashboard-columns">
      <div className="surface latest-session">
        <div className="surface-head"><div><span className="eyebrow">LATEST FRIDAY</span><h2>Session snapshot</h2></div><Link href="/sessions" className="text-link" data-testid="link-all-sessions">All sessions <ArrowRight size={14} /></Link></div>
        {latest ? <div className="latest-body"><div className="session-date-block"><span>{new Date(latest.date).toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</span><strong>{new Date(latest.date).getDate()}</strong><small>{new Date(latest.date).toLocaleDateString('en-GB', { weekday: 'long' })}</small></div><div className="latest-info"><strong data-testid="text-latest-session-title">{latest.title}</strong><span>{dateLabel(latest.date)} <i>·</i> {latest.startTime}–{latest.endTime}</span><div className="attendance-meter"><div><span>Attendance</span><strong>{data.attendanceRate}%</strong></div><div className="meter-track"><span style={{ width: `${Math.min(100, data.attendanceRate)}%` }} /></div></div></div><Link href={`/reports?session=${latest.id}`} className="round-arrow" aria-label="Open latest session report" data-testid="link-latest-report"><ArrowRight size={18} /></Link></div> : <EmptyState icon={CalendarDays} title="No Friday sessions yet" text="Create your first session to begin tracking attendance." action={<Link href="/sessions" className="text-link" data-testid="link-create-first-session">Create a session <ArrowRight size={14} /></Link>} />}
      </div>
      <div className="surface quick-actions"><div className="surface-head"><div><span className="eyebrow">IN THE MOMENT</span><h2>Quick access</h2></div><span className="quick-clock"><Clock3 size={14} /> FRIDAY READY</span></div>
        <Link href="/students" className="quick-link" data-testid="link-quick-students"><span className="quick-icon"><Users size={18} /></span><div><strong>Enroll a student</strong><span>Add details and issue their badge</span></div><ArrowRight size={16} /></Link>
        <Link href="/scan" className="quick-link" data-testid="link-quick-scan"><span className="quick-icon quick-green"><QrCode size={18} /></span><div><strong>Scan at the entrance</strong><span>Record arrivals in real time</span></div><ArrowRight size={16} /></Link>
        <Link href="/reports" className="quick-link" data-testid="link-quick-report"><span className="quick-icon quick-gold"><FileText size={18} /></span><div><strong>Review a report</strong><span>Present, absent, and arrival time</span></div><ArrowRight size={16} /></Link>
      </div>
    </section>
    <section className="dashboard-bottom"><div className="surface integrity-card"><div className="integrity-art"><div className="integrity-ring"><ShieldCheck size={24} /></div></div><div><span className="eyebrow">A NOTE ON TRUST</span><h3>Every badge stays private.</h3><p>Student and family details are only available to authorized school staff. The QR badge contains an encrypted token, not readable personal information.</p></div></div>
      <div className="surface session-list-mini"><div className="surface-head"><div><span className="eyebrow">UP NEXT</span><h2>Upcoming sessions</h2></div><Link href="/sessions" className="text-link" data-testid="link-upcoming-sessions">View all <ArrowRight size={14} /></Link></div>{sessions?.filter((s) => new Date(s.date).getTime() >= new Date().setHours(0,0,0,0)).slice(0,2).map(s => <div className="mini-session" key={s.id} data-testid={`session-upcoming-${s.id}`}><CalendarDays size={16} /><div><strong>{s.title}</strong><span>{dateLabel(s.date)} · {s.startTime}</span></div></div>)}{(!sessions || sessions.filter((s) => new Date(s.date).getTime() >= new Date().setHours(0,0,0,0)).length === 0) && <p className="muted-small">No upcoming sessions scheduled.</p>}</div>
    </section>
  </>;
}
function Metric({ label, value, note, icon: Icon, accent }: { label: string; value: string | number; note: string; icon: typeof Users; accent: string }) {
  return <div className={`metric metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} /></span></div><strong data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</strong><small>{note}</small></div>;
}
function StudentForm({ initial, onSubmit, busy, onCancel }: { initial?: Student; onSubmit: (value: StudentInput | StudentUpdate) => void; busy: boolean; onCancel: () => void }) {
  const [form, setForm] = useState<StudentInput>({
    fullName: initial?.fullName ?? '', massarNumber: initial?.massarNumber ?? '', classroom: initial?.classroom ?? '',
    parentPhone: initial?.parentPhone ?? '', parentAuthSigned: initial?.parentAuthSigned ?? false,
    photoAuthSigned: initial?.photoAuthSigned ?? false, medicalNotes: initial?.medicalNotes ?? '',
  });
  const set = (key: keyof StudentInput, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(form); };
  return <form onSubmit={submit} className="form-stack">
    <div className="form-grid"><Field label="Student full name"><input autoFocus required minLength={2} maxLength={160} value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="e.g. Salma El Idrissi" data-testid="input-student-name" /></Field><Field label="Massar number"><input required minLength={3} maxLength={32} value={form.massarNumber} onChange={e => set('massarNumber', e.target.value)} placeholder="Student identification" data-testid="input-massar-number" /></Field>
      <Field label="Classroom"><input required value={form.classroom} onChange={e => set('classroom', e.target.value)} placeholder="e.g. 2BAC Sciences" data-testid="input-classroom" /></Field><Field label="Parent / guardian phone"><input required type="tel" minLength={6} value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} placeholder="+212 6…" data-testid="input-parent-phone" /></Field></div>
    <div className="consent-fields"><label className="check-row"><input type="checkbox" checked={form.parentAuthSigned} onChange={e => set('parentAuthSigned', e.target.checked)} data-testid="input-parent-authorization" /><span><strong>Parent / guardian authorization</strong><small>Signed consent on file</small></span><ShieldCheck size={18} /></label><label className="check-row"><input type="checkbox" checked={form.photoAuthSigned} onChange={e => set('photoAuthSigned', e.target.checked)} data-testid="input-photo-authorization" /><span><strong>Photo authorization</strong><small>Permission for school club activities</small></span><BadgeCheck size={18} /></label></div>
    <Field label="Medical notes" hint="Private · only visible to authorized school staff"><textarea maxLength={1000} rows={3} value={form.medicalNotes ?? ''} onChange={e => set('medicalNotes', e.target.value)} placeholder="Optional information staff should know" data-testid="input-medical-notes" /></Field>
    <div className="modal-actions"><Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-student">Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-student">{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{initial ? 'Save changes' : 'Enroll student'}</Button></div>
  </form>;
}
function Students() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params = useMemo(() => ({ ...(search ? { search } : {}), ...(status ? { status: status as 'ACTIVE' | 'INACTIVE' } : {}) }), [search, status]);
  const query = useListStudents(params);
  const createStudent = useCreateStudent();
  const updateStudent = useUpdateStudent();
  const qc = useQueryClient();
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [active, setActive] = useState<Student | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const closeModal = () => { setModal(null); setActive(null); };
  const afterSave = () => { qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); if (active) qc.invalidateQueries({ queryKey: getGetStudentQueryKey(active.id) }); closeModal(); };
  const submit = (value: StudentInput | StudentUpdate) => {
    if (modal === 'edit' && active) updateStudent.mutate({ studentId: active.id, data: value as StudentUpdate }, { onSuccess: afterSave });
    else createStudent.mutate({ data: value as StudentInput }, { onSuccess: (student) => { afterSave(); setProfileId(student.id); } });
  };
  const toggleStatus = (student: Student) => updateStudent.mutate({ studentId: student.id, data: { status: student.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListStudentsQueryKey() }) });
  useEffect(() => { if (!toast) return undefined; const t = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(t); }, [toast]);
  return <>
    <PageHeading eyebrow="STUDENT DIRECTORY" title="Students" description="Enrollment, permissions, and private student records." action={<Button onClick={() => setModal('create')} data-testid="button-enroll-student"><Plus size={17} /> Enroll student</Button>} />
    <div className="directory-toolbar"><label className="search-box"><Search size={17} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or Massar number" aria-label="Search students" data-testid="input-search-students" />{search && <button onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-search"><X size={15} /></button>}</label><label className="select-shell"><span>Status</span><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" data-testid="select-student-status"><option value="">All students</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select><ChevronDown size={15} /></label><span className="result-count" data-testid="text-student-result-count">{query.data?.length ?? '—'} records</span></div>
    {query.isLoading ? <Skeleton rows={5} /> : query.isError ? <StatePanel error={query.error} retry={() => query.refetch()} /> : query.data?.length ? <div className="surface table-surface"><div className="table-wrap"><table className="data-table"><thead><tr><th>STUDENT</th><th>CLASS</th><th>AUTHORIZATIONS</th><th>STATUS</th><th>ENROLLED</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{query.data.map(student => <tr key={student.id} data-testid={`row-student-${student.id}`}><td><button className="student-name-cell" onClick={() => setProfileId(student.id)} data-testid={`button-view-student-${student.id}`}><span className="student-initials">{student.fullName.split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{student.fullName}</strong><small>{student.massarNumber}</small></span></button></td><td className="cell-muted">{student.classroom}</td><td><div className="auth-pills"><span className={student.parentAuthSigned ? 'auth-ok' : 'auth-missing'} title="Parent authorization"><ShieldCheck size={14} /> Guardian</span><span className={student.photoAuthSigned ? 'auth-ok' : 'auth-missing'} title="Photo authorization"><BadgeCheck size={14} /> Photo</span></div></td><td><button className={`status-chip ${student.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}`} onClick={() => toggleStatus(student)} data-testid={`button-toggle-status-${student.id}`} aria-label={`Set ${student.fullName} ${student.status === 'ACTIVE' ? 'inactive' : 'active'}`}><span />{student.status === 'ACTIVE' ? 'Active' : 'Inactive'}</button></td><td className="cell-muted">{dateLabel(student.registrationDate)}</td><td><div className="row-actions"><IconButton aria-label={`Edit ${student.fullName}`} onClick={() => { setActive(student); setModal('edit'); }} data-testid={`button-edit-student-${student.id}`}><FileText size={16} /></IconButton><IconButton aria-label={`Open badge for ${student.fullName}`} onClick={() => setProfileId(student.id)} data-testid={`button-badge-student-${student.id}`}><QrCode size={16} /></IconButton></div></td></tr>)}</tbody></table></div></div> : <EmptyState icon={Users} title={search ? 'No students match that search' : 'Your directory is ready to grow'} text={search ? 'Try another name or Massar number.' : 'Enroll a student to create their profile and encrypted club badge.'} action={!search && <Button onClick={() => setModal('create')} data-testid="button-enroll-empty"><Plus size={16} /> Enroll the first student</Button>} />}
    {query.isError && errorStatus(query.error) === 403 ? null : <div className="directory-footnote"><LockKeyhole size={13} /> Contact, medical, and authorization details are private school records.</div>}
    {updateStudent.isError && !modal && <p className="form-error" role="alert">{errorText(updateStudent.error)}</p>}
    {modal && <Modal title={modal === 'edit' ? 'Edit student profile' : 'Enroll a student'} onClose={closeModal} wide><p className="modal-intro">{modal === 'edit' ? 'Update the student record. Changes are saved to the school directory.' : 'Add the student details used for attendance and issue an encrypted badge.'}</p><StudentForm initial={active ?? undefined} onSubmit={submit} busy={createStudent.isPending || updateStudent.isPending} onCancel={closeModal} />{(createStudent.isError || updateStudent.isError) && <p className="form-error" role="alert">{errorText(createStudent.error || updateStudent.error)}</p>}</Modal>}
    {profileId && <StudentProfile studentId={profileId} onClose={() => setProfileId(null)} onEdit={(student) => { setProfileId(null); setActive(student); setModal('edit'); }} onToast={setToast} />}
    {toast && <div className="toast-inline" role="status" data-testid="status-toast"><CheckCircle2 size={17} />{toast}</div>}
  </>;
}
function StudentProfile({ studentId, onClose, onEdit, onToast }: { studentId: string; onClose: () => void; onEdit: (s: Student) => void; onToast: (s: string) => void }) {
  const profile = useGetStudent(studentId, { query: { queryKey: getGetStudentQueryKey(studentId), enabled: !!studentId } });
  const badge = useGetStudentBadge(studentId, { query: { queryKey: getGetStudentBadgeQueryKey(studentId), enabled: !!studentId } });
  const student = profile.data;
  const [qrData, setQrData] = useState('');
  useEffect(() => { if (badge.data?.token) QRCode.toDataURL(badge.data.token, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#122b40', light: '#ffffff' } }).then(setQrData).catch(() => setQrData('')); }, [badge.data?.token]);
  const makeBadgePng = async () => {
    if (!student || !qrData) throw new Error('The student badge is not ready yet.');
    await document.fonts.ready;
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 620;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the badge image.');
    context.fillStyle = '#102b40';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#d3af62';
    context.lineWidth = 3;
    context.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
    context.fillStyle = '#d3af62';
    context.font = '700 23px Manrope, sans-serif';
    context.fillText('LYCÉE MUSTAPHA EL MAÂNI', 58, 82);
    context.fillStyle = '#ffffff';
    context.font = '700 39px Manrope, sans-serif';
    context.fillText(student.fullName, 58, 205, 560);
    context.fillStyle = '#ccd4d8';
    context.font = '22px DM Sans, sans-serif';
    context.fillText(`${student.classroom} · ${student.massarNumber}`, 58, 258, 560);
    context.fillStyle = '#d3af62';
    context.font = '600 25px "Noto Sans Arabic", sans-serif';
    context.direction = 'rtl';
    context.textAlign = 'right';
    context.fillText('نادي المؤسسة', 940, 548);
    context.direction = 'ltr';
    context.textAlign = 'left';
    context.fillStyle = '#a7bac2';
    context.font = '14px monospace';
    context.fillText('ENCRYPTED DIGITAL BADGE', 58, 558);
    const qrImage = new Image();
    qrImage.src = qrData;
    await qrImage.decode();
    context.fillStyle = '#ffffff';
    context.fillRect(675, 150, 255, 255);
    context.drawImage(qrImage, 690, 165, 225, 225);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export the badge image.')), 'image/png');
    });
  };
  const download = async () => {
    try {
      const blob = await makeBadgePng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `badge-${student?.massarNumber.replace(/[^A-Za-z0-9_-]/g, '') || 'student'}.png`;
      a.click();
      URL.revokeObjectURL(url);
      onToast('Badge image downloaded');
    } catch {
      onToast('Could not create the badge image');
    }
  };
  const shareBadge = async () => {
    if (!student) return;
    try {
      const blob = await makeBadgePng();
      const file = new File([blob], `badge-${student.massarNumber.replace(/[^A-Za-z0-9_-]/g, '') || 'student'}.png`, { type: 'image/png' });
      const message = `Hello, here is ${student.fullName}'s encrypted club attendance badge for Lycée Mustapha El Maâni.`;
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Lycée club badge', text: message });
        onToast('Badge shared');
        return;
      }
      const digits = student.parentPhone.replace(/\D/g, '');
      const phone = digits.startsWith('0') ? `212${digits.slice(1)}` : digits;
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      onToast('Badge downloaded. Attach it in WhatsApp to send.');
    } catch {
      onToast('Could not share the badge. Download it and attach it in WhatsApp.');
    }
  };
  const copyToken = async () => { if (!badge.data?.token) return; await navigator.clipboard?.writeText(badge.data.token); onToast('Encrypted badge token copied'); };
  return <Modal title="Student profile" onClose={onClose} wide>{profile.isLoading ? <Skeleton rows={3} /> : profile.isError ? <StatePanel error={profile.error} retry={() => profile.refetch()} /> : student && <div className="profile-layout">
     <div className="profile-main"><div className="profile-person"><div className="profile-avatar">{student.fullName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div><div><span className={`status-chip ${student.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}`}><span />{student.status}</span><h3>{student.fullName}</h3><p>{student.classroom} <i>·</i> Massar {student.massarNumber}</p></div></div><div className="profile-fields"><div><span>Parent / guardian</span><strong>{student.parentPhone}</strong></div><div><span>Enrolled</span><strong>{dateLabel(student.registrationDate)}</strong></div><div><span>Guardian permission</span><strong className={student.parentAuthSigned ? 'positive-text' : 'warning-text'}>{student.parentAuthSigned ? 'Signed' : 'Not on file'}</strong></div><div><span>Photo permission</span><strong className={student.photoAuthSigned ? 'positive-text' : 'warning-text'}>{student.photoAuthSigned ? 'Signed' : 'Not on file'}</strong></div><div className="medical-detail"><span><HeartPulse size={14} /> Medical notes · private</span><strong>{student.medicalNotes || 'No notes recorded'}</strong></div></div><div className="profile-actions"><Button variant="outline" onClick={() => onEdit(student)} data-testid="button-edit-profile"><FileText size={16} /> Edit profile</Button><Button variant="outline" onClick={shareBadge} disabled={!badge.data || !qrData} data-testid="button-whatsapp-parent"><MessageCircle size={16} /> WhatsApp guardian</Button></div></div>
    <aside className="badge-preview" dir="rtl"><div className="badge-preview-header"><span>نادي المؤسسة</span><img src={`${basePath}/logo.svg`} alt="" /></div><div className="badge-ar-title">بطاقة الانخراط</div><div className="badge-preview-qr" aria-label="Encrypted QR badge preview">{qrData ? <img src={qrData} alt="رمز مشفر وآمن" /> : <div className="qr-pattern" />}</div><strong className="badge-ar-name">{student.fullName}</strong><span className="badge-class">{student.classroom} · {student.massarNumber}</span><span className="badge-encrypted"><LockKeyhole size={11} /> رمز مشفر وآمن</span><div className="badge-preview-actions"><button onClick={download} disabled={!qrData} data-testid="button-download-badge"><Download size={14} /> تحميل البطاقة</button><button onClick={copyToken} disabled={!badge.data} data-testid="button-copy-badge-token"><Fingerprint size={14} /> نسخ الرمز</button></div>{badge.isLoading && <small className="badge-loading">جارٍ تحميل الشارة…</small>}{badge.isError && <small className="badge-error">{errorText(badge.error)}</small>}</aside>
  </div>}</Modal>;
}
function Sessions() {
  const sessions = useListSessions();
  const create = useCreateSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: 'Friday Club Session', date: '', startTime: '14:30', endTime: '16:00' });
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (new Date(`${form.date}T12:00:00`).getDay() !== 5) { setFormError('Club sessions must be scheduled on a Friday.'); return; }
    setFormError('');
    create.mutate({ data: form }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSessionsQueryKey() }); setOpen(false); } });
  };
  const filtered = (sessions.data ?? []).filter(s => filter === 'all' || (filter === 'upcoming' ? new Date(s.date) >= new Date(new Date().toDateString()) : new Date(s.date) < new Date(new Date().toDateString()))).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return <>
    <PageHeading eyebrow="FRIDAY PROGRAMME" title="Sessions" description="Schedule club meetings and keep each Friday's attendance in its own record." action={<Button onClick={() => setOpen(true)} data-testid="button-create-session"><Plus size={17} /> New session</Button>} />
    <div className="session-toolbar"><div className="segmented-control" role="group" aria-label="Filter sessions">{(['all','upcoming','past'] as const).map(x => <button className={filter === x ? 'segment-active' : ''} key={x} onClick={() => setFilter(x)} data-testid={`button-filter-${x}-sessions`}>{x === 'all' ? 'All sessions' : x === 'upcoming' ? 'Upcoming' : 'Past sessions'}</button>)}</div><span className="result-count">{filtered.length} sessions</span></div>
    {sessions.isLoading ? <Skeleton rows={4} /> : sessions.isError ? <StatePanel error={sessions.error} retry={() => sessions.refetch()} /> : filtered.length ? <div className="session-cards">{filtered.map((session, i) => <SessionCard key={session.id} session={session} index={i} />)}</div> : <EmptyState icon={CalendarDays} title={filter === 'all' ? 'No sessions on the calendar' : `No ${filter} sessions`} text={filter === 'all' ? 'Create a Friday session to prepare the attendance desk.' : 'Try a different filter, or schedule the next club afternoon.'} action={filter === 'all' && <Button onClick={() => setOpen(true)} data-testid="button-create-first-session"><Plus size={16} /> Create first session</Button>} />}
    {open && <Modal title="Schedule a Friday session" onClose={() => setOpen(false)}><form className="form-stack" onSubmit={onSubmit}><p className="modal-intro">Create the session before students arrive. You can select it at the entrance scanner.</p><Field label="Session title"><input required minLength={2} maxLength={200} value={form.title} onChange={e => setForm({...form,title:e.target.value})} data-testid="input-session-title" /></Field><Field label="Friday date"><input required type="date" value={form.date} onChange={e => { setForm({...form,date:e.target.value}); setFormError(''); }} data-testid="input-session-date" /></Field><div className="form-grid"><Field label="Doors open"><input required type="time" value={form.startTime} onChange={e => setForm({...form,startTime:e.target.value})} data-testid="input-session-start" /></Field><Field label="Session ends"><input required type="time" value={form.endTime} onChange={e => setForm({...form,endTime:e.target.value})} data-testid="input-session-end" /></Field></div>{formError && <p className="form-error" role="alert">{formError}</p>}{create.isError && <p className="form-error">{errorText(create.error)}</p>}<div className="modal-actions"><Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-session">Cancel</Button><Button type="submit" disabled={create.isPending} data-testid="button-save-session">{create.isPending ? <LoaderCircle className="spin" size={16} /> : <CalendarDays size={16} />} Create session</Button></div></form></Modal>}
  </>;
}
function SessionCard({ session, index }: { session: ClubSession; index: number }) {
  const day = new Date(session.date);
  return <article className="session-card" data-testid={`card-session-${session.id}`}><div className="session-card-index">FRI · {String(index + 1).padStart(2,'0')}</div><div className="session-card-date"><span>{day.toLocaleDateString('en-GB',{month:'short'}).toUpperCase()}</span><strong>{day.getDate()}</strong><small>{day.toLocaleDateString('en-GB',{weekday:'long'})}</small></div><div className="session-card-info"><h2>{session.title}</h2><p><CalendarDays size={14} /> {dateLabel(session.date)}</p><p><Clock3 size={14} /> {session.startTime} – {session.endTime}</p></div><div className="session-card-actions"><Link href={`/scan?session=${session.id}`} className="text-link" data-testid={`link-scan-session-${session.id}`}><QrCode size={15} /> Scan attendance</Link><Link href={`/reports?session=${session.id}`} className="text-link" data-testid={`link-report-session-${session.id}`}>View report <ArrowRight size={14} /></Link></div></article>;
}
function ScanPage() {
  const { data: sessions, isLoading, isError, error, refetch } = useListSessions();
  const [, setLocation] = useLocation();
  const querySession = new URLSearchParams(window.location.search).get('session') || '';
  const [sessionId, setSessionId] = useState(querySession);
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const scan = useScanAttendance();
  const activeSession = sessions?.find(s => s.id === sessionId);
  const submit = (e?: FormEvent, scannedToken = token) => {
    e?.preventDefault();
    if (!sessionId || scannedToken.trim().length < 24) return;
    scan.mutate({ data: { sessionId, token: scannedToken.trim() } }, { onSuccess: (r) => { setResult(r); setToken(''); qc.invalidateQueries({ queryKey: getGetSessionReportQueryKey(sessionId) }); qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() }); } });
  };
  useEffect(() => { setLocation(sessionId ? `/scan?session=${encodeURIComponent(sessionId)}` : '/scan', { replace: true }); }, [sessionId, setLocation]);
  useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserQRCodeReader();
    void reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      videoRef.current,
      (result, _error, activeControls) => {
        controls = activeControls;
        scannerControlsRef.current = activeControls;
        if (result && !cancelled) {
          activeControls.stop();
          scannerControlsRef.current = null;
          setCameraOn(false);
          submit(undefined, result.getText());
        }
      },
    ).then((activeControls) => {
      controls = activeControls;
      scannerControlsRef.current = activeControls;
      if (cancelled) activeControls.stop();
    }).catch(() => {
      if (!cancelled) {
        setCameraError('Camera access was unavailable. Check browser permissions or paste the badge token manually.');
        setCameraOn(false);
      }
    });
    return () => {
      cancelled = true;
      controls?.stop();
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [cameraOn]);
  const stopCamera = () => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setCameraOn(false);
  };
  const startCamera = () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot access a camera. Paste the encrypted badge token below.');
      return;
    }
    setCameraOn(true);
  };
  return <>
    <PageHeading eyebrow="FRIDAY · ENTRANCE DESK" title="Attendance scan" description="Choose this Friday’s session, then scan each student badge as they arrive." action={<span className="scan-secure"><span /> SECURE SCANNER</span>} />
    {isLoading ? <Skeleton rows={3} /> : isError ? <StatePanel error={error} retry={() => refetch()} /> : !sessions?.length ? <div className="surface scan-no-session"><EmptyState icon={CalendarDays} title="Schedule a session first" text="The entrance scanner needs a Friday session to attach each arrival to the correct record." action={<Link href="/sessions" className="button button-primary" data-testid="link-scan-create-session">Create a session <ArrowRight size={15} /></Link>} /></div> : <div className="scan-layout">
      <section className="scan-workbench"><div className="scan-step-head"><div><span className="eyebrow">01 — SESSION</span><h2>Which session?</h2></div><span className="step-count">FRIDAY ENTRY</span></div><label className="field"><span>Active Friday session</span><select value={sessionId} onChange={e => { setSessionId(e.target.value); setResult(null); }} data-testid="select-scan-session"><option value="">Select a session…</option>{sessions.map(s => <option value={s.id} key={s.id}>{dateLabel(s.date)} — {s.title}</option>)}</select></label>
        {activeSession && <div className="active-session-strip"><CalendarDays size={16} /><div><strong>{activeSession.title}</strong><span>{dateLabel(activeSession.date)} <i>·</i> {activeSession.startTime}–{activeSession.endTime}</span></div><span className="session-open-label">OPEN</span></div>}
        <div className="scanner-frame"><div className={`scanner-view ${cameraOn ? 'camera-active' : ''}`}>{cameraOn ? <video ref={videoRef} muted playsInline data-testid="video-qr-camera" /> : <div className="scanner-placeholder"><div className="scanner-corners"><QrCode size={52} strokeWidth={1.15} /></div><strong dir="rtl">امسح بطاقة الطالب</strong><span>وجه رمز الاستجابة نحو الكاميرا</span></div>}{cameraOn && <span className="scan-line" />}</div><div className="scanner-controls">{cameraOn ? <Button variant="outline" onClick={stopCamera} data-testid="button-stop-camera"><X size={15} /> Stop camera</Button> : <Button onClick={startCamera} disabled={!sessionId} data-testid="button-start-camera"><QrCode size={16} /> Start camera</Button>}<span>Only encrypted badge codes are read</span></div></div>
        {cameraError && <p className="form-error" role="alert" data-testid="status-camera-error">{cameraError}</p>}
        <div className="manual-entry"><div><span className="eyebrow">CAMERA NOT AVAILABLE?</span><strong dir="rtl">أدخل الرمز المشفر يدوياً</strong><span>Paste the encrypted token printed in the badge QR.</span></div><form onSubmit={submit}><input value={token} onChange={e => setToken(e.target.value)} placeholder="Encrypted badge token" minLength={24} maxLength={2048} aria-label="Encrypted badge token" data-testid="input-encrypted-token" /><Button type="submit" disabled={!sessionId || token.trim().length < 24 || scan.isPending} data-testid="button-submit-scan">{scan.isPending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />} Verify</Button></form></div>
        {scan.isError && <StatePanel error={scan.error} title="Badge could not be verified" />}
      </section>
      <aside className="scan-side"><div className="scan-side-head"><span className="eyebrow">02 — RESULT</span><span className="scan-live"><i /> LIVE</span></div>{result ? <ScanResultCard result={result} /> : <div className="scan-result-empty"><div className="result-empty-icon"><Fingerprint size={23} /></div><strong>Ready for the next student</strong><p>A verified arrival will appear here with their name and entry time.</p><div className="privacy-stamp"><LockKeyhole size={14} /><span>Personal details stay on the school record</span></div></div>}
         <div className="scan-help"><ShieldQuestion size={17} /><p><strong>Amber result: consent needs review.</strong><br />The arrival is still recorded. Check the student’s authorization details with the school administrator.</p></div>
      </aside>
    </div>}
  </>;
}
function ScanResultCard({ result }: { result: ScanResult }) {
  const ok = result.status === 'present';
  const duplicate = result.status === 'duplicate';
  const warning = result.status === 'warning';
  return <div className={`scan-result-card ${ok ? 'scan-success' : duplicate ? 'scan-duplicate' : 'scan-warning'}`} data-testid={`status-scan-${result.status}`}><div className="result-status-icon">{ok ? <CheckCircle2 size={24} /> : duplicate ? <RefreshCw size={22} /> : <CircleAlert size={23} />}</div><span className="result-status-label">{ok ? 'ARRIVAL RECORDED' : duplicate ? 'ALREADY CHECKED IN' : 'ARRIVAL RECORDED · CONSENT MISSING'}</span><strong className="result-student">{result.student.fullName}</strong><span className="result-class">{result.student.classroom} · {result.student.massarNumber}</span><div className="result-time"><Clock3 size={15} /><strong>{timeLabel(result.timestamp)}</strong><span>{dateLabel(result.timestamp)}</span></div>{result.message && <p>{warning ? `${result.message} Attendance was recorded.` : result.message}</p>}</div>;
}
function Reports() {
  const sessions = useListSessions();
  const [selected, setSelected] = useState(new URLSearchParams(window.location.search).get('session') || '');
  const reportQuery = useGetSessionReport(selected, { query: { queryKey: getGetSessionReportQueryKey(selected), enabled: !!selected } });
  const csvQuery = useExportSessionCsv(selected, { query: { queryKey: getExportSessionCsvQueryKey(selected), enabled: false } });
  const exportCsv = async () => {
    const result = await csvQuery.refetch();
    if (!result.data) return;
    const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `attendance-${selected}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const report = reportQuery.data;
  return <>
    <PageHeading eyebrow="ATTENDANCE RECORDS" title="Session reports" description="A precise roll call: every arrival, every absence, and the time they came in." action={report && <><Button variant="outline" onClick={exportCsv} disabled={csvQuery.isFetching} data-testid="button-export-csv">{csvQuery.isFetching ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />} Export CSV</Button><Button variant="outline" onClick={() => window.print()} data-testid="button-print-report"><Printer size={16} /> Print report</Button></>} />
    <div className="report-filter surface"><div className="report-filter-icon"><FileBarChart2 size={19} /></div><div><span className="eyebrow">SELECT A FRIDAY</span><strong>Attendance session</strong></div><label className="select-shell report-select"><select value={selected} onChange={e => setSelected(e.target.value)} aria-label="Select session report" data-testid="select-report-session"><option value="">Choose a session…</option>{sessions.data?.map(s => <option key={s.id} value={s.id}>{dateLabel(s.date)} — {s.title}</option>)}</select><ChevronDown size={15} /></label>{sessions.isError && <span className="form-error">{errorText(sessions.error)}</span>}</div>
    {!selected ? <EmptyState icon={FileBarChart2} title="Choose a session to begin" text="Select a Friday above to view the attendance record and export a report." /> : reportQuery.isLoading ? <Skeleton rows={6} /> : reportQuery.isError ? <StatePanel error={reportQuery.error} retry={() => reportQuery.refetch()} /> : report && <div className="report-content print-surface" data-testid="report-content">
      <div className="report-title-block"><div><span className="eyebrow">LYCÉE MUSTAPHA EL MAÂNI · CLUB ATTENDANCE</span><h2>{report.session.title}</h2><p><CalendarDays size={15} /> {dateLabel(report.session.date)} <i>·</i> {report.session.startTime}–{report.session.endTime}</p></div><div className="report-mark"><img src={`${basePath}/logo.svg`} alt="" /></div></div>
      <div className="report-stats"><div><span>ENROLLED</span><strong>{report.totalStudents}</strong></div><div><span>PRESENT</span><strong className="positive-text">{report.presentCount}</strong></div><div><span>ABSENT</span><strong className="warning-text">{report.absentCount}</strong></div><div><span>ATTENDANCE</span><strong>{report.attendanceRate}%</strong></div></div>
      <div className="attendance-lists"><AttendanceList title="Present" count={report.presentCount} present people={report.present} /><AttendanceList title="Absent" count={report.absentCount} people={report.absent} /></div>
      <div className="report-footer"><span><LockKeyhole size={13} /> Confidential student attendance record</span><span>Generated {new Date().toLocaleString('en-GB')}</span></div>
    </div>}
    {csvQuery.isError && <StatePanel error={csvQuery.error} title="CSV export unavailable" />}
  </>;
}
function AttendanceList({ title, count, people, present = false }: { title: string; count: number; people: Array<{ id: string; fullName: string; massarNumber: string; classroom: string; scannedAt?: string | null }>; present?: boolean }) {
  return <section className={`attendance-list ${present ? 'present-list' : 'absent-list'}`}><div className="attendance-list-head"><div><span className="attendance-bullet" /><h3>{title}</h3></div><span>{count} STUDENTS</span></div>{people.length ? <div className="attendance-rows">{people.map(person => <div className="attendance-row" key={person.id} data-testid={`report-student-${person.id}`}><span className="report-avatar">{person.fullName.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span><div><strong>{person.fullName}</strong><small>{person.classroom} <i>·</i> {person.massarNumber}</small></div><span className="entry-time">{present ? timeLabel(person.scannedAt) : '—'}</span></div>)}</div> : <div className="list-empty">{present ? 'No arrivals recorded for this session.' : 'Every enrolled student was present.'}</div>}</section>;
}
function Protected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <div className="auth-loading" aria-label="Loading account"><LoaderCircle className="spin" size={22} /></div>;
  if (!isSignedIn) return <Redirect to="/" />;
  return <AppShell>{children}</AppShell>;
}
function HomeRedirect() {
  const { isSignedIn } = useUser();
  return isSignedIn ? <Redirect to="/dashboard" /> : <Landing />;
}
function SignInPage() { return <div className="auth-stage"><div className="auth-aside"><Link href="/" className="brand-lockup"><img src={`${basePath}/logo.svg`} alt="" /><div><strong>MAÂNI CLUB</strong><span>LYCÉE MUSTAPHA EL MAÂNI</span></div></Link><div><span className="eyebrow">STAFF ACCESS</span><h1>Good systems<br />make room for<br /><em>good things.</em></h1><p>Sign in to manage Friday club attendance at Lycée Mustapha El Maâni.</p></div><span className="auth-ar" dir="rtl">مدرسة مصطفى المعاني · الدار البيضاء</span></div><div className="auth-form-wrap"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>; }
function SignUpPage() { return <div className="auth-stage auth-signup"><div className="auth-aside"><Link href="/" className="brand-lockup"><img src={`${basePath}/logo.svg`} alt="" /><div><strong>MAÂNI CLUB</strong><span>LYCÉE MUSTAPHA EL MAÂNI</span></div></Link><div><span className="eyebrow">STAFF ACCESS</span><h1>A place for<br />every arrival<br /><em>to count.</em></h1><p>Create a staff account to request access to the attendance workspace.</p></div><span className="auth-ar" dir="rtl">مدرسة مصطفى المعاني · الدار البيضاء</span></div><div className="auth-form-wrap"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>; }
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk(); const qc = useQueryClient(); const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => { const unsubscribe = addListener(({ user }) => { const userId = user?.id ?? null; if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) qc.clear(); prevUserIdRef.current = userId; }); return unsubscribe; }, [addListener, qc]);
  return null;
}
const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#1d7653', colorForeground: '#19334a', colorMutedForeground: '#667887', colorDanger: '#b7433f', colorBackground: '#fffdf7', colorInput: '#fffdf7', colorInputForeground: '#19334a', colorNeutral: '#d8d5ca', fontFamily: 'DM Sans, Noto Sans Arabic, sans-serif', borderRadius: '12px' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fffdf7] rounded-2xl w-[440px] max-w-full overflow-hidden', card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#19334a] font-bold', headerSubtitle: 'text-[#667887]', socialButtonsBlockButtonText: 'text-[#19334a] font-medium', formFieldLabel: 'text-[#19334a] font-semibold', footerActionLink: 'text-[#1d7653] font-semibold', footerActionText: 'text-[#667887]', dividerText: 'text-[#667887]', identityPreviewEditButton: 'text-[#1d7653]', formFieldSuccessText: 'text-[#1d7653]', alertText: 'text-[#19334a]',
    logoBox: 'mb-2', logoImage: 'max-h-10', socialButtonsBlockButton: 'border-[#d8d5ca] bg-[#fffdf7] hover:bg-[#f6f2e8]', formButtonPrimary: 'bg-[#1d7653] hover:bg-[#155b40] text-white font-semibold', formFieldInput: 'bg-[#fffdf7] border-[#d8d5ca] text-[#19334a]', footerAction: 'border-0', dividerLine: 'bg-[#e5e1d8]', alert: 'border-[#d8d5ca]', otpCodeFieldInput: 'border-[#d8d5ca] bg-[#fffdf7] text-[#19334a]', formFieldRow: 'mb-4', main: 'gap-4',
  },
};
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your school workspace' } }, signUp: { start: { title: 'Request staff access', subtitle: 'Create your Lycée Club Attendance account' } } }}
     routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard">{() => <Protected><Dashboard /></Protected>}</Route>
      <Route path="/students">{() => <Protected><Students /></Protected>}</Route>
      <Route path="/scan">{() => <Protected><ScanPage /></Protected>}</Route>
      <Route path="/sessions">{() => <Protected><Sessions /></Protected>}</Route>
      <Route path="/reports">{() => <Protected><Reports /></Protected>}</Route>
      <Route component={NotFound} />
    </Switch></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}
export default App;
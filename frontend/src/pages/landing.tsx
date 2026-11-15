import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, BarChart3, Check, ChevronRight, CircleDollarSign, Database, FileCheck2, Gauge, Layers3, LockKeyhole, ShieldCheck, Sparkles, TrendingUp, Users, Workflow } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { BrandMark } from "@/components/brand-mark";

const models = [
  { icon: Gauge, title: "Late-Payment Classification", algorithm: "XGBoost classifier", color: "green", description: "Estimate the probability an invoice will be paid late and make portfolio risk easier to prioritize.", bullets: ["Late-payment probability (0–1)", "Low, medium and high risk bands", "Configured decision threshold"] },
  { icon: TrendingUp, title: "Payment-Delay Regression", algorithm: "HistGradientBoosting regression", color: "blue", description: "Predict signed payment delay in days, with useful early, on-time and late interpretations.", bullets: ["Signed delay predictions", "Days early or late", "A separate view from late risk"] },
  { icon: Users, title: "Customer Behaviour Segmentation", algorithm: "K-Means · six segments", color: "violet", description: "Explore customer groups with similar payment behaviour and understand patterns across a portfolio.", bullets: ["Six customer segments", "Behaviour analysis by group", "Context for collection planning"] },
];

export default function LandingPage() {
  return <main className="landing-page min-h-screen bg-white text-slate-950">
    <header className="landing-header"><nav className="landing-nav" aria-label="Main navigation">
      <Link to="/" className="landing-brand"><span className="landing-brand-icon"><BrandMark /></span><span><b>{APP_NAME}</b><small>Receivables Intelligence</small></span></Link>
      <div className="landing-links"><a href="#models">Models</a><a href="#how-it-works">How it works</a><a href="#platform">Platform</a><a href="#security">Security</a></div>
      <div className="landing-actions"><Link className="landing-signin" to="/login">Sign in</Link><Link className="landing-primary small" to="/register">Get started <ArrowRight /></Link></div>
    </nav></header>
    <section className="landing-hero">
      <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
      <div className="hero-inner">
        <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> AI-powered accounts receivable intelligence</span>
          <h1>Turn Receivables Data Into Smarter Financial Decisions.</h1>
          <p className="hero-lede">Predict late payments, estimate payment delays and understand customer behaviour with explainable AI-powered accounts receivable intelligence.</p>
          <div className="hero-ctas"><Link to="/register" className="landing-primary">Get started <ArrowRight /></Link><Link to="/login" className="landing-secondary">Sign in</Link></div>
          <div className="hero-proof"><span><Check /> Three complementary models</span><span><Check /> Explainable insights</span><span><Check /> Role-based access</span></div>
        </div>
        <DashboardIllustration />
      </div>
      <a className="hero-scroll" href="#models"><span>Explore the platform</span><ArrowDown /></a>
    </section>
    <section className="landing-section model-section" id="models">
      <div className="section-heading"><span className="section-kicker">Three trained capabilities</span><h2>One receivables picture.<br className="desktop-break" /> Three useful perspectives.</h2><p>Each model answers a different question about your invoices and customers.</p></div>
      <div className="model-grid">{models.map((model) => <article className={`model-card ${model.color}`} key={model.title}><div className="model-card-top"><span className="model-icon"><model.icon /></span><span className="model-algorithm">{model.algorithm}</span></div><h3>{model.title}</h3><p>{model.description}</p><ul>{model.bullets.map((bullet) => <li key={bullet}><Check />{bullet}</li>)}</ul></article>)}</div>
      <p className="evaluation-note"><ShieldCheck /> Model evaluation results describe recorded evaluation data and are not guarantees of production performance.</p>
    </section>
    <section className="how-section" id="how-it-works"><div className="landing-section"><div className="section-heading"><span className="section-kicker">A clear workflow</span><h2>From raw data to confident action.</h2><p>Keep your receivables process connected from import through analysis and reporting.</p></div>
      <div className="steps-grid">{[{ icon: Database, n: "01", title: "Bring in your data", text: "Upload invoice and customer CSV files into your workspace." },{ icon: FileCheck2, n: "02", title: "Review and prepare", text: "Validate dataset quality and prepare fields for analysis." },{ icon: Sparkles, n: "03", title: "Understand the signals", text: "Explore risk, delay predictions and customer segments." },{ icon: BarChart3, n: "04", title: "Share the picture", text: "Use dashboards and reports to guide your next steps." }].map((step, i) => <article className="step-card" key={step.n}><div className="step-top"><span className="step-icon"><step.icon /></span><span>{step.n}</span></div><h3>{step.title}</h3><p>{step.text}</p>{i < 3 ? <ChevronRight className="step-arrow" /> : null}</article>)}</div>
    </div></section>
    <section className="platform-section landing-section" id="platform"><div className="platform-intro"><span className="section-kicker">Built for the work behind the numbers</span><h2>Useful intelligence, connected to your workflow.</h2><p>FlowCred AI brings data management, model outputs and financial reporting together in a role-aware workspace.</p><Link to="/register" className="text-link">Explore FlowCred AI <ArrowRight /></Link></div>
      <div className="platform-features"><article><span><Database /></span><div><h3>Dataset management</h3><p>Upload, validate and review your receivables data in one place.</p></div></article><article><span><Layers3 /></span><div><h3>Explainable AI</h3><p>See model context and the factors behind the signals you review.</p></div></article><article><span><CircleDollarSign /></span><div><h3>Financial intelligence</h3><p>Bring risk, delay and customer views together with reporting.</p></div></article><article id="security"><span><LockKeyhole /></span><div><h3>Security and access</h3><p>JWT-based authentication and role-based permissions managed by the backend.</p></div></article></div>
    </section>
    <section className="landing-cta"><div className="cta-mark"><Workflow /></div><div><span className="section-kicker">Receivables intelligence starts here</span><h2>Make your receivables data easier to act on.</h2><p>Explore risk, payment timing and customer behaviour in one workspace.</p></div><div className="cta-actions"><Link to="/register" className="landing-primary">Create an account <ArrowRight /></Link><Link to="/login" className="landing-secondary">Sign in</Link></div></section>
    <footer className="landing-footer"><Link to="/" className="landing-brand"><span className="landing-brand-icon"><BrandMark /></span><span><b>{APP_NAME}</b><small>Receivables Intelligence</small></span></Link><p>Explainable intelligence for accounts receivable.</p><div><a href="#models">Models</a><Link to="/login">Sign in</Link><Link to="/register">Get started</Link></div><small className="copyright">© {new Date().getFullYear()} FlowCred AI</small></footer>
  </main>;
}

function DashboardIllustration() {
  return <div className="dashboard-art" aria-label="Illustration of the FlowCred AI analytics workspace" role="img"><div className="art-window"><div className="art-sidebar"><div className="art-logo"><BrandMark /><span>FlowCred AI</span></div>{["Overview", "Invoices", "Payment Risk", "Delay Predictions", "Customers", "Segments", "Reports"].map((label, i) => <div className={`art-nav ${i === 0 ? "active" : ""}`} key={label}><span>{["◈", "▤", "◉", "⌁", "♙", "◌", "▧"][i]}</span>{label}</div>)}</div><div className="art-main"><div className="art-topline"><span><small>ILLUSTRATIVE WORKSPACE</small><b>Portfolio overview</b></span><span className="art-period">Dashboard preview</span></div><div className="art-stats"><div><small>Total invoices</small><b>—</b><em>Portfolio volume</em></div><div className="risk"><small>Late-payment risk</small><b>—</b><em>Model output</em></div><div><small>Predicted delay</small><b>—</b><em>Signed day estimate</em></div></div><div className="art-panels"><div className="art-chart"><div className="art-panel-head"><b>Payment risk trend</b><span>Illustrative view</span></div><div className="chart-plot"><div className="chart-lines"/><svg viewBox="0 0 440 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 118 C42 112 48 124 88 105 S140 110 175 84 S220 92 265 68 S313 78 347 48 S397 57 440 21"/><path className="chart-fill" d="M0 118 C42 112 48 124 88 105 S140 110 175 84 S220 92 265 68 S313 78 347 48 S397 57 440 21 V150 H0Z"/><circle cx="440" cy="21" r="5"/></svg></div><div className="chart-months"><span>Risk</span><span>Delay</span><span>Customers</span></div></div><div className="art-segments"><div className="art-panel-head"><b>Customer segments</b><span>6 groups</span></div><div className="donut-wrap"><div className="donut"><span>6<small>segments</small></span></div><ul><li><i className="dot d1"/>Behaviour</li><li><i className="dot d2"/>Payments</li><li><i className="dot d3"/>Patterns</li></ul></div></div></div><div className="art-foot"><span><i /> Trained models</span><span>Model details →</span></div></div></div><div className="art-badge"><span><ShieldCheck /></span><div><b>Explainable signals</b><small>Risk · delay · behaviour</small></div></div></div>;
}

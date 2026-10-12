import { INSTALL_PROMPT } from "@/lib/install-prompt";
import { AgentInstall } from "@/components/agent-install";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, BookOpen, ChartNoAxesColumnIncreasing, Eye, FileSearch, FileText, Lock, Map, Pause, Play, Server, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ClientLogo } from "@/components/client-logo";
import { CopyButton } from "@/components/copy-button";
import { GitHubIcon } from "@/components/github-icon";
import { HomeFaq } from "@/components/home-faq";
import { QuestionLibrary } from "@/components/home-questions";
import { HomeUseCases } from "@/components/home-use-cases";
import { InstallWorkbench } from "@/components/install-workbench";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CLIENTS, MAINTAINER, QUICK_SETUP_COMMAND, TOKEN_DIR, pageHead, type Runtime } from "@/lib/site";
import { homeStructuredData, toJsonLd } from "@/lib/structured-data";

export const Route = createFileRoute("/")({
  head: () => {
    const structured = homeStructuredData();
    return {
      ...pageHead({
        path: "/",
        title: "Google Search Console MCP for your AI assistant | gsc-mcp",
        description:
          "Connect your AI assistant with a local Google Search Console MCP server. Analyze traffic, find search opportunities, and inspect indexing. Read-only by default.",
      }),
      scripts: structured.map((data) => ({
        type: "application/ld+json",
        children: toJsonLd(data),
      })),
    };
  },
  component: HomePage,
});

const HERO_RUNTIMES: readonly Runtime[] = ["node", "bun"];
const HERO_RUNTIME_LABEL = { bun: "bun", node: "npm" } as const;
// One brand entry for Claude; the client guide still covers Desktop and Code.
const NAMED_CLIENTS = CLIENTS.filter(
  (client) => client.kind !== "generic" && client.kind !== "print" && client.kind !== "code",
).map((client) => ({
  ...client,
  label: client.kind === "desktop" ? "Claude" : client.label,
  setupLabel: client.kind === "desktop" ? "Claude Desktop and Claude Code setup" : `${client.label} setup`,
}));

function HeroSetup() {
  const [runtime, setRuntime] = useState<Runtime | "agent" | "curl">("curl");
  return (
    <div id="hero-setup" className="home-setup">
      <Tabs value={runtime} onValueChange={(value) => setRuntime(value as Runtime | "agent" | "curl")} className="home-underline-tabs">
        <TabsList aria-label="Choose your installation method">
          <TabsTrigger value="curl">curl</TabsTrigger>
          {HERO_RUNTIMES.map((entry) => <TabsTrigger key={entry} value={entry}>{HERO_RUNTIME_LABEL[entry]}</TabsTrigger>)}
          <TabsTrigger value="agent">AI agent</TabsTrigger>
          <span className="home-terminal-label" aria-hidden="true"><Terminal className="size-3.5" />setup</span>
        </TabsList>
        {HERO_RUNTIMES.map((entry) => (
          <TabsContent key={entry} value={entry} className="home-command-row">
            <span className="home-command-prefix" aria-hidden="true">$</span>
            <pre tabIndex={0} role="group" aria-label={`${HERO_RUNTIME_LABEL[entry]} setup command: scrollable code`}>
              <code id={`hero-setup-${entry}`} tabIndex={-1}>{QUICK_SETUP_COMMAND[entry]}</code>
            </pre>
            <CopyButton text={QUICK_SETUP_COMMAND[entry]} label={`Copy ${HERO_RUNTIME_LABEL[entry]} setup command`} targetId={entry === runtime ? `hero-setup-${entry}` : undefined} className="home-copy" />
          </TabsContent>
        ))}
        <TabsContent value="curl" className="home-command-row">
          <span className="home-command-prefix" aria-hidden="true">$</span>
          <pre tabIndex={0} role="group" aria-label="curl installation command: scrollable code">
            <code id="hero-setup-curl" tabIndex={-1}>{"curl -fsSL https://gscmcp.dev/install.sh | sh"}</code>
          </pre>
          <CopyButton text="curl -fsSL https://gscmcp.dev/install.sh | sh" label="Copy curl installation command" targetId={runtime === "curl" ? "hero-setup-curl" : undefined} className="home-copy" />
        </TabsContent>
        <TabsContent value="agent" className="home-command-row items-start">
          <pre tabIndex={0} role="group" aria-label="AI agent installation prompt: scrollable text" className="whitespace-pre-wrap">
            <code id="hero-setup-agent" tabIndex={-1}>{INSTALL_PROMPT}</code>
          </pre>
          <CopyButton text={INSTALL_PROMPT} label="Copy AI agent installation prompt" targetId={runtime === "agent" ? "hero-setup-agent" : undefined} className="home-copy" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
const HERO_AGENTS = ["Codex.", "Claude.", "Cursor.", "AI Agent."] as const;

function HeroHeading() {
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const rotatorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const element = rotatorRef.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let hidden = document.hidden;
    setReducedMotion(preference.matches);
    setAutoPaused(!visible || hidden);
    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            setAutoPaused(!visible || hidden);
          },
          { threshold: 0 },
        )
      : null;
    const onVisibilityChange = () => {
      hidden = document.hidden;
      setAutoPaused(!visible || hidden);
    };
    const onPreferenceChange = () => {
      setReducedMotion(preference.matches);
    };
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (observer) observer.observe(element);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const rotatorClass = `home-agent-rotator${userPaused ? " home-agent-rotator--pinned" : ""}${autoPaused && !userPaused ? " home-agent-rotator--suspended" : ""}`;

  return (
    <>
      <h1 id="hero-heading">
        <span className="sr-only">Google Search Console MCP, inside your AI agent.</span>
        <span aria-hidden="true" className="home-hero-title">
          Google Search Console MCP
          <br />
          inside your{" "}
          <span ref={rotatorRef} className={rotatorClass}>
            {HERO_AGENTS.map((agent) => (
              <span key={agent} className="home-agent-word">
                {agent}
              </span>
            ))}
          </span>
        </span>
      </h1>
      <button
        type="button"
        className="home-rotator-toggle"
        disabled={reducedMotion}
        aria-label={userPaused ? "Resume animation" : "Pause animation"}
        title={reducedMotion ? "Animation is already off because your system prefers reduced motion." : userPaused ? "Resume animation" : "Pause animation"}
        aria-describedby={reducedMotion ? "hero-rotator-status" : undefined}
        onClick={() => setUserPaused((paused) => !paused)}
      >
        {userPaused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
      </button>
      {reducedMotion ? (
        <span id="hero-rotator-status" className="sr-only">
          Animation is off because your system prefers reduced motion.
        </span>
      ) : null}
    </>
  );
}

const TOOL_GROUPS = [
  { name: "Performance", icon: ChartNoAxesColumnIncreasing, description: "Compare clicks, impressions and CTR to understand what changed." },
  { name: "Search opportunities", icon: FileText, description: "Find searches and pages with room to grow." },
  { name: "URL indexing", icon: FileSearch, description: "Check whether a page is indexed and investigate issues." },
  { name: "Sitemaps", icon: Map, description: "Review your submitted sitemaps and spot errors or warnings." },
];

function HomePage() {
  const [question, setQuestion] = useState("traffic");
  return (
    <div data-home-theme>
      <section className="home-hero home-container" aria-labelledby="hero-heading">
        <div className="home-hero-content">
          <HeroHeading />
          <p className="home-hero-description">Connect your assistant to a local Google Search Console MCP.<br className="hidden sm:block" /> Analyze performance, explore queries, and inspect URLs.</p>
          <HeroSetup />
          <div className="home-hero-actions">
            <Button asChild size="lg" className="home-primary h-auto max-w-full min-h-11 py-2 text-center leading-snug whitespace-normal"><Link to="/docs">Read the setup guide<ArrowRight aria-hidden="true" /></Link></Button>
            <Button asChild size="lg" variant="secondary" className="home-secondary h-auto max-w-full min-h-11 py-2 text-center leading-snug whitespace-normal"><a href="#use-cases"><BookOpen aria-hidden="true" />Explore use cases</a></Button>
          </div>
          <ul className="home-product-facts">
            <li><ShieldCheck aria-hidden="true" />29 tools</li>
            <li><Lock aria-hidden="true" />Read-only by default</li>
            <li><Server aria-hidden="true" />Runs locally</li>
            <li><Eye aria-hidden="true" />Provider-visible results</li>
          </ul>
        </div>
        <div className="home-clients">
          <p>Works with the tools you already use</p>
          <ul>
            {NAMED_CLIENTS.map((client) => (
              <li key={client.kind}>
                <Link to="/docs/clients" aria-label={client.setupLabel} className="home-client-link">
                  <ClientLogo kind={client.kind} />
                  <span>{client.label}</span>
                </Link>
              </li>
            ))}
            <li>
              <a href="https://opencode.ai/docs/mcp-servers/#local" target="_blank" rel="noreferrer" aria-label="OpenCode local MCP setup, external guide" className="home-client-link">
                <ClientLogo kind="opencode" /><span>OpenCode</span>
              </a>
            </li>
            <li className="home-client-other">
              <Link to="/docs/clients" className="home-client-link">
                <span className="home-client-more" aria-hidden="true">···</span>
                <span>Other MCP clients</span>
                <ArrowRight aria-hidden="true" className="home-client-arrow" />
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <HomeUseCases onSelectQuestion={setQuestion} />

      <section id="tools" aria-labelledby="tools-heading" className="home-container home-tools">
        <div className="home-tools-heading home-section-heading">
          <div><p className="home-section-label">Tools</p><h2 id="tools-heading">Your Google Search Console MCP toolkit.</h2><p>Four ways to put your Search Console data to work.</p></div>
          <Link to="/docs/commands" className="home-text-link">Explore all tools<ArrowRight aria-hidden="true" className="size-4" /></Link>
        </div>
        <div className="home-tool-grid">
          {TOOL_GROUPS.map((group) => (
            <div key={group.name} className="home-tool-group">
              <h3><span><group.icon aria-hidden="true" /></span>{group.name}</h3>
              <p>{group.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-container home-question-section" aria-label="Copy an example question"><QuestionLibrary value={question} onValueChange={setQuestion} /></section>

      <section aria-labelledby="workflow-heading" className="home-container home-workflow">
        <div className="home-section-heading"><p className="home-section-label">Local by design</p><h2 id="workflow-heading">Your machine. Your credentials. Your choice.</h2><p>This MCP for Google Search Console runs locally, with permissions you control.</p></div>
        <div className="home-trust-grid">
          <div><Lock aria-hidden="true" /><h3>Credentials stay local</h3><p>Tokens stay in <code>{TOKEN_DIR}</code> on your machine. This website never runs your queries or collects credentials.</p></div>
          <div><ShieldCheck aria-hidden="true" /><h3>Start with read-only</h3><p>Quick Connect is read-only. Write operations require explicit full access and your own OAuth client or service account.</p></div>
          <div><Eye aria-hidden="true" /><h3>Know where answers go</h3><p>Your MCP client and its AI provider see the tool results used to answer your questions.</p><Link to="/privacy" className="home-text-link">Read the privacy details<ArrowRight aria-hidden="true" className="size-4" /></Link></div>
        </div>
      <div id="install" className="home-install-section">
        <details className="home-install-details">
          <summary><span><Terminal aria-hidden="true" /><span>Install with your AI agent<small>Copy a prompt for Codex, Claude, Cursor, or another agent</small></span></span><ArrowRight aria-hidden="true" className="home-install-arrow" /></summary>
          <div className="home-install-content"><AgentInstall /></div>
        </details>
        <details className="home-install-details">
          <summary><span><Terminal aria-hidden="true" /><span>Set up your local connection<small>Runtime, credentials, client configuration, and verification</small></span></span><ArrowRight aria-hidden="true" className="home-install-arrow" /></summary>
          <div className="home-install-content"><InstallWorkbench id="install-guide" /></div>
        </details>
      </div>
      </section>

      <HomeFaq />

      <section aria-labelledby="close-heading" className="home-container home-close">
        <div className="home-close-band">
          <span className="home-close-mark"><BrandMark className="size-8" /></span>
          <div><h2 id="close-heading">Connect your Google Search Console MCP.</h2><p>Read the guide, connect locally, and start with a question.</p></div>
          <div className="home-close-actions">
            <Button asChild size="lg" className="home-primary"><Link to="/docs">Get started<ArrowRight aria-hidden="true" /></Link></Button>
            <Button asChild size="lg" variant="secondary" className="home-secondary"><a href={MAINTAINER.github} target="_blank" rel="noreferrer"><GitHubIcon className="size-4" />GitHub</a></Button>
          </div>
        </div>
      </section>
    </div>
  );
}

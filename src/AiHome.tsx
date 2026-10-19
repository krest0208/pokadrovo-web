import * as React from "react";
import BrandMark from "./BrandMark";
import { copy as t } from "./layered-copy";
import { frames } from "./layered-assets";
import "./ai-home.css";
import { HomeScrollMotion } from "./home-scroll";
import "./home-scroll.css";

type RecentProject = { id: string; name: string; count: number; modified: number };
export type AiHomeProps = {
  theme: "light" | "dark";
  account?: { id:string;name:string;role:string } | null;
  onAccount?: () => void;
  onAdmin?: () => void;
  guestMode?: boolean;
  registrationEnabled?: boolean;
  onSignIn?: () => void;
  onToggleTheme: () => void;
  onCreate: (prompt: string) => void;
  onContinue: () => void;
  onImport: (files: FileList | null, prompt: string) => void;
  onOpenProject: (id: string) => void;
  projects: RecentProject[];
};
type State = {
  prompt: string; scene: number; step: number; expanded: boolean;
  motionOff: boolean; menuOpen: boolean; mediaOpen: boolean;
  files: FileList | null; error: string; draftSaved: boolean; depth: number;
};
type Glyph = "arrow" | "up" | "paperclip" | "moon" | "sun" | "layers" | "play" | "pause" | "close" | "check" | "folder" | "menu" | "plus" | "chevron";
const paths: Record<Glyph, string> = {
  arrow: "M4 12h15m-6-6 6 6-6 6", up: "M5 19 19 5M5 5h14v14",
  paperclip: "m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9",
  moon: "M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z",
  sun: "M12 3V1m0 22v-2M3 12H1m22 0h-2M5 5 3.5 3.5M20.5 20.5 19 19M5 19l-1.5 1.5M20.5 3.5 19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  layers: "m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4",
  play: "m8 4 12 8L8 20V4Z", pause: "M8 5v14M16 5v14",
  close: "m6 6 12 12M6 18 18 6", check: "m5 12 5 5L20 7",
  folder: "M3 6h7l2 3h9v11H3V6Z", menu: "M4 7h16M4 12h16M4 17h16",
  plus: "M12 5v14M5 12h14", chevron: "m8 4 8 8-8 8"
};
function Icon({ name, size = 18 }: { name: Glyph; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
const shots = [
  { image: frames.launch, label: t.frameLaunch, number: "001", time: "00:00:04" },
  { image: frames.portrait, label: t.framePortrait, number: "002", time: "00:00:11" },
  { image: frames.universe, label: t.frameUniverse, number: "003", time: "00:00:18" }
];
const stepContent = [
  { title: t.stepOne, body: t.stepOneCopy },
  { title: t.stepTwo, body: t.stepTwoCopy },
  { title: t.stepThree, body: t.stepThreeCopy }
];

/**
 * Replaces AiHome only. All seven existing editor callback contracts are unchanged.
 * No API calls, external assets, new dependencies or video-generation claims.
 */
export default class AiHome extends React.Component<AiHomeProps, State> {
  state: State = { prompt: "", scene: 0, step: 0, expanded: false, motionOff: false,
    menuOpen: false, mediaOpen: false, files: null, error: "", draftSaved: false, depth: 0 };
  private root: HTMLDivElement | null = null;
  private stage: HTMLDivElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private dialog: HTMLDivElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private frame = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private urls: string[] = [];
  private mediaUrl = "";
  private mediaKind: "image" | "video" = "image";
  private motionQuery: MediaQueryList | null = null;
  private motion: HomeScrollMotion | null = null;

  componentDidMount() {
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    try {
      const prompt = localStorage.getItem("pokadrovo.home.brief.v3:" + (this.props.account?.id || "guest")) || "";
      const motionOff = localStorage.getItem("pokadrovo.home.motion.v3") === "off";
      this.setState({ prompt: prompt.slice(0, 1600), motionOff });
    } catch { /* Private browsing may disable persistence; editing still works. */ }
    document.addEventListener("keydown", this.onKey);
    this.motionQuery.addEventListener("change", this.onMotionPreference);
    if (this.root) this.motion = new HomeScrollMotion(this.root, {
      reduced: this.reduced,
      blocked: () => this.state.mediaOpen,
      heroHasFiles: () => !!this.state.files?.length,
      nextFrame: () => this.setState(previous => ({ scene: (previous.scene + 1) % shots.length })),
      nextStep: () => this.setState(previous => ({ step: (previous.step + 1) % stepContent.length }))
    });
  }
  componentDidUpdate(_previousProps: AiHomeProps, previousState: State) {
    if (_previousProps.account?.id !== this.props.account?.id) {
      try { this.setState({prompt:localStorage.getItem("pokadrovo.home.brief.v3:" + (this.props.account?.id || "guest")) || "", files:null}); } catch {}
    }
    if (previousState.motionOff !== this.state.motionOff || previousState.mediaOpen !== this.state.mediaOpen || previousState.files !== this.state.files) {
      this.motion?.refresh();
    }
  }
  private onMotionPreference = () => {
    if (this.reduced()) this.resetPointer();
    this.forceUpdate(() => this.motion?.refresh());
  };
  componentWillUnmount() {
    this.motion?.dispose();
    this.motionQuery?.removeEventListener("change", this.onMotionPreference);
    document.removeEventListener("keydown", this.onKey);
    cancelAnimationFrame(this.frame);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.urls.forEach(url => URL.revokeObjectURL(url));
  }
  private reduced = () => this.state.motionOff || !!this.motionQuery?.matches;
  private onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (this.state.mediaOpen) this.closeMedia();
      this.setState({ menuOpen: false });
    }
    if (event.key === "Tab" && this.state.mediaOpen && this.dialog) {
      const elements = Array.from(this.dialog.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']"));
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  private scrollTo = (id: string) => {
    this.setState({ menuOpen: false });
    this.root?.querySelector(`#${id}`)?.scrollIntoView({ behavior: this.reduced() ? "auto" : "smooth", block: "start" });
  };
  private focusIdea = () => {
    this.root?.querySelector(".pkh-composer")?.scrollIntoView({ behavior: this.reduced() ? "auto" : "smooth", block: "center" });
    this.textarea?.focus({ preventScroll: true });
  };
  private setPrompt = (prompt: string) => {
    this.setState({ prompt: prompt.slice(0, 1600), draftSaved: false });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { localStorage.setItem("pokadrovo.home.brief.v3:" + (this.props.account?.id || "guest"), this.state.prompt); this.setState({ draftSaved: true }); }
      catch { /* No persistence claim when storage is unavailable. */ }
    }, 350);
  };
  private choosePrompt = (prompt: string) => { this.setPrompt(prompt); this.focusIdea(); };
  private toggleMotion = () => {
    const motionOff = !this.state.motionOff;
    this.setState({ motionOff });
    if (motionOff) this.resetPointer();
    try { localStorage.setItem("pokadrovo.home.motion.v3", motionOff ? "off" : "on"); } catch {}
  };
  private onPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!this.stage || this.reduced()) return;
    const rect = this.stage.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.stage?.style.setProperty("--mx", `${(x * 8).toFixed(2)}px`);
      this.stage?.style.setProperty("--my", `${(y * 6).toFixed(2)}px`);
    });
  };
  private resetPointer = () => {
    cancelAnimationFrame(this.frame);
    this.stage?.style.setProperty("--mx", "0px");
    this.stage?.style.setProperty("--my", "0px");
  };
  private onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files?.length) return;
    if (Array.from(files).some(file => !/^(video|image)\//.test(file.type))) {
      this.setState({ error: t.unsupported }); event.currentTarget.value = ""; return;
    }
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = [];
    this.mediaUrl = URL.createObjectURL(files[0]); this.urls.push(this.mediaUrl);
    this.mediaKind = files[0].type.startsWith("video/") ? "video" : "image";
    this.setState({ files, error: "" });
  };
  private clearFiles = () => {
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; this.mediaUrl = "";
    if (this.fileInput) this.fileInput.value = "";
    this.setState({ files: null, error: "" });
  };
  private create = (event?: React.FormEvent) => {
    event?.preventDefault();
    try { localStorage.setItem("pokadrovo.home.brief.v3:" + (this.props.account?.id || "guest"), this.state.prompt); } catch {}
    if (this.state.files?.length) this.props.onImport(this.state.files, this.state.prompt.trim());
    else this.props.onCreate(this.state.prompt.trim());
  };
  private openMedia = () => {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.setState({ mediaOpen: true }, () => this.dialog?.querySelector<HTMLButtonElement>("button")?.focus());
  };
  private closeMedia = () => {
    this.setState({ mediaOpen: false }, () => this.lastFocus?.focus());
  };

  render() {
    const { theme, onToggleTheme, onContinue, projects, onOpenProject } = this.props;
    const { prompt, scene, step, expanded, motionOff, menuOpen, files, error, mediaOpen, depth } = this.state;
    const chosen = shots[scene];
    const previewImage = files?.length && this.mediaKind === "image" ? this.mediaUrl : chosen.image;
    return <div className="pkh" data-theme={theme} data-motion={this.reduced() ? "off" : "on"} ref={node => { this.root = node; }}>
      <header className="pkh-header">
        <button className="pkh-brand" type="button" aria-label={t.brand} onClick={() => this.scrollTo("pkh-main")}><BrandMark size={35}/><span>{t.brand}<small>AI VIDEO STUDIO</small></span></button>
        <nav className={`pkh-nav ${menuOpen ? "is-open" : ""}`} aria-label={t.menu}>
          <button type="button" onClick={() => this.scrollTo("pkh-method")}>{t.navWorkflow}</button>
          <button type="button" onClick={() => this.scrollTo("pkh-projects")}>{t.navProjects}</button>
          {this.props.account?.role==='owner'&&this.props.onAdmin&&<button type="button" onClick={this.props.onAdmin}>Админ-панель</button>}
          {this.props.registrationEnabled&&!this.props.account&&<button type="button" onClick={this.props.onSignIn}>Войти</button>}
        </nav>
        <div className="pkh-header-right">
          <button className="pkh-theme" type="button" aria-label={theme === "light" ? t.themeDark : t.themeLight} title={theme === "light" ? t.themeDark : t.themeLight} onClick={onToggleTheme}><Icon name={theme === "light" ? "moon" : "sun"}/></button>
<button className="pkh-editor-link" type="button" onClick={this.props.onAccount || onContinue}><Icon name={this.props.account || this.props.guestMode ? 'folder' : 'plus'} size={15}/><span>{this.props.account ? 'Мой профиль' : this.props.registrationEnabled ? 'Создать аккаунт' : 'Мои проекты'}</span><Icon name="arrow" size={16}/></button>
          <button className="pkh-menu" type="button" aria-label={t.menu} aria-expanded={menuOpen} onClick={() => this.setState({ menuOpen: !menuOpen })}><Icon name={menuOpen ? "close" : "menu"}/></button>
        </div>
      </header>

      <main id="pkh-main">
        <section className="pkh-hero" aria-labelledby="pkh-heading">

          <div className="pkh-hero-copy" data-scroll-scene="intro">
            <p className="pkh-eyebrow"><span className="pkh-cross"/>{t.eyebrow}</p>
            <h1 id="pkh-heading">{t.headline1}<br/><span className="pkh-heading-selected">{t.headline2}<i className="pkh-selection-corner a"/><i className="pkh-selection-corner b"/><i className="pkh-selection-corner c"/><i className="pkh-selection-corner d"/></span></h1>
            <p className="pkh-lead">{t.lead}</p>
            <div className="pkh-short-note"><span className="pkh-hand-line" aria-hidden="true"/>{t.caption}</div>
          </div>

          <div className={`pkh-stage ${expanded ? "is-expanded" : ""}`} data-scroll-scene="hero" style={{ "--layer-depth": depth } as React.CSSProperties} ref={node => { this.stage = node; }} onMouseMove={this.onPointer} onMouseLeave={this.resetPointer}>
            <span className="pkh-ghost-title" aria-hidden="true">FRAME</span>
            <div className="pkh-frame-outline" aria-hidden="true"><span>SEQUENCE / 001</span><i/><b/></div>
            <div className="pkh-blue-print" aria-hidden="true"><span>POKADROVO</span><strong>BEYOND<br/>THE FRAME.</strong><i>STORY FIRST.</i></div>
            <div className="pkh-acetate-sheet" aria-hidden="true"><span>DIRECTOR'S CUT</span><i/><b>STORY / 001</b></div>
            <figure className="pkh-main-frame">
              <div className="pkh-frame-top"><span>{t.projectBadge}</span><span>{chosen.number} / 003</span></div>
              <button type="button" className="pkh-image-action" onClick={this.openMedia} aria-label={t.previewAlt}>
                {files?.length && this.mediaKind === "video" ? <video muted playsInline preload="metadata" src={this.mediaUrl} /> : <img key={files?.length ? this.mediaUrl : chosen.number} src={previewImage} alt={t.previewAlt} draggable={false} decoding="async"/>}
                <span className="pkh-frame-overlay"><small>{t.sceneKind}</small><strong>{files?.length ? files[0].name : t.sceneTitle}</strong></span>
                <span className="pkh-frame-open"><Icon name="up" size={21}/></span>
              </button>
              <figcaption><span>{t.sceneNote}</span><b>{chosen.time}</b></figcaption>
            </figure>
            <figure className="pkh-portrait-card" aria-hidden="true"><span className="pkh-tape"/><img src={frames.portrait} alt="" draggable={false}/><figcaption><b>002</b><span>{t.framePortrait}</span><i>24 / 36</i></figcaption></figure>
            <div className="pkh-note-paper"><span className="pkh-paper-pin"/><span className="pkh-note-cap">{t.noteTitle}</span><p>{t.noteText}</p><span className="pkh-note-sign">{t.noteSign}<span className="pkh-mini-arrow" aria-hidden="true"/></span></div>
            <div className="pkh-contact-strip" aria-label={t.selectFrame}>{shots.map((shot, index) => <button key={shot.number} type="button" className={scene === index ? "is-selected" : ""} onClick={() => this.setState({ scene: index })} aria-label={`${t.selectFrame}: ${shot.label}`} aria-pressed={scene === index}><span className="pkh-film-perf"/><img src={shot.image} alt=""/><span className="pkh-strip-label">{shot.number}<i>{shot.label}</i></span></button>)}<span className="pkh-strip-time" aria-hidden="true">00 : 00 : 18</span></div>
            <div className="pkh-stage-controls"><span className="pkh-autoplay-label">Кадры оживают при прокрутке</span><label className="pkh-depth-control"><span>Глубина</span><input type="range" min="0" max="100" step="1" value={Math.round(depth * 100)} aria-label="Глубина композиции" onChange={event => this.setState({ depth: Number(event.currentTarget.value) / 100, expanded: Number(event.currentTarget.value) > 0 })}/></label><button type="button" className="pkh-layer-toggle" aria-pressed={expanded} onClick={() => this.setState({ expanded: !expanded, depth: expanded ? 0 : 1 })}><Icon name="layers" size={15}/>{expanded ? t.collapse : t.expand}</button><button type="button" className="pkh-motion-toggle" onClick={this.toggleMotion} title={motionOff ? t.resumeMotion : t.pauseMotion} aria-label={motionOff ? t.resumeMotion : t.pauseMotion} aria-pressed={motionOff}><Icon name={motionOff ? "play" : "pause"} size={14}/></button></div>
          </div>

          <div className="pkh-composer-wrap" data-scroll-scene="brief">
            <div className="pkh-composer-underlay" aria-hidden="true"><span>BRIEF / 001</span></div>
            <form className="pkh-composer" onSubmit={this.create}>
              <div className="pkh-composer-top"><label htmlFor="pkh-idea">{t.briefLabel}</label><span>YOUR DIRECTOR'S NOTE</span></div>
              <textarea ref={node => { this.textarea = node; }} id="pkh-idea" maxLength={1600} rows={3} value={prompt} placeholder={t.briefPlaceholder} onChange={event => this.setPrompt(event.currentTarget.value)}/>
              {files?.length ? <div className="pkh-files"><span><Icon name="layers" size={13}/>{t.files}: {files.length}</span><b title={Array.from(files).map(f => f.name).join(", ")}>{Array.from(files).map(f => f.name).join(", ")}</b><button type="button" title={t.clearFiles} aria-label={t.clearFiles} onClick={this.clearFiles}><Icon name="close" size={14}/></button></div> : null}
              <div className="pkh-composer-bottom"><input ref={node => { this.fileInput = node; }} type="file" accept="video/*,image/*" multiple hidden onChange={this.onFiles}/><button className="pkh-attach" type="button" onClick={() => this.fileInput?.click()}><Icon name="paperclip" size={16}/>{files?.length ? t.attachMore : t.attach}</button><span className="pkh-char-count">{prompt.length}/1600</span><button className="pkh-submit" type="submit">{t.create}<Icon name="arrow" size={18}/></button></div>
              {error && <p className="pkh-error" role="alert">{error}</p>}
            </form>
            <div className="pkh-presets"><span>{t.tryLabel}</span>{[{ label: t.presetTravel, prompt: t.promptTravel }, { label: t.presetProduct, prompt: t.promptProduct }, { label: t.presetShort, prompt: t.promptShort }].map(preset => <button key={preset.label} type="button" onClick={() => this.choosePrompt(preset.prompt)}>{preset.label}<Icon name="up" size={12}/></button>)}</div>
            <p className="pkh-honest-note">{t.disclaimer}</p>
          </div>
          <div className="pkh-hero-bottom"><span><i/>{t.statusCurrent}</span><span>{t.local}</span><span>MAKE THE CUT.</span></div>
        </section>

        <section className="pkh-method" data-scroll-scene="process" id="pkh-method" aria-labelledby="pkh-method-title">
          <div className="pkh-method-left"><div className="pkh-section-id"><span>THE PROCESS</span><i/></div><h2 id="pkh-method-title">{t.workflowTitle1}<br/><span>{t.workflowTitle2}</span></h2><p className="pkh-section-lead">{t.workflowLead}</p>
            <div className="pkh-steps" role="tablist" aria-orientation="vertical" aria-label={t.navWorkflow}>{stepContent.map((item, index) => <button type="button" role="tab" id={`pkh-step-${index}`} aria-controls="pkh-method-panel" aria-selected={step === index} tabIndex={step === index ? 0 : -1} onKeyDown={event => { let next = index; if(event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % stepContent.length; else if(event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index + stepContent.length - 1) % stepContent.length; else if(event.key === "Home") next = 0; else if(event.key === "End") next = stepContent.length - 1; else return; event.preventDefault(); this.setState({ step: next }, () => this.root?.querySelector<HTMLButtonElement>(`#pkh-step-${next}`)?.focus()); }} className={step === index ? "is-active" : ""} key={item.title} onClick={() => this.setState({ step: index })}><span>0{index + 1}</span><div><strong>{item.title}</strong>{step === index && <p>{item.body}</p>}</div><Icon name="up" size={18}/></button>)}</div>
            <button className="pkh-method-cta" type="button" onClick={onContinue}>{t.openEditor}<Icon name="arrow" size={17}/></button>
          </div>
          <div className={`pkh-method-art step-${step}`} id="pkh-method-panel" role="tabpanel" aria-labelledby={`pkh-step-${step}`}>
            <span className="pkh-cut-guide vertical" aria-hidden="true"/><span className="pkh-cut-guide horizontal" aria-hidden="true"/>
            <div className="pkh-sheet-back" aria-hidden="true"><span>POKADROVO / NOTES</span><i/><i/><i/></div>
            <div className="pkh-director-sheet"><span className="pkh-sheet-fold"/><div className="pkh-sheet-heading"><BrandMark size={25}/><span>{t.sheetPlan}</span><b>0{step + 1}</b></div><h3>{stepContent[step].title}</h3><p>{stepContent[step].body}</p><div className="pkh-sheet-list">{[t.sheetBegin,t.sheetMiddle,t.sheetEnd].map((line,index) => <div key={line}><span>{index === step ? <Icon name="check" size={13}/> : `0${index+1}`}</span><b>{line}</b><i/></div>)}</div><span className="pkh-sheet-sign">{t.noteSign}</span></div>
            <div className="pkh-mini-film"><img key={step} src={shots[step].image} alt={shots[step].label} decoding="async"/><span><Icon name="layers" size={13}/>{shots[step].number}<i>{shots[step].label}</i></span></div>
            <div className="pkh-index-label" aria-hidden="true">STORY / NOT JUST EFFECTS</div>
          </div>
        </section>

        <section className="pkh-vision" data-scroll-scene="vision" aria-labelledby="pkh-vision-title">
          <div className="pkh-vision-paper"><span className="pkh-section-id">{t.visionEyebrow}</span><h2 id="pkh-vision-title">{t.visionTitle}</h2><p>{t.visionCopy}</p><small>{t.visionStatus}</small></div>
          <div className="pkh-roadmap">{[{ title:t.roadmap1, body:t.roadmap1text },{ title:t.roadmap2, body:t.roadmap2text },{ title:t.roadmap3, body:t.roadmap3text }].map((item,index) => <article key={item.title}><span>0{index+1}</span><div><h3>{item.title}</h3><p>{item.body}</p></div><b>{t.planned}</b></article>)}</div>
        </section>

        <section className="pkh-recent" data-scroll-scene="projects" id="pkh-projects" aria-labelledby="pkh-recent-title"><div className="pkh-recent-heading"><h2 id="pkh-recent-title">{t.recentTitle}</h2><Icon name="folder" size={23}/></div>{projects.length ? <div className="pkh-project-list">{projects.slice(0,4).map(project => <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}><BrandMark size={31}/><span><strong>{project.name}</strong><small>{project.count} {t.clips} / {new Date(project.modified).toLocaleDateString("ru-RU")}</small></span><Icon name="up" size={17}/></button>)}</div> : <div className="pkh-no-projects"><p>{this.props.account || this.props.guestMode ? 'Ваш первый ролик начинается здесь.' : 'Войдите, чтобы открыть свои проекты.'}</p><button className="pkh-method-cta" type="button" onClick={onContinue}>{this.props.account || this.props.guestMode ? 'Создать проект' : 'Войти и открыть проекты'}<Icon name="arrow" size={16}/></button></div>}</section>

        <section className="pkh-faq" data-scroll-scene="faq"><h2>{t.faqTitle}</h2><div>{[{ q:t.faqQuestion1, a:t.faqAnswer1 },{ q:t.faqQuestion2, a:t.faqAnswer2 },{ q:t.faqQuestion3, a:t.faqAnswer3 }].map(item => <details key={item.q}><summary>{item.q}<Icon name="plus" size={17}/></summary><p>{item.a}</p></details>)}</div></section>
      </main>
      <footer className="pkh-footer" data-scroll-scene="footer"><div><BrandMark size={29}/><span>{t.brand}</span></div><p>{t.footerTag}</p><span>{t.footerNote}</span></footer>

      {mediaOpen && <div className="pkh-modal-shade" onClick={event => { if (event.target === event.currentTarget) this.closeMedia(); }}><div className="pkh-media-dialog" ref={node => { this.dialog = node; }} role="dialog" aria-modal="true" aria-labelledby="pkh-media-caption"><button className="pkh-modal-close" type="button" aria-label={t.close} onClick={this.closeMedia}><Icon name="close" size={22}/></button>{files?.length && this.mediaKind === "video" ? <video src={this.mediaUrl} controls playsInline/> : <img src={previewImage} alt={t.previewAlt}/>}<div><span id="pkh-media-caption">{files?.length ? files[0].name : `${t.sceneTitle} / ${chosen.label}`}</span><button type="button" onClick={() => { this.setState({ mediaOpen: false }, () => this.choosePrompt(t.promptTravel)); }}>{t.chooseMood}<Icon name="arrow" size={15}/></button></div></div></div>}
    </div>;
  }
}

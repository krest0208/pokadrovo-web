/** Local, viewport-scoped motion. No API, React dependency or background polling. */
export type ScrollSceneOptions = {
  reduced: () => boolean;
  blocked: () => boolean;
  heroHasFiles: () => boolean;
  nextFrame: () => void;
  nextStep: () => void;
};

type Scene = {
  node: HTMLElement;
  name: string;
  visible: boolean;
  hovered: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  cleanups: (() => void)[];
};

export class HomeScrollMotion {
  private observer: IntersectionObserver | null = null;
  private scenes: Scene[] = [];
  private disposed = false;

  constructor(private root: HTMLElement, private options: ScrollSceneOptions) {
    this.scenes = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-scene]')).map(node => ({
      node, name: node.dataset.scrollScene || '', visible: false, hovered: false, timer: null, cleanups: []
    }));
    for (const scene of this.scenes) {
      const enter = () => { scene.hovered = true; this.stopTimer(scene); };
      const leave = () => { scene.hovered = false; this.schedule(scene); };
      const focusIn = () => this.stopTimer(scene);
      // Focus moves before the next task. Defer without an untracked timer.
      const focusOut = () => queueMicrotask(() => { if (!this.disposed) this.schedule(scene); });
      scene.node.addEventListener('mouseenter', enter);
      scene.node.addEventListener('mouseleave', leave);
      scene.node.addEventListener('focusin', focusIn);
      scene.node.addEventListener('focusout', focusOut);
      scene.cleanups.push(() => {
        scene.node.removeEventListener('mouseenter', enter);
        scene.node.removeEventListener('mouseleave', leave);
        scene.node.removeEventListener('focusin', focusIn);
        scene.node.removeEventListener('focusout', focusOut);
      });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const scene = this.scenes.find(item => item.node === entry.target);
          if (!scene) continue;
          scene.visible = entry.isIntersecting && entry.intersectionRatio >= 0.16;
          this.syncScene(scene);
        }
      }, { threshold: [0, 0.16], rootMargin: '0px 0px -5% 0px' });
      this.scenes.forEach(scene => this.observer?.observe(scene.node));
    }
    // No observer: retain a complete, static page instead of hiding content.
    document.addEventListener('visibilitychange', this.refresh);
  }

  refresh = () => {
    if (this.disposed) return;
    this.scenes.forEach(scene => this.syncScene(scene));
  };

  private canRun(scene: Scene) {
    return scene.visible && !document.hidden && !this.options.reduced() && !this.options.blocked();
  }

  private syncScene(scene: Scene) {
    const running = this.canRun(scene);
    const wasRunning = scene.node.dataset.motionActive === 'true';
    scene.node.dataset.motionActive = String(running);
    scene.node.dataset.sceneVisible = String(scene.visible);
    if (running && !wasRunning) {
      scene.node.dataset.motionVisits = String(Number(scene.node.dataset.motionVisits || 0) + 1);
    }
    if (running) this.schedule(scene);
    else this.stopTimer(scene);
    if (scene.name === 'hero') this.syncVideo(scene, running);
  }

  private syncVideo(scene: Scene, running: boolean) {
    const video = scene.node.querySelector<HTMLVideoElement>('.pkh-image-action video');
    if (!video) return;
    if (!running) { video.pause(); return; }
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    if (video.paused) void video.play().catch(() => {
      // Autoplay can be refused by browser policies; the explicit preview still works.
    });
  }

  private schedule(scene: Scene) {
    if (this.disposed || scene.timer !== null || !this.canRun(scene) || scene.hovered) return;
    if (scene.node.contains(document.activeElement)) return;
    if (scene.name === 'hero' && this.options.heroHasFiles()) return;
    const delay = scene.name === 'hero' ? 5200 : scene.name === 'process' ? 6200 : 0;
    if (!delay) return;
    scene.timer = setTimeout(() => {
      scene.timer = null;
      if (this.disposed || !this.canRun(scene)) return;
      if (!scene.hovered && !scene.node.contains(document.activeElement)) {
        if (scene.name === 'hero' && !this.options.heroHasFiles()) this.options.nextFrame();
        if (scene.name === 'process') this.options.nextStep();
      }
      this.schedule(scene);
    }, delay);
  }

  private stopTimer(scene: Scene) {
    if (scene.timer !== null) { clearTimeout(scene.timer); scene.timer = null; }
  }

  dispose() {
    this.disposed = true;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.refresh);
    this.scenes.forEach(scene => {
      this.stopTimer(scene);
      scene.cleanups.forEach(cleanup => cleanup());
      scene.node.querySelector<HTMLVideoElement>('.pkh-image-action video')?.pause();
      delete scene.node.dataset.motionActive;
    });
    this.scenes = [];
  }
}

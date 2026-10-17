/** Local, viewport-driven animation. No network requests or scroll polling. */
type RunningBlock = {
  node: HTMLElement;
  inside: boolean;
  entered: boolean;
  animations: Animation[];
};

export class ViewportMotion {
  private blocks: RunningBlock[] = [];
  private observer: IntersectionObserver | null = null;
  private alive = true;

  constructor(private root: HTMLElement, private disabled: () => boolean) {
    this.blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-motion-block]'))
      .map(node => ({ node, inside: false, entered: false, animations: [] }));
    this.blocks.forEach(block => { block.node.dataset.motionState = 'waiting'; });
    if (typeof IntersectionObserver === 'undefined') {
      this.blocks.forEach(block => { block.node.dataset.motionState = 'static'; });
      return; // Keep all content readable when viewport observation is unavailable.
    }
    this.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const block = this.blocks.find(item => item.node === entry.target);
        if (!block) return;
        // Hysteresis: start at 12%, pause only after the block leaves the viewport.
        if (entry.isIntersecting && entry.intersectionRatio >= .12) block.inside = true;
        else if (!entry.isIntersecting) block.inside = false;
        this.sync(block);
      });
    }, { threshold: [0, .12, .4], rootMargin: '0px 0px -24px 0px' });
    this.blocks.forEach(block => this.observer!.observe(block.node));
    document.addEventListener('visibilitychange', this.refresh);
    root.addEventListener('loadeddata', this.refresh, true);
  }

  private animate(block: RunningBlock, node: Element | null,
    keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    if (!node || typeof node.animate !== 'function') return;
    const animation = node.animate(keyframes, options);
    animation.pause();
    block.animations.push(animation);
  }

  private build(block: RunningBlock) {
    const { node } = block;
    const kind = node.dataset.motionBlock;
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    const reveal = (target: Element | null, x: number, y: number, delay = 0) =>
      this.animate(block, target,
        [{ translate: `${x}px ${y}px`, opacity: .78 }, { translate: '0px 0px', opacity: 1 }],
        { duration: 750, delay, easing: ease, fill: 'none' });
    const imagePan = (selector: string, duration: number) => {
      node.querySelectorAll(selector).forEach(target => this.animate(block, target,
        [{ transform: 'scale(1.01) translateX(0)' }, { transform: 'scale(1.065) translateX(-.8%)' }],
        { duration, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }));
    };
    if (kind === 'intro') {
      reveal(node.querySelector('h1'), -12, 0);
      reveal(node.querySelector('.pkh-lead'), 0, 10, 130);
    } else if (kind === 'frames') {
      ['.pkh-main-frame', '.pkh-portrait-card', '.pkh-note-paper', '.pkh-contact-strip']
        .forEach((selector, i) => reveal(node.querySelector(selector), i % 2 ? -9 : 9, 15, i * 110));
      imagePan('.pkh-image-action > img', 9000);
      this.animate(block, node.querySelector('.pkh-acetate-sheet'),
        [{ translate: '0px 0px' }, { translate: '-7px -5px' }],
        { duration: 5000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    } else if (kind === 'brief') {
      reveal(node.querySelector('.pkh-composer'), 0, 14);
      this.animate(block, node.querySelector('.pkh-composer-underlay'),
        [{ rotate: '-1deg' }, { rotate: '0deg' }], { duration: 1100, easing: ease });
    } else if (kind === 'process') {
      reveal(node.querySelector('h2'), -13, 0);
      node.querySelectorAll('.pkh-steps > button').forEach((target, i) => reveal(target, -11, 0, i * 100));
    } else if (kind === 'plan') {
      reveal(node.querySelector('.pkh-director-sheet'), 0, 25);
      reveal(node.querySelector('.pkh-mini-film'), 14, 5, 220);
      imagePan('.pkh-mini-film img', 8000);
      this.animate(block, node.querySelector('.pkh-sheet-back'),
        [{ translate: '0px 0px' }, { translate: '4px -5px' }],
        { duration: 5200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    } else if (kind === 'vision') {
      reveal(node.querySelector('h2'), 0, 15);
      reveal(node.querySelector('p'), 0, 10, 150);
      this.animate(block, node, [{ rotate: '-1.8deg' }, { rotate: '0deg' }],
        { duration: 1100, easing: ease });
    } else if (kind === 'roadmap') {
      node.querySelectorAll('article').forEach((target, i) => reveal(target, 20, 0, i * 150));
    } else if (kind === 'projects') {
      reveal(node.querySelector('.pkh-recent-heading'), 0, 12);
      node.querySelectorAll('.pkh-project-list > button,.pkh-no-projects')
        .forEach((target, i) => reveal(target, 0, 18, 100 + i * 100));
    } else if (kind === 'faq') {
      reveal(node.querySelector('h2'), -10, 0);
      node.querySelectorAll('details').forEach((target, i) => reveal(target, 0, 13, i * 110));
    } else if (kind === 'footer') {
      reveal(node.querySelector('div'), 0, 8);
      reveal(node.querySelector('p'), -8, 0, 120);
    }
    block.entered = true;
  }

  private sync(block: RunningBlock) {
    if (!this.alive) return;
    const reduced = this.disabled();
    const playing = block.inside && !document.hidden && !reduced;
    if (reduced) {
      block.animations.forEach(animation => animation.cancel());
      block.animations = [];
      block.entered = false;
    } else if (playing && !block.entered) this.build(block);
    block.node.dataset.motionState = reduced ? 'reduced' : playing ? 'playing' : block.entered ? 'paused' : 'waiting';
    block.animations.forEach(animation => {
      if (playing && animation.playState === 'paused') animation.play();
      else if (!playing && animation.playState === 'running') animation.pause();
    });
    block.node.querySelectorAll<HTMLVideoElement>('video[data-motion-media]').forEach(video => {
      if (playing) {
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        if (video.paused) void video.play().catch(() => {
          // Some devices prohibit autoplay even for muted video. Manual preview stays available.
          if (this.alive) video.dataset.autoplay = 'blocked';
        });
      } else if (!video.paused) video.pause();
    });
  }

  refresh = () => { if (this.alive && this.observer) this.blocks.forEach(block => this.sync(block)); };

  destroy() {
    this.alive = false;
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.refresh);
    this.root.removeEventListener('loadeddata', this.refresh, true);
    this.blocks.forEach(block => {
      block.animations.forEach(animation => animation.cancel());
      block.node.querySelectorAll<HTMLVideoElement>('video[data-motion-media]').forEach(video => video.pause());
    });
    this.blocks = [];
  }
}

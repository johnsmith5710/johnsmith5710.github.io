// Smooth scrolling for anchors (including logo home link)
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');

    if (href === '#' || href === '') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Hamburger menu toggle
const hamburger = document.querySelector('.hamburger');
const mainNav = document.querySelector('.main-nav');
const body = document.body;

if (hamburger && mainNav) {
  hamburger.addEventListener('click', () => {
    const expanded = hamburger.getAttribute('aria-expanded') === 'true';
    hamburger.setAttribute('aria-expanded', !expanded);
    mainNav.classList.toggle('active');
    body.classList.toggle('menu-open');
  });

  // Close menu when clicking outside
  document.addEventListener('click', e => {
    if (!mainNav.contains(e.target) && !hamburger.contains(e.target)) {
      hamburger.setAttribute('aria-expanded', 'false');
      mainNav.classList.remove('active');
      body.classList.remove('menu-open');
    }
  });

  // Close menu after clicking a link
  mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      hamburger.setAttribute('aria-expanded', 'false');
      mainNav.classList.remove('active');
      body.classList.remove('menu-open');
    });
  });
}

// Smooth progressive header shrink on scroll
const header = document.querySelector('.header');
const logoWrapper = document.querySelector('.logo-wrapper');
const logoCircle = document.querySelector('.logo-circle');
const logoImg = document.querySelector('.logo-img');

const maxScroll = 150;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function updateHeader() {
  const scrollY = window.scrollY;
  let progress = Math.min(scrollY / maxScroll, 1);
  progress = easeOutCubic(progress);

  // Header padding
  const paddingStart = 1.4;
  const paddingEnd = 0.7;
  header.style.padding = `${paddingStart + (paddingEnd - paddingStart) * progress}rem 0`;

  // Logo size (responsive)
  const sizeStart = window.innerWidth <= 768 ? 64 : 80;
  const sizeEnd = window.innerWidth <= 768 ? 40 : 48;
  const size = sizeStart + (sizeEnd - sizeStart) * progress;
  logoWrapper.style.width = `${size}px`;
  logoWrapper.style.height = `${size}px`;

  // Circle
  logoCircle.style.opacity = 1 - progress;
  logoCircle.style.transform = `scale(${1.5 - progress * 1.5})`;

  // Logo color
  if (progress < 0.5) {
    logoImg.style.filter = 'brightness(0) saturate(100%) invert(24%) sepia(94%) saturate(7490%) hue-rotate(202deg) brightness(91%) contrast(101%)';
  } else {
    logoImg.style.filter = 'brightness(0) invert(1)';
  }
}

window.addEventListener('scroll', () => requestAnimationFrame(updateHeader));
window.addEventListener('resize', updateHeader);
updateHeader();

// Model tables: filter by footprint size. A type with no match greys out.
document.querySelectorAll('.models-block').forEach(block => {
  const chips = block.querySelectorAll('.filter-chip');
  const groups = block.querySelectorAll('.model-group');
  const emptyMsg = block.querySelector('.filter-empty');
  if (!chips.length || !groups.length) return;

  function apply(size) {
    let total = 0;

    groups.forEach(group => {
      let visible = 0;
      group.querySelectorAll('tbody tr').forEach(row => {
        // A row lists every footprint it fits, so any one of them can match.
        const sizes = (row.dataset.size || '').split(' ');
        const match = size === 'all' || sizes.indexOf(size) !== -1;
        row.hidden = !match;
        if (match) visible++;

        // Flag the row when this size is only reached by cutting the panel.
        const flag = row.querySelector('.cut-flag');
        if (flag) {
          flag.hidden = !(match && size !== 'all' && row.dataset.nominal !== size);
        }
      });

      const count = group.querySelector('[data-count]');
      if (count) count.textContent = visible;

      const empty = visible === 0;
      group.classList.toggle('is-empty', empty);
      group.open = !empty;
      total += visible;
    });

    if (emptyMsg) emptyMsg.hidden = total > 0;
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(other => {
        const on = other === chip;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-pressed', on);
      });
      apply(chip.dataset.size);
    });
  });

  // A greyed out group must not open.
  groups.forEach(group => {
    const summary = group.querySelector('summary');
    if (summary) {
      summary.addEventListener('click', e => {
        if (group.classList.contains('is-empty')) e.preventDefault();
      });
    }
  });

  apply('all');
});

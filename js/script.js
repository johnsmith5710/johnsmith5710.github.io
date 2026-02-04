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

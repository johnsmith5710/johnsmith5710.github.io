// js/script.js

const header = document.querySelector('header');
const logoWrapper = document.querySelector('.logo-wrapper');
const logoCircle = document.querySelector('.logo-circle');
const logoImg = document.querySelector('.logo-img');

const maxScroll = 150; // px after which we reach "fully scrolled" state

function updateHeaderOnScroll() {
  const scrollY = window.scrollY;
  let progress = Math.min(scrollY / maxScroll, 1); // 0 → 1

  // Header padding
  const paddingStart = 1.4;
  const paddingEnd = 0.7;
  const padding = paddingStart - (paddingStart - paddingEnd) * progress;
  header.style.padding = `${padding}rem 0`;

  // Logo wrapper size
  const sizeStart = 80;
  const sizeEnd = 48;
  const size = sizeStart - (sizeStart - sizeEnd) * progress;
  logoWrapper.style.width = `${size}px`;
  logoWrapper.style.height = `${size}px`;

  // Circle
  logoCircle.style.opacity = 1 - progress;
  logoCircle.style.transform = `scale(${1 - progress * 0.9})`; // 1 → ~0.1

  // Logo color interpolation (simple cross-fade between two filters)
  // You can use more advanced color mixing if needed
  if (progress < 0.5) {
    logoImg.style.filter = `brightness(0) saturate(100%) invert(24%) sepia(94%) saturate(7490%) hue-rotate(202deg) brightness(91%) contrast(101%)`;
  } else {
    logoImg.style.filter = `brightness(0) invert(1)`;
  }
  // For smoother color transition you could use CSS mix-blend-mode or two overlapping images, but filter is simplest
}

window.addEventListener('scroll', () => {
  requestAnimationFrame(updateHeaderOnScroll);
});

// Run once on load
updateHeaderOnScroll();

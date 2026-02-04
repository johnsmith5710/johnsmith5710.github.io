// Smooth scrolling for anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');

    // Handle "#" (home/top of page) separately – no valid element to query
    if (href === '#' || href === '') {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      return;
    }

    // Normal anchor links (e.g. #who, #jobs)
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });
});

// Smooth progressive header shrink on scroll (lightweight rAF)
const header = document.querySelector('header');
const logoWrapper = document.querySelector('.logo-wrapper');
const logoCircle = document.querySelector('.logo-circle');
const logoImg = document.querySelector('.logo-img');

const maxScroll = 150; // px over which the full transition happens

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3); // smooth easing
}

function updateHeader() {
  const scrollY = window.scrollY;
  let progress = Math.min(scrollY / maxScroll, 1);
  progress = easeOutCubic(progress); // apply easing for natural feel

  // Header padding
  const paddingStart = 1.4;
  const paddingEnd = 0.7;
  header.style.padding = `${paddingStart + (paddingEnd - paddingStart) * progress}rem 0`;

  // Logo size
  const sizeStart = window.innerWidth <= 768 ? 64 : 80;
  const sizeEnd = window.innerWidth <= 768 ? 40 : 48;
  const size = sizeStart + (sizeEnd - sizeStart) * progress;
  logoWrapper.style.width = `${size}px`;
  logoWrapper.style.height = `${size}px`;

  // Circle fade & shrink
  logoCircle.style.opacity = 1 - progress;
  logoCircle.style.transform = `scale(${1.5 - progress * 1.5})`; // from 1.5 → 0

  // Logo color (smooth filter cross-fade – simple but effective)
  if (progress < 0.5) {
    logoImg.style.filter = 'brightness(0) saturate(100%) invert(24%) sepia(94%) saturate(7490%) hue-rotate(202deg) brightness(91%) contrast(101%)';
  } else {
    logoImg.style.filter = 'brightness(0) invert(1)';
  }
}

window.addEventListener('scroll', () => {
  requestAnimationFrame(updateHeader);
});

// Initial + resize handling
updateHeader();
window.addEventListener('resize', updateHeader);

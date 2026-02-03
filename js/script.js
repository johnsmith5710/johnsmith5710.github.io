const header = document.querySelector('header');
const logoWrapper = document.querySelector('.logo-wrapper');
const logoCircle = document.querySelector('.logo-circle');
const logoImg = document.querySelector('.logo-img');

const maxScroll = 150; // distance in pixels where animation completes

function updateOnScroll() {
  const scrollY = window.scrollY;
  const progress = Math.min(scrollY / maxScroll, 1);

  // Header padding
  const paddingStart = 1.4;
  const paddingEnd = 0.7;
  header.style.padding = `${paddingStart - (paddingStart - paddingEnd) * progress}rem 0`;

  // Logo wrapper size
  const sizeStart = 80;
  const sizeEnd = 48;
  const size = sizeStart - (sizeStart - sizeEnd) * progress;
  logoWrapper.style.width = `${size}px`;
  logoWrapper.style.height = `${size}px`;

  // Circle fade & shrink
  logoCircle.style.opacity = 1 - progress;
  logoCircle.style.transform = `scale(${1 - progress * 0.9})`;

  // Logo color – simple switch at 50% (you can make this gradient if you want)
  if (progress < 0.5) {
    logoImg.style.filter = 'brightness(0) saturate(100%) invert(24%) sepia(94%) saturate(7490%) hue-rotate(202deg) brightness(91%) contrast(101%)';
  } else {
    logoImg.style.filter = 'brightness(0) invert(1)';
  }
}

window.addEventListener('scroll', () => {
  requestAnimationFrame(updateOnScroll);
});

// Initial call (handles already-scrolled pages)
updateOnScroll();

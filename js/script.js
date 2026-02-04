// Smooth scrolling for anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
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

// ── Google Translate Banner Killer ──
// This removes ONLY the top banner, not the dropdown widget
function hideTranslateBanner() {
  // Target ONLY the banner frame that appears at the top of the page
  const bannerFrames = document.querySelectorAll('iframe.goog-te-banner-frame');
  bannerFrames.forEach(frame => {
    frame.style.display = 'none';
  });
  
  // Target the skiptranslate div that's a direct child of body (the banner container)
  const skipTranslateDivs = document.querySelectorAll('body > .skiptranslate');
  skipTranslateDivs.forEach(div => {
    // Only hide if it contains the banner iframe (not our dropdown)
    if (div.querySelector('iframe.goog-te-banner-frame') || div.style.position === 'absolute') {
      div.style.display = 'none';
    }
  });
  
  // Reset body positioning that Google Translate tries to add for the banner
  if (document.body.style.top && document.body.style.top !== '0px') {
    document.body.style.top = '0';
  }
  if (document.body.style.position === 'relative') {
    document.body.style.position = 'static';
  }
}

// Run after Google Translate initializes
window.addEventListener('load', () => {
  setTimeout(hideTranslateBanner, 100);
  setTimeout(hideTranslateBanner, 500);
  setTimeout(hideTranslateBanner, 1000);
  setTimeout(hideTranslateBanner, 2000);
});

// Watch for the banner being added and hide it
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === 1) {
        // Only target the top banner, not our translate element
        if (node.tagName === 'IFRAME' && node.classList?.contains('goog-te-banner-frame')) {
          hideTranslateBanner();
        }
        // Check for the banner container div
        if (node.classList?.contains('skiptranslate') && 
            (node.querySelector('iframe.goog-te-banner-frame') || node.style.position === 'absolute')) {
          hideTranslateBanner();
        }
      }
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: false // Only watch direct children of body
});

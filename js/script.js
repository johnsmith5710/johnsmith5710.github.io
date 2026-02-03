// Smooth scrolling (keep if you have it)
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  });
});

// Header scroll effect
const header = document.querySelector('header');
const scrollThreshold = 80; // pixels from top to trigger "scrolled" state

window.addEventListener('scroll', () => {
  if (window.scrollY > scrollThreshold) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
});

// Optional: trigger once on load in case page starts scrolled
window.addEventListener('load', () => {
  if (window.scrollY > scrollThreshold) {
    header.classList.add('scrolled');
  }
});
